using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class FinanceScopeResolver
{
    public static async Task<ScopeTarget?> ResolveChargeWriteAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context)
    {
        var enrollmentId = ScopeArgument.GuidProperty(context, "ChargeWriteRequest", "EnrollmentId");
        return enrollmentId is { } id ? await AuditTrashScopeResolver.EntityTargetAsync(connection, "enrollment", id) : ScopeTarget.UnlinkedTarget;
    }

    public static async Task<ScopeTarget?> ResolvePaymentWriteAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context)
    {
        var chargeId = ScopeArgument.GuidProperty(context, "PaymentWriteRequest", "MonthlyChargeId");
        return chargeId is { } id ? await AuditTrashScopeResolver.EntityTargetAsync(connection, "monthly-charge", id) : ScopeTarget.UnlinkedTarget;
    }

    public static async Task<ScopeTarget> ResolveAdvertisingWriteAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context)
    {
        var circleId = ScopeArgument.GuidProperty(context, "AdvertisingExpenseWriteRequest", "CircleId");
        return circleId is { } id ? await AuditTrashScopeResolver.EntityTargetAsync(connection, "circle", id) : ScopeTarget.UnlinkedTarget;
    }

    public static async Task<ScopeTarget> ResolveOperatingWriteAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context)
    {
        var circleId = ScopeArgument.GuidProperty(context, "OperatingExpenseWriteRequest", "CircleId");
        return circleId is { } id ? await AuditTrashScopeResolver.EntityTargetAsync(connection, "circle", id) : ScopeTarget.UnlinkedTarget;
    }
}
