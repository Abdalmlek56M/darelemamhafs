using System.IO.Pipes;
using Xunit;

namespace Dar.IntegrationTests.Schedule;

/// <summary>
/// A [Fact] that skips itself when the Docker daemon is not reachable, so local
/// sandbox runs stay green while CI (which has Docker) executes the real race test.
/// </summary>
public sealed class DockerFactAttribute : FactAttribute
{
    private static readonly Lazy<bool> DockerAvailable = new(DetectDocker);

    public DockerFactAttribute()
    {
        if (!DockerAvailable.Value)
            Skip = "Docker daemon is not available; the schedule-race test runs in CI.";
    }

    private static bool DetectDocker()
    {
        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DOCKER_HOST"))) return true;
        if (!OperatingSystem.IsWindows())
            return File.Exists("/var/run/docker.sock") || File.Exists("/run/docker.sock");
        foreach (var pipeName in new[] { "docker_engine", "dockerDesktopLinuxEngine" })
        {
            try
            {
                using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out);
                client.Connect(250);
                return true;
            }
            catch
            {
                // Named pipes are blocked in the local sandbox and may be absent without Docker.
            }
        }
        return false;
    }
}
