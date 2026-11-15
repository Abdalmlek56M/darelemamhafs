namespace Dar.Modules.Identity.Abstractions;

public interface IEmailSender
{
    Task SendLoginCodeAsync(string email, string code, CancellationToken ct);
}

public sealed class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string From { get; set; } = "";
    public bool EnableSsl { get; set; } = true;
}
