using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;

namespace DarEltahfeez.Api;

/// <summary>
/// FINAL B7: the legacy admin cookie used to embed one <c>permission</c> claim per granted
/// permission. With the 65-code catalog that pushed the ticket to ~4 KB (very close to the
/// 4 KB browser cookie limit and larger than nginx's default proxy header buffer), and it grows
/// linearly with the catalog: 200 permissions produced ~11 KB split across several chunk
/// cookies. Permissions are already reloaded from the database on every request in
/// <see cref="AuthEndpoints.ValidatePrincipalAsync"/>, so the ticket only needs the identity,
/// display name and session version. This wrapper strips the permission claims on the way into
/// the ticket (protect), while leaving decryption untouched so cookies issued before the change
/// keep validating: their stale permission claims are replaced in memory from the database, and
/// the next renewal writes a slim ticket.
/// </summary>
public sealed class SlimAdminCookieTicketDataFormat(ISecureDataFormat<AuthenticationTicket> inner)
    : ISecureDataFormat<AuthenticationTicket>
{
    private const string PermissionClaimType = "permission";

    public string Protect(AuthenticationTicket data) => Protect(data, purpose: null);

    public string Protect(AuthenticationTicket data, string? purpose)
    {
        var identity = new ClaimsIdentity(
            data.Principal.Claims.Where(claim => claim.Type != PermissionClaimType),
            data.Principal.Identity?.AuthenticationType ?? data.AuthenticationScheme);
        var slim = new AuthenticationTicket(
            new ClaimsPrincipal(identity),
            data.Properties,
            data.AuthenticationScheme);
        return inner.Protect(slim, purpose);
    }

    public AuthenticationTicket? Unprotect(string? protectedText) => inner.Unprotect(protectedText);

    public AuthenticationTicket? Unprotect(string? protectedText, string? purpose) =>
        inner.Unprotect(protectedText, purpose);
}
