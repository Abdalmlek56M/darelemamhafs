-- The audit trail is evidence, not a mutable business table.
-- Allow only:
--   1) the generic AuditMiddleware enriching a newly created placeholder row, and
--   2) the explicit restore metadata columns (restored_at / can_restore).
-- Everything else is rejected, including all DELETEs.

CREATE OR REPLACE FUNCTION public.dar_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audit_log is append-only; DELETE is not allowed';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Restore metadata only: every substantive column must stay identical.
        IF NEW.id = OLD.id
           AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
           AND NEW.actor_display_name IS NOT DISTINCT FROM OLD.actor_display_name
           AND NEW.action_code = OLD.action_code
           AND NEW.entity_type = OLD.entity_type
           AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
           AND NEW.occurred_at = OLD.occurred_at
           AND NEW.details IS NOT DISTINCT FROM OLD.details
           AND NEW.before_data IS NOT DISTINCT FROM OLD.before_data
           AND NEW.after_data IS NOT DISTINCT FROM OLD.after_data
           AND NEW.request_path IS NOT DISTINCT FROM OLD.request_path
           AND NEW.http_method IS NOT DISTINCT FROM OLD.http_method
        THEN
            RETURN NEW;
        END IF;

        -- AuditMiddleware enrichment of a just-created placeholder row.
        IF OLD.request_path IS NULL
           AND OLD.http_method IS NULL
           AND NEW.request_path IS NOT NULL
           AND NEW.http_method IS NOT NULL
           AND NEW.id = OLD.id
           AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
           AND NEW.action_code = OLD.action_code
           AND NEW.entity_type = OLD.entity_type
           AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
           AND NEW.occurred_at = OLD.occurred_at
        THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'audit_log is append-only; only request enrichment and restore metadata may change';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON public.audit_log;
CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.dar_audit_log_append_only();
