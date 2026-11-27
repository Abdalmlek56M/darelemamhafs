-- FINAL Tier 2.3 (part A/2) -- explicit enrollment status history: schema + triggers.
--
-- WHY: public.dar_enrollment_status_at_date() and
-- public.dar_enrollment_is_attendance_eligible_on_date() are evaluated per enrollment and per
-- calendar day by attendance rosters, session summaries and monthly charge eligibility. They used
-- to scan public.audit_log, cast details JSON keys (details->>'effectiveOn')::date on every call
-- and re-sort the matching lifecycle rows. That is the largest scale trap in the eligibility path.
--
-- WHAT: part A creates public.enrollment_status_history (append-only, back-referenced to
-- audit_log.id), its indexes, the append-only guard and the audit_log INSERT trigger that keeps
-- it in sync. Part B (039b) backfills it, asserts invariants, adds the one-time synthetic rows
-- and switches the eligibility functions to read the table.
--
-- SPLIT: this file is the schema half only and stays re-runnable/idempotent on its own:
-- CREATE TABLE/INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS + CREATE TRIGGER, CREATE OR REPLACE
-- FUNCTION. Re-running A then B is a no-op after the first successful run.
--
-- FK DECISION (ADR-0009):
--   * enrollment_id -> circle_enrollments(id) ON DELETE CASCADE: a permanently purged/reset
--     enrollment must not be blocked by its own materialised history. Physical deletes of an
--     enrollment are already guarded by its financial/attendance FKs (those stay RESTRICT), so
--     CASCADE here only removes derived rows. The append-only guard allows DELETEs that arrive
--     through an FK cascade (trigger depth > 1) and still rejects direct application DELETEs.
--   * source_audit_id -> audit_log(id) ON DELETE RESTRICT: audit_log is append-only and is never
--     pruned by retention/reset jobs (RetentionService explicitly excludes it; the reset flow only
--     moves live records to trash). RESTRICT makes a future audit prune a deliberate migration
--     decision instead of silently destroying traceability.
--
-- LOCK: this half takes no long lock on audit_log. The backfill/assertion half (039b) holds
-- SHARE ROW EXCLUSIVE on audit_log for its own transaction only; creating the AFTER INSERT
-- trigger takes a short ShareRowExclusive lock on audit_log (blocks concurrent audit writes only
-- for the duration of that statement).

CREATE TABLE IF NOT EXISTS public.enrollment_status_history (
    id BIGSERIAL PRIMARY KEY,
    enrollment_id UUID NOT NULL,
    -- Mirrors audit_log.details->>'status' exactly (including NULL) so the functions' COALESCE
    -- fallback behaves identically for malformed legacy rows. App lifecycles write active/paused/ended.
    status TEXT,
    -- The date the status change took effect (audit_log.details->>'effectiveOn')::date.
    effective_at DATE NOT NULL,
    -- The audit row's wall-clock timestamp; part of the exact legacy ORDER BY tie-breaker.
    occurred_at TIMESTAMPTZ NOT NULL,
    action_code VARCHAR(100) NOT NULL,
    reason TEXT,
    -- The audit_log row this row was materialised from. NULL only for synthetic snapshot rows.
    source_audit_id BIGINT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT enrollment_status_history_enrollment_fkey
        FOREIGN KEY (enrollment_id) REFERENCES public.circle_enrollments(id) ON DELETE CASCADE,
    CONSTRAINT enrollment_status_history_source_audit_fkey
        FOREIGN KEY (source_audit_id) REFERENCES public.audit_log(id) ON DELETE RESTRICT
);

-- Hot lookup: latest real state on/before a date, ordered exactly like the legacy audit query.
CREATE INDEX IF NOT EXISTS ix_enrollment_status_history_lookup
    ON public.enrollment_status_history (enrollment_id, effective_at DESC, occurred_at DESC, source_audit_id DESC)
    WHERE source_audit_id IS NOT NULL;

-- Supports synthetic-row existence checks and the enrollment foreign-key reverse lookup.
CREATE INDEX IF NOT EXISTS ix_enrollment_status_history_enrollment
    ON public.enrollment_status_history (enrollment_id);

-- This table is a history table, not mutable business state: rows are only ever appended.
CREATE OR REPLACE FUNCTION public.dar_enrollment_status_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
    -- FK cascades fire this trigger one nesting level deeper than a direct application DELETE;
    -- permit those so purging/resetting an enrollment can remove its derived history rows.
    -- Direct UPDATE/DELETE (trigger depth 1) is still rejected.
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'enrollment_status_history is append-only; % is not allowed', TG_OP;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enrollment_status_history_append_only ON public.enrollment_status_history;
CREATE TRIGGER trg_enrollment_status_history_append_only
    BEFORE UPDATE OR DELETE ON public.enrollment_status_history
    FOR EACH ROW
    EXECUTE FUNCTION public.dar_enrollment_status_history_append_only();

-- Keep the materialised history in sync with every writer of enrollment lifecycle audit rows,
-- including the legacy DomainEndpoints lifecycle helpers and any future modular/back-office path.
-- The trigger only copies the two keys the old functions parsed; rows without a usable
-- effectiveOn are ignored exactly like the legacy WHERE clause ignored them.
CREATE OR REPLACE FUNCTION public.dar_sync_enrollment_status_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
    v_effective_at date;
BEGIN
    IF NEW.entity_type IS DISTINCT FROM 'enrollment' OR NEW.entity_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.action_code IS NULL
       OR NEW.action_code NOT IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end') THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_effective_at := NULLIF(NEW.details->>'effectiveOn','')::date;
    EXCEPTION WHEN others THEN
        -- An unparseable effectiveOn makes the row unusable for the legacy functions too; skip it
        -- rather than aborting a business transaction whose audit row is already valid evidence.
        RETURN NEW;
    END;

    IF v_effective_at IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.enrollment_status_history
        (enrollment_id, status, effective_at, occurred_at, action_code, reason, source_audit_id)
    SELECT NEW.entity_id, NEW.details->>'status', v_effective_at, NEW.occurred_at,
           NEW.action_code, NULLIF(NEW.details->>'reason',''), NEW.id
    WHERE EXISTS (SELECT 1 FROM public.circle_enrollments ce WHERE ce.id = NEW.entity_id)
    ON CONFLICT (source_audit_id) DO NOTHING;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_log_enrollment_status_history ON public.audit_log;
CREATE TRIGGER trg_audit_log_enrollment_status_history
    AFTER INSERT ON public.audit_log
    FOR EACH ROW
    EXECUTE FUNCTION public.dar_sync_enrollment_status_history();


COMMENT ON TABLE public.enrollment_status_history IS
    'Append-only materialised enrollment lifecycle events. Real rows (source_audit_id IS NOT NULL) mirror the enrollment lifecycle audit_log rows the eligibility functions used to parse; synthetic rows (initial/snapshot) record pre-audit legacy state and are ignored by the eligibility functions. audit_log remains the source of truth and is never pruned.';
COMMENT ON COLUMN public.enrollment_status_history.status IS
    'Exact copy of audit_log.details->>''status'' (active/paused/ended for app rows; NULL mirrors malformed legacy evidence so the functions'' COALESCE fallback is identical).';
COMMENT ON COLUMN public.enrollment_status_history.effective_at IS
    'Exact copy of (audit_log.details->>''effectiveOn'')::date: the date the new status takes effect.';
COMMENT ON COLUMN public.enrollment_status_history.occurred_at IS
    'Exact copy of audit_log.occurred_at; second tie-breaker in the legacy ORDER BY.';
COMMENT ON COLUMN public.enrollment_status_history.source_audit_id IS
    'Back-reference to audit_log.id. NULL only for one-time synthetic initial/snapshot rows.';
COMMENT ON COLUMN public.enrollment_status_history.action_code IS
    'Original audit action code (enrollment.status.baseline / pause / resume / end) or a synthetic action code for snapshot rows.';

