using Dar.Common.Pagination;

namespace Dar.UnitTests.Pagination;

public sealed class PaginationTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void PageRequest_NormalizesPageBelowOne(int page)
    {
        var request = new PageRequest(page, 25);
        Assert.Equal(1, request.Page);
        Assert.Equal(0, request.Offset);
    }

    [Theory]
    [InlineData(0, PageRequest.DefaultPageSize)]
    [InlineData(-1, PageRequest.DefaultPageSize)]
    [InlineData(101, PageRequest.MaxPageSize)]
    [InlineData(1000, PageRequest.MaxPageSize)]
    public void PageRequest_NormalizesPageSize(int requested, int expected)
    {
        var request = new PageRequest(1, requested);
        Assert.Equal(expected, request.PageSize);
    }

    [Fact]
    public void PageRequest_UsesDefaultPageSizeWhenMissing()
    {
        var request = new PageRequest(1);
        Assert.Equal(PageRequest.DefaultPageSize, request.PageSize);
    }

    [Fact]
    public void PageResult_TotalZero_HasNoPages()
    {
        var result = new PageResult<string>([], 1, 25, 0);
        Assert.Equal(0, result.TotalPages);
        Assert.False(result.HasNextPage);
        Assert.False(result.HasPreviousPage);
    }

    [Fact]
    public void PageResult_LastPageIsPartial_ReportsCorrectTotals()
    {
        var result = new PageResult<string>(["row"], 5, 25, 101);
        Assert.Equal(5, result.TotalPages);
        Assert.Equal(1, result.Items.Count);
        Assert.False(result.HasNextPage);
        Assert.True(result.HasPreviousPage);
    }

    [Fact]
    public void PageResult_HasNextPageBeforeLast()
    {
        var result = new PageResult<string>([], 1, 25, 50);
        Assert.Equal(2, result.TotalPages);
        Assert.True(result.HasNextPage);
        Assert.False(result.HasPreviousPage);
    }
}
    [Fact]
    public void PageRequest_MaxIntPage_OffsetStaysPositive()
    {
        var request = new PageRequest(int.MaxValue, PageRequest.MaxPageSize);
        Assert.True(request.Offset > 0);
        Assert.Equal(((long)int.MaxValue - 1) * PageRequest.MaxPageSize, request.Offset);
    }

