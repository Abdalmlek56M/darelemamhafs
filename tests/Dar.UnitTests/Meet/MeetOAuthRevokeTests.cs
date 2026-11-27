using System.Net;
using Dar.Modules.Meet.Infrastructure;
using Microsoft.Extensions.Options;

namespace Dar.UnitTests.Meet;

/// <summary>FINAL 1.15: disconnecting must revoke the refresh token at Google, and a
/// missing/invalid token must not block the local disconnect.</summary>
public sealed class MeetOAuthRevokeTests
{
    private sealed class CapturingHandler(HttpStatusCode status) : HttpMessageHandler
    {
        public Uri? RequestUri { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUri = request.RequestUri;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status);
        }
    }

    private static MeetGoogleOAuth Client(HttpMessageHandler handler) =>
        new(Options.Create(new MeetOptions
        {
            EncryptionKey = Convert.ToBase64String(new byte[32]),
            Google = new MeetGoogleOptions { ClientId = "id", ClientSecret = "secret", RedirectUri = "https://example.invalid/cb" }
        }), new HttpClient(handler));

    [Fact]
    public async Task RevokePostsTheTokenToGoogle()
    {
        var handler = new CapturingHandler(HttpStatusCode.OK);
        var revoked = await Client(handler).RevokeAsync("1//refresh-token", CancellationToken.None);
        Assert.True(revoked);
        Assert.Equal("https://oauth2.googleapis.com/revoke", handler.RequestUri?.ToString());
        Assert.Contains("1%2F%2Frefresh-token", handler.Body);
    }

    [Fact]
    public async Task RevokeTreatsBadRequestAsAlreadyGone()
    {
        var handler = new CapturingHandler(HttpStatusCode.BadRequest);
        Assert.True(await Client(handler).RevokeAsync("expired", CancellationToken.None));
    }

    [Fact]
    public async Task RevokeReturnsFalseOnServerErrorOrMissingToken()
    {
        Assert.False(await Client(new CapturingHandler(HttpStatusCode.InternalServerError)).RevokeAsync("x", CancellationToken.None));
        Assert.False(await Client(new CapturingHandler(HttpStatusCode.OK)).RevokeAsync(null, CancellationToken.None));
    }
}
