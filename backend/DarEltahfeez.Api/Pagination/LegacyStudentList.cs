using System.Security.Claims;
using Dar.Common.Pagination;
using Dar.Common.Search;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    /// <summary>
    /// Tier 2.7 set-based students list. The old projection ran 7 correlated subqueries per row
    /// (circle names, current-month due, paid and the payment-status CASE re-ran the paid/due
    /// subqueries). This version filters + counts once in CTEs, pages first, then aggregates the
    /// circle/finance projection per *page* row through two LEFT JOIN LATERAL aggregates.
    /// Values, ordering, pagination total and header semantics are identical to the old SQL.
    /// </summary>
    private const string LegacyStudentListSql = """
        WITH filtered AS (
            SELECT s.id, s.student_code, s.full_name, s.age_years, s.phone, s.guardian_name, s.guardian_phone,
                   s.joined_on, s.status, s.notes, s.created_at, s.updated_at
            FROM students s
            WHERE s.is_trashed=FALSE
              AND (@search = '' OR s.full_name ILIKE @like OR s.student_code ILIKE @like OR COALESCE(s.phone,'') ILIKE @like
                   OR COALESCE(s.guardian_name,'') ILIKE @like OR COALESCE(s.guardian_phone,'') ILIKE @like)
              AND (@status = '' OR s.status = @status)
        ),
        counted AS (SELECT count(*) AS n FROM filtered),
        page AS (
            SELECT * FROM filtered
            ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1
                     WHEN 'withdrawn' THEN 2 ELSE 3 END, full_name, id
            LIMIT @take OFFSET @skip
        )
        SELECT p.id, p.student_code, p.full_name, p.age_years, p.phone, p.guardian_name, p.guardian_phone,
               p.joined_on, p.status, p.notes, p.created_at, p.updated_at,
               COALESCE(circles.circle_names, ''),
               COALESCE(fin.amount_due, 0),
               COALESCE(fin.paid, 0),
               CASE
                 WHEN fin.charge_count = 0 THEN 'not-set'
                 WHEN COALESCE(fin.paid, 0) >= COALESCE(fin.amount_due, 0) THEN 'paid'
                 WHEN COALESCE(fin.paid, 0) > 0 THEN 'partial'
                 ELSE 'unpaid'
               END,
               counted.n AS total
        FROM page p
        CROSS JOIN counted
        LEFT JOIN LATERAL (
            SELECT string_agg(circle.name, '، ' ORDER BY circle.name) AS circle_names
            FROM circle_enrollments ce
            JOIN circles circle ON circle.id = ce.circle_id
            WHERE ce.student_id = p.id AND ce.status='active' AND ce.is_trashed=FALSE
              AND circle.is_active=TRUE AND circle.is_trashed=FALSE
        ) circles ON TRUE
        LEFT JOIN LATERAL (
            SELECT SUM(monthly_charge.amount_due) AS amount_due,
                   SUM(COALESCE(payment.paid, 0)) AS paid,
                   COUNT(monthly_charge.id) AS charge_count
            FROM circle_enrollments ce
            JOIN monthly_charges monthly_charge
              ON monthly_charge.enrollment_id = ce.id
             AND monthly_charge.billing_month = date_trunc('month', CURRENT_DATE)::date
             AND monthly_charge.is_trashed=FALSE
             AND monthly_charge.voided_at IS NULL
            LEFT JOIN LATERAL (
                SELECT SUM(p.amount) AS paid
                FROM payments p
                WHERE p.monthly_charge_id = monthly_charge.id
                  AND p.is_trashed=FALSE AND p.voided_at IS NULL
            ) payment ON TRUE
            WHERE ce.student_id = p.id AND ce.is_trashed=FALSE
        ) fin ON TRUE
        """;

    internal static async Task<IResult> LoadLegacyStudentListAsync(
        ClaimsPrincipal principal, string? search, string? status, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var finance = CanReadFinance(principal);
        var term = (search ?? string.Empty).Trim();
        var statusFilter = (status ?? string.Empty).Trim();
        await using var cmd = db.CreateCommand(LegacyStudentListSql);
        cmd.Parameters.AddWithValue("search", term);
        // FINAL 2.2: the raw term is still needed for the empty-search guard; the LIKE
        // pattern additionally escapes %, _ and \ so those characters match literally.
        cmd.Parameters.AddWithValue("like", SqlSearchPattern.Contains(term));
        cmd.Parameters.AddWithValue("status", statusFilter);
        // Tier 2.7: LIMIT @take must exist even when the client did not ask for pagination;
        // a NULL LIMIT is "LIMIT ALL" in PostgreSQL, which keeps the unpaged response identical.
        cmd.Parameters.Add(new NpgsqlParameter("take", NpgsqlDbType.Bigint)
            { Value = paged ? paging.PageSize : DBNull.Value });
        cmd.Parameters.Add(new NpgsqlParameter("skip", NpgsqlDbType.Bigint)
            { Value = paged ? paging.Offset : 0L });
        var rows = new List<object>();
        long total = 0;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.ReadTotal();
            rows.Add(ReadStudent(reader, finance));
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(cmd, total, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
