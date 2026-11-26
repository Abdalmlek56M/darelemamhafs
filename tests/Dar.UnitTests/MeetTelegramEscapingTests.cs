using Dar.Modules.Meet.Workers;

namespace Dar.UnitTests;

public sealed class MeetTelegramEscapingTests
{
    [Theory]
    [InlineData("normal", "normal")]
    [InlineData("<b>injected</b>", "&lt;b&gt;injected&lt;/b&gt;")]
    [InlineData("a & b", "a &amp; b")]
    [InlineData(null, "")]
    public void AlertTextIsHtmlEscaped(string? input, string expected)
        => Assert.Equal(expected, MeetAlertNotifier.EscapeTelegramHtml(input));
}
