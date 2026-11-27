using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dar.UnitTests;

/// <summary>FINAL 1.15: OTP delivery runs through the queue, not inline on the request thread.</summary>
public sealed class EmailQueueTests
{
    private sealed class FakeSender : IEmailSender
    {
        public List<(string Email, string Code)> Sent { get; } = [];
        public Exception? Throw { get; set; }

        public Task SendLoginCodeAsync(string email, string code, CancellationToken ct)
        {
            if (Throw is not null) throw Throw;
            Sent.Add((email, code));
            return Task.CompletedTask;
        }
    }

    private static EmailQueue Queue() =>
        new(new ServiceCollection().BuildServiceProvider(), NullLogger<EmailQueue>.Instance);

    [Fact]
    public async Task DeliversQueuedCodeThroughTheSender()
    {
        var queue = Queue();
        var sender = new FakeSender();
        Assert.True(queue.Enqueue("a@example.invalid", "123456"));
        Assert.True(await queue.ProcessOnceAsync(sender, CancellationToken.None));
        Assert.Equal(("a@example.invalid", "123456"), sender.Sent.Single());
        Assert.False(await queue.ProcessOnceAsync(sender, CancellationToken.None));
    }

    [Fact]
    public async Task ATransportFailureDoesNotCrashTheWorker()
    {
        var queue = Queue();
        var sender = new FakeSender { Throw = new InvalidOperationException("smtp down") };
        Assert.True(queue.Enqueue("a@example.invalid", "654321"));
        Assert.False(await queue.ProcessOnceAsync(sender, CancellationToken.None));
    }
}
