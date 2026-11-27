-- FINAL Tier 2.3 -- explicit enrollment status history.
--
-- WHY: public.dar_enrollment_status_at_date() and
-- public.dar_enrollment_is_attendance_eligible_on_date() are evaluated per enrollment and per
-- calendar day by attendance rosters, session summaries and monthly charge eligibility. They used
-- to scan public.audit_log, cast details JSON keys (details->>'effectiveOn')::date on every call
-- and re-sort the matching lifecycle rows. That is the largest scale trap in the eligibility path:
-- the cost grows with the audit trail, not with the enrollment being checked.
--
-- WHAT: this migration materialises exactly the lifecycle rows those functions parsed into
-- public.enrollment_status_history, backfills it from audit_log, keeps it append-only in sync with
-- a trigger on audit_log INSERT (so no existing or future writer can silently miss it), and
-- switches the two date-effective functions to read the new table. Return names, argument lists,
-- return types and the legacy fallback semantics are preserved byte for byte, so no caller changes.
--
-- audit_log IS NEVER MODIFIED OR PRUNED HERE: it stays the append-only source of truth and the
-- unique source_audit_id back-reference on every real history row keeps full traceability.
--
-- SYNTHETIC ROWS: enrollments that predate any lifecycle audit row (legacy rows created by direct
-- SQL/imports, or by endpoints that only wrote a circle-level audit row such as the modular
-- supervisor "add students" endpoint) get one-time synthetic snapshot rows. They are traceability
-- rows only -- the eligibility functions deliberately ignore rows with source_audit_id IS NULL,
-- because the date-varying legacy fallback ("paused rows were active before CURRENT_DATE", "ended
-- rows were active until ends_on") cannot be represented by a static effective date. Ignoring
-- synthetic rows keeps the functions bit-for-bit identical to the legacy audit-based behaviour
-- while still recording what was observed when this migration ran.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS, ON CONFLICT (source_audit_id) DO NOTHING and
-- NOT EXISTS guards for the synthetic rows. Re-running the file keeps all counts stable and leaves
-- audit_log untouched.

-- Block concurrent audit writers for the duration of the migration transaction so no lifecycle row
-- can be inserted between the backfill snapshot and the moment the sync trigger becomes active.
-- Inside a DO block this is accepted both by the transactional migration runner and by a plain
-- psql -f re-run (where it simply lasts for the DO statement), keeping the file re-runnable.
DO $lock$
BEGIN
    EXECUTE 'LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE';
END;
$lock$;

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
        FOREIGN KEY (enrollment_id) REFERENCES public.circle_enrollments(id) ON DELETE RESTRICT,
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

-- Backfill + invariants + one-time synthetic snapshot rows.
DO $migration$
DECLARE
    v_lifecycle_rows bigint;
    v_without_effective_on bigint;
    v_orphans bigint;
    v_expected bigint;
    v_before bigint;
    v_after bigint;
    v_synced bigint;
    v_missing bigint;
    v_duplicate_sources bigint;
    v_tampered bigint;
    v_initial_inserted bigint;
    v_snapshot_inserted bigint;
    v_enrollments_without_history bigint;
    v_bad_synthetic bigint;
BEGIN
    -- 1) Validate the audit rows we are about to map. NULL/empty effectiveOn was silently skipped
    --    by the legacy WHERE clause; a non-empty unparseable value would have made the legacy
    --    functions raise a cast error, so it must be repaired before this migration can promise
    --    identical behaviour.
    SELECT count(*) INTO v_lifecycle_rows
    FROM public.audit_log al
    WHERE al.entity_type = 'enrollment'
      AND al.entity_id IS NOT NULL
      AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end');

    BEGIN
        -- Forces the same ::date cast the legacy functions performed, for every lifecycle row.
        SELECT count(*) INTO v_without_effective_on
        FROM public.audit_log al
        WHERE al.entity_type = 'enrollment'
          AND al.entity_id IS NOT NULL
          AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
          AND NULLIF(al.details->>'effectiveOn','')::date IS NOT NULL;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION
            'enrollment_status_history backfill cannot run: an enrollment lifecycle audit row has an un-castable details->>''effectiveOn'' (%). Fix the audit evidence before applying 039.', SQLERRM;
    END;
    v_without_effective_on := v_lifecycle_rows - v_without_effective_on;

    SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.circle_enrollments ce WHERE ce.id = al.entity_id)),
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.circle_enrollments ce WHERE ce.id = al.entity_id))
      INTO v_expected, v_orphans
    FROM public.audit_log al
    WHERE al.entity_type = 'enrollment'
      AND al.entity_id IS NOT NULL
      AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
      AND NULLIF(al.details->>'effectiveOn','')::date IS NOT NULL;

    IF v_orphans > 0 THEN
        -- Audit rows for physically deleted enrollments are invisible to the legacy functions
        -- (they query by the enrollment id) and cannot satisfy the FK; keep them only in audit_log.
        RAISE WARNING 'enrollment_status_history: % lifecycle audit row(s) reference enrollments that no longer exist and were not backfilled', v_orphans;
    END IF;
    IF v_without_effective_on > 0 THEN
        RAISE WARNING 'enrollment_status_history: % lifecycle audit row(s) without a usable effectiveOn were skipped, matching the legacy functions', v_without_effective_on;
    END IF;

    -- 2) Backfill. ON CONFLICT makes a re-run a no-op; source_audit_id is unique by design.
    SELECT count(*) INTO v_before FROM public.enrollment_status_history;

    INSERT INTO public.enrollment_status_history
        (enrollment_id, status, effective_at, occurred_at, action_code, reason, source_audit_id)
    SELECT al.entity_id,
           al.details->>'status',
           NULLIF(al.details->>'effectiveOn','')::date,
           al.occurred_at,
           al.action_code,
           NULLIF(al.details->>'reason',''),
           al.id
    FROM public.audit_log al
    JOIN public.circle_enrollments ce ON ce.id = al.entity_id
    WHERE al.entity_type = 'enrollment'
      AND al.entity_id IS NOT NULL
      AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
      AND NULLIF(al.details->>'effectiveOn','')::date IS NOT NULL
    ON CONFLICT (source_audit_id) DO NOTHING;

    SELECT count(*) INTO v_after FROM public.enrollment_status_history;
    -- Before/after count assertion: every mappable lifecycle row now has exactly one real row.
    SELECT count(*) INTO v_synced FROM public.enrollment_status_history WHERE source_audit_id IS NOT NULL;
    IF v_synced <> v_expected THEN
        RAISE EXCEPTION
            'enrollment_status_history backfill invariant broken: expected % real row(s) but the table holds % (before=% after=%)',
            v_expected, v_synced, v_before, v_after;
    END IF;

    SELECT count(*) INTO v_missing
    FROM public.audit_log al
    WHERE al.entity_type = 'enrollment'
      AND al.entity_id IS NOT NULL
      AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
      AND NULLIF(al.details->>'effectiveOn','')::date IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.circle_enrollments ce WHERE ce.id = al.entity_id)
      AND NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h WHERE h.source_audit_id = al.id);
    IF v_missing > 0 THEN
        RAISE EXCEPTION 'enrollment_status_history backfill invariant broken: % lifecycle audit row(s) still have no history row', v_missing;
    END IF;

    SELECT count(*) - count(DISTINCT source_audit_id) INTO v_duplicate_sources
    FROM public.enrollment_status_history WHERE source_audit_id IS NOT NULL;
    IF v_duplicate_sources <> 0 THEN
        RAISE EXCEPTION 'enrollment_status_history invariant broken: % duplicate source_audit_id value(s)', v_duplicate_sources;
    END IF;

    -- Every real row must still point at exactly the audit evidence it claims (no silent drift
    -- from a partial re-run or a manual write).
    SELECT count(*) INTO v_tampered
    FROM public.enrollment_status_history h
    JOIN public.audit_log al ON al.id = h.source_audit_id
    WHERE h.source_audit_id IS NOT NULL
      AND (al.entity_type IS DISTINCT FROM 'enrollment'
           OR al.entity_id IS DISTINCT FROM h.enrollment_id
           OR al.action_code IS DISTINCT FROM h.action_code
           OR NULLIF(al.details->>'effectiveOn','')::date IS DISTINCT FROM h.effective_at
           OR (al.details->>'status') IS DISTINCT FROM h.status
           OR al.occurred_at IS DISTINCT FROM h.occurred_at);
    IF v_tampered > 0 THEN
        RAISE EXCEPTION 'enrollment_status_history invariant broken: % real row(s) do not match their source audit row', v_tampered;
    END IF;

    -- 3) One-time synthetic rows for pre-existing enrollments with no lifecycle audit evidence.
    --    'initial': the enrollment was created active on starts_on (the legacy fallback assumption).
    --    'snapshot': the paused/ended state observed when this migration (re)ran; the live row plus
    --    the function fallback remain authoritative, the snapshot is for human traceability only.
    INSERT INTO public.enrollment_status_history
        (enrollment_id, status, effective_at, occurred_at, action_code, reason, source_audit_id)
    SELECT ce.id, 'active', ce.starts_on, ce.created_at,
           'enrollment.status.initial',
           'حالة أولية: لا يوجد سجل تغيير حالة موثوق قبل هذا التاريخ (أُنشئ الالتحاق نشطًا).', NULL
    FROM public.circle_enrollments ce
    WHERE NOT EXISTS (
        SELECT 1 FROM public.enrollment_status_history h
        WHERE h.enrollment_id = ce.id
          AND (h.source_audit_id IS NOT NULL OR h.action_code = 'enrollment.status.initial'));
    GET DIAGNOSTICS v_initial_inserted = ROW_COUNT;

    INSERT INTO public.enrollment_status_history
        (enrollment_id, status, effective_at, occurred_at, action_code, reason, source_audit_id)
    SELECT ce.id, ce.status, CURRENT_DATE, now(),
           'enrollment.status.snapshot',
           'لقطة حالة الالتحاق الحالية عند تفعيل سجل الحالات؛ الحالة الحية هي المرجع.', NULL
    FROM public.circle_enrollments ce
    WHERE ce.status IN ('paused','ended')
      AND NOT EXISTS (
          SELECT 1 FROM public.enrollment_status_history h
          WHERE h.enrollment_id = ce.id AND h.source_audit_id IS NOT NULL)
      AND NOT EXISTS (
          SELECT 1 FROM public.enrollment_status_history h
          WHERE h.enrollment_id = ce.id AND h.action_code = 'enrollment.status.snapshot');
    GET DIAGNOSTICS v_snapshot_inserted = ROW_COUNT;

    SELECT count(*) INTO v_bad_synthetic
    FROM (
        SELECT enrollment_id FROM public.enrollment_status_history
        WHERE action_code = 'enrollment.status.initial'
        GROUP BY enrollment_id HAVING count(*) > 1
        UNION ALL
        SELECT enrollment_id FROM public.enrollment_status_history
        WHERE action_code = 'enrollment.status.snapshot'
        GROUP BY enrollment_id HAVING count(*) > 1
    ) duplicates;
    IF v_bad_synthetic > 0 THEN
        RAISE EXCEPTION 'enrollment_status_history invariant broken: % enrollment(s) have duplicate synthetic snapshot rows', v_bad_synthetic;
    END IF;

    SELECT count(*) INTO v_enrollments_without_history
    FROM public.circle_enrollments ce
    WHERE NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h WHERE h.enrollment_id = ce.id);
    IF v_enrollments_without_history > 0 THEN
        RAISE EXCEPTION 'enrollment_status_history invariant broken: % enrollment(s) have no history row at all', v_enrollments_without_history;
    END IF;

    RAISE NOTICE 'enrollment_status_history ready: % lifecycle audit row(s), % real row(s) (backfilled %), % synthetic initial, % synthetic snapshot, audit_log left untouched',
        v_lifecycle_rows, v_synced, v_after - v_before, v_initial_inserted, v_snapshot_inserted;
END;
$migration$;

-- Switch the eligibility functions to the explicit history table. Argument lists, return types,
-- volatility and the legacy fallback/end-date semantics are preserved exactly so every legacy and
-- modular caller keeps working unchanged; only the JSON audit scan is replaced by an index lookup.
CREATE OR REPLACE FUNCTION public.dar_enrollment_status_at_date(p_enrollment_id uuid, p_date date)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
    SELECT COALESCE(
        (
            SELECT h.status
            FROM public.enrollment_status_history h
            WHERE h.enrollment_id = ce.id
              AND h.source_audit_id IS NOT NULL
              AND h.effective_at <= p_date
            ORDER BY h.effective_at DESC, h.occurred_at DESC, h.source_audit_id DESC
            LIMIT 1
        ),
        CASE
            WHEN ce.status='paused' AND p_date<CURRENT_DATE THEN 'active'
            WHEN ce.status='ended' AND ce.ends_on IS NOT NULL AND p_date<=ce.ends_on THEN 'active'
            ELSE ce.status
        END
    )
    FROM public.circle_enrollments ce
    WHERE ce.id=p_enrollment_id;
$function$;

CREATE OR REPLACE FUNCTION public.dar_enrollment_is_attendance_eligible_on_date(p_enrollment_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.circle_enrollments ce
        WHERE ce.id=p_enrollment_id
          AND (
              public.dar_enrollment_status_at_date(ce.id,p_date)='active'
              OR (
                  public.dar_enrollment_status_at_date(ce.id,p_date)='ended'
                  AND ce.ends_on=p_date
                  AND EXISTS (
                      SELECT 1
                      FROM public.enrollment_status_history end_event
                      LEFT JOIN LATERAL (
                          SELECT prior.status AS prior_status
                          FROM public.enrollment_status_history prior
                          WHERE prior.enrollment_id=ce.id
                            AND prior.source_audit_id IS NOT NULL
                            AND (
                                prior.effective_at < ce.ends_on
                                OR (
                                    prior.effective_at = ce.ends_on
                                    AND (
                                        prior.occurred_at < end_event.occurred_at
                                        OR (prior.occurred_at = end_event.occurred_at AND prior.source_audit_id < end_event.source_audit_id)
                                    )
                                )
                            )
                          ORDER BY prior.effective_at DESC, prior.occurred_at DESC, prior.source_audit_id DESC
                          LIMIT 1
                      ) previous_state ON TRUE
                      WHERE end_event.enrollment_id=ce.id
                        AND end_event.source_audit_id IS NOT NULL
                        AND end_event.action_code='enrollment.end'
                        AND end_event.effective_at=ce.ends_on
                        AND COALESCE(previous_state.prior_status,'active')='active'
                  )
              )
          )
    );
$function$;

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
