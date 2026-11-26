using Dar.Common.Migrations;

namespace Dar.UnitTests;

/// <summary>FINAL 1.16: line-ending changes must not change a migration checksum.</summary>
public sealed class MigrationChecksumTests
{
    [Fact]
    public void CrlfAndLfProduceTheSameChecksum()
    {
        var lf = "CREATE TABLE x(id int);\n-- two\nSELECT 1;\n";
        var crlf = lf.Replace("\n", "\r\n");
        Assert.Equal(MigrationChecksum.Compute(lf), MigrationChecksum.Compute(crlf));
    }

    [Fact]
    public void NormalizeLineEndingsKeepsContent()
    {
        Assert.Equal("a\nb\nc", MigrationChecksum.NormalizeLineEndings("a\r\nb\rc"));
    }

    [Fact]
    public void DifferentContentProducesDifferentChecksum()
    {
        Assert.NotEqual(MigrationChecksum.Compute("SELECT 1;"), MigrationChecksum.Compute("SELECT 2;"));
    }
}
