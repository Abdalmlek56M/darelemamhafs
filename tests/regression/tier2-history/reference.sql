-- FINAL Tier 2.3 — compatibility oracle for tests/regression/tier2-history.
--
-- Verbatim copy of the migration-011 public.dar_enrollment_* bodies (audit_log JSON casts, exact
-- ORDER BY tie-breakers, legacy fallback semantics), renamed t23_ref_* so the suite can compare the
-- migrated history-backed functions against it on the same disposable database. The reference still
-- reads audit_log; the functions under test must no longer do so. Never shipped to production.
CREATE OR REPLACE FUNCTION public.t23_ref_status_at_date(p_enrollment_id uuid, p_date date)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
    SELECT COALESCE(
        (
            SELECT al.details->>'status'
            FROM public.audit_log al
            WHERE al.entity_type='enrollment'
              AND al.entity_id=ce.id
              AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
              AND NULLIF(al.details->>'effectiveOn','')::date<=p_date
            ORDER BY NULLIF(al.details->>'effectiveOn','')::date DESC,al.occurred_at DESC,al.id DESC
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

CREATE OR REPLACE FUNCTION public.t23_ref_eligible_on_date(p_enrollment_id uuid, p_date date)
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
              public.t23_ref_status_at_date(ce.id,p_date)='active'
              OR (
                  public.t23_ref_status_at_date(ce.id,p_date)='ended'
                  AND ce.ends_on=p_date
                  AND EXISTS (
                      SELECT 1
                      FROM public.audit_log end_event
                      LEFT JOIN LATERAL (
                          SELECT prior_event.details->>'status' AS prior_status
                          FROM public.audit_log prior_event
                          WHERE prior_event.entity_type='enrollment'
                            AND prior_event.entity_id=ce.id
                            AND prior_event.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
                            AND (
                                NULLIF(prior_event.details->>'effectiveOn','')::date < ce.ends_on
                                OR (
                                    NULLIF(prior_event.details->>'effectiveOn','')::date = ce.ends_on
                                    AND (
                                        prior_event.occurred_at < end_event.occurred_at
                                        OR (prior_event.occurred_at = end_event.occurred_at AND prior_event.id < end_event.id)
                                    )
                                )
                            )
                          ORDER BY NULLIF(prior_event.details->>'effectiveOn','')::date DESC,
                                   prior_event.occurred_at DESC,prior_event.id DESC
                          LIMIT 1
                      ) previous_state ON TRUE
                      WHERE end_event.entity_type='enrollment'
                        AND end_event.entity_id=ce.id
                        AND end_event.action_code='enrollment.end'
                        AND NULLIF(end_event.details->>'effectiveOn','')::date=ce.ends_on
                        AND COALESCE(previous_state.prior_status,'active')='active'
                  )
              )
          )
    );
$function$;

CREATE OR REPLACE FUNCTION public.t23_ref_has_active_day_in_month(p_enrollment_id uuid, p_billing_month date)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.circle_enrollments ce
        JOIN public.circles c ON c.id=ce.circle_id
        CROSS JOIN LATERAL generate_series(
            GREATEST(ce.starts_on,c.starts_on,date_trunc('month',p_billing_month)::date),
            LEAST(
                COALESCE(ce.ends_on,(date_trunc('month',p_billing_month)+INTERVAL '1 month - 1 day')::date),
                (date_trunc('month',p_billing_month)+INTERVAL '1 month - 1 day')::date
            ),
            INTERVAL '1 day'
        ) AS billing_day(day)
        WHERE ce.id=p_enrollment_id
          AND public.t23_ref_eligible_on_date(ce.id,billing_day.day::date)
    );
$function$;

SELECT 'reference-ready';
