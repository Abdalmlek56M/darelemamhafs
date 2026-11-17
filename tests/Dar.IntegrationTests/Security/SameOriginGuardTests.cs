using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Dar.IntegrationTests.Security;

public sealed class SameOriginGuardTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task CrossOriginUnsafeRequest_ReturnsForbidden()
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/email/request")
        {
            Content = JsonContent.Create(new { email = "review@example.com" })
        };
        request.Headers.Add("Origin", "https://evil.example");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task NullOriginUnsafeRequest_ReturnsForbidden()
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/email/request")
        {
            Content = JsonContent.Create(new { email = "review@example.com" })
        };
        request.Headers.Add("Origin", "null");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task ConfiguredDevelopmentOrigin_IsAllowed()
    {
        using var configured = factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?> { ["Security:AllowedOrigins:0"] = "http://localhost:5173" })));
        using var client = configured.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/email/request")
        {
            Content = JsonContent.Create(new { email = "vite@example.com" })
        };
        request.Headers.Add("Origin", "http://localhost:5173");

        var response = await client.SendAsync(request);

        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
