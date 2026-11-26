using Dar.Modules.Meet.Application;

namespace Dar.UnitTests.Meet;

/// <summary>FINAL 1.9: auto-link must never match a name inside another word or guess when ambiguous.</summary>
public sealed class MeetMatcherAmbiguityTests
{
    private static readonly Guid A = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid B = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void ShortNameDoesNotMatchInsideAnotherWord()
    {
        var circles = new List<(Guid, string)> { (A, "نور") };
        var match = MeetCircleMatcher.Best("النور", circles);
        Assert.True(match is null || match.Confidence < 100);
    }

    [Fact]
    public void ExactPhraseInsideSummaryStillScoresFullConfidence()
    {
        var circles = new List<(Guid, string)> { (A, "حلقة النور") };
        var match = MeetCircleMatcher.BestUnambiguous("حلقة النور - الأسبوع 3", circles);
        Assert.NotNull(match);
        Assert.Equal(100, match!.Confidence);
        Assert.Equal(A, match.CircleId);
    }

    [Fact]
    public void TwoExactMatchesAreNotAutoLinked()
    {
        var circles = new List<(Guid, string)> { (A, "حلقة النور"), (B, "حلقة النور") };
        Assert.Null(MeetCircleMatcher.BestUnambiguous("حلقة النور - الأسبوع 3", circles));
    }
}
