using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Domain;

namespace Dar.UnitTests.Meet;

/// <summary>Smart linking and the recording-scope rules that decide what the bot records.</summary>
public class MeetRuleTests
{
    private static readonly Guid CircleId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static IReadOnlyList<(Guid Id, string Name)> Circles() =>
    [
        (CircleId, "حلقة النور"),
        (OtherId, "حلقة الفرقان")
    ];

    [Fact]
    public void MatchesCircleNameInsideSummary()
    {
        var match = MeetCircleMatcher.Best("حلقة النور - الأسبوع 3", Circles());

        Assert.NotNull(match);
        Assert.Equal(100, match!.Confidence);
        Assert.Equal(CircleId, match.CircleId);
    }

    [Fact]
    public void PartialTokenOverlapGivesLowerConfidence()
    {
        var match = MeetCircleMatcher.Best("النور", Circles());

        Assert.NotNull(match);
        Assert.Equal(CircleId, match!.CircleId);
        Assert.True(match.Confidence < 100);
    }

    [Fact]
    public void NormalizesArabicDiacriticsAndLetterVariants()
    {
        Assert.Equal(MeetCircleMatcher.Normalize("حَلْقَةُ النُّور"), MeetCircleMatcher.Normalize("حلقه النور"));
        Assert.Equal("احمد", MeetCircleMatcher.Normalize("أَحْمَد"));
        Assert.Equal("مصطفي", MeetCircleMatcher.Normalize("مصطفى"));
    }

    [Fact]
    public void NoSuggestionForEmptyOrUnrelatedSummaries()
    {
        Assert.Null(MeetCircleMatcher.Best(null, Circles()));
        Assert.Null(MeetCircleMatcher.Best("تذكير بموعد", Circles()));
        Assert.Null(MeetCircleMatcher.Best("حلقة النور", []));
    }

    [Fact]
    public void PrefersTheMostSpecificCircleWhenNamesOverlap()
    {
        var circles = new List<(Guid, string)>
        {
            (CircleId, "حلقة النور"),
            (OtherId, "حلقة النور للمبتدئات")
        };

        var match = MeetCircleMatcher.Best("حلقة النور للمبتدئات - الحصة الأولى", circles);

        Assert.NotNull(match);
        Assert.Equal(OtherId, match!.CircleId);
        Assert.Equal(100, match.Confidence);
    }

    [Theory]
    [InlineData("inherit", true, true, "confirmed", true)]
    [InlineData("inherit", true, false, "confirmed", false)]
    [InlineData("inherit", false, true, "confirmed", false)]
    [InlineData("force", false, false, "confirmed", true)]
    [InlineData("exclude", true, true, "confirmed", false)]
    [InlineData("force", true, true, "cancelled", false)]
    public void RecordingEligibilityFollowsOwnerScope(
        string mode,
        bool linked,
        bool circleAutoRecord,
        string status,
        bool expected)
    {
        Assert.Equal(expected, MeetRecordingPolicy.IsEligible(mode, linked, circleAutoRecord, status));
    }

    [Fact]
    public void UnknownRecordingModesAreRejected()
    {
        Assert.True(MeetRecordingPolicy.IsKnownMode("inherit"));
        Assert.True(MeetRecordingPolicy.IsKnownMode("force"));
        Assert.True(MeetRecordingPolicy.IsKnownMode("exclude"));
        Assert.False(MeetRecordingPolicy.IsKnownMode("always"));
        Assert.False(MeetRecordingPolicy.IsKnownMode(null));
    }

    [Fact]
    public void JobStateMachineOnlyAllowsDeclaredTransitions()
    {
        Assert.True(MeetJobStates.CanTransition(MeetJobStates.Scheduled, MeetJobStates.Joining));
        Assert.True(MeetJobStates.CanTransition(MeetJobStates.Live, MeetJobStates.Finalizing));
        Assert.True(MeetJobStates.CanTransition(MeetJobStates.Finalizing, MeetJobStates.Uploading));
        Assert.True(MeetJobStates.CanTransition(MeetJobStates.Uploading, MeetJobStates.Ready));
        Assert.False(MeetJobStates.CanTransition(MeetJobStates.Ready, MeetJobStates.Live));
        Assert.False(MeetJobStates.CanTransition(MeetJobStates.Cancelled, MeetJobStates.Joining));
        Assert.False(MeetJobStates.CanTransition(null, MeetJobStates.Joining));
        Assert.True(MeetJobStates.IsTerminal(MeetJobStates.Ready));
        Assert.False(MeetJobStates.IsTerminal(MeetJobStates.Live));
    }
}
