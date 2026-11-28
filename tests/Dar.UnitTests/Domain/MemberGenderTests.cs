using Dar.Common.Domain;
using Xunit;

namespace Dar.UnitTests.Domain;

public sealed class MemberGenderTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("male", "male")]
    [InlineData("FEMALE", "female")]
    [InlineData(" Male ", "male")]
    public void TryNormalize_accepts_null_empty_or_male_female(string? input, string? expected)
    {
        var ok = MemberGender.TryNormalize(input, out var normalized);
        Assert.True(ok);
        Assert.Equal(expected, normalized);
        Assert.False(MemberGender.IsInvalid(input));
    }

    [Theory]
    [InlineData("other")]
    [InlineData("unknown")]
    [InlineData("m")]
    [InlineData("123")]
    public void TryNormalize_rejects_invalid_gender_values(string input)
    {
        var ok = MemberGender.TryNormalize(input, out var normalized);
        Assert.False(ok);
        Assert.Null(normalized);
        Assert.True(MemberGender.IsInvalid(input));
    }
}
