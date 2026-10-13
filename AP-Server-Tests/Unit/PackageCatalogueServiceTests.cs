using AP_Master.Server.Models;
using AP_Master.Server.Services;
using AP_Server_Tests.TestSupport;
using Microsoft.Extensions.Logging.Abstractions;

namespace AP_Server_Tests.Unit;

public class PackageCatalogueServiceTests : IDisposable
{
    private readonly TestDatabase _database = new();
    private readonly PackageCatalogueService _service;

    public PackageCatalogueServiceTests()
    {
        _service = new PackageCatalogueService(_database.Context, NullLogger<PackageCatalogueService>.Instance);
    }

    public void Dispose() => _database.Dispose();

    [Fact]
    public async Task GetPromptContext_ListsTheSeededPackages_SlowestFirst()
    {
        var context = await _service.GetPromptContextAsync();

        Assert.NotNull(context);
        var lines = context.Split('\n', StringSplitOptions.TrimEntries);
        Assert.Equal(5, lines.Length);
        Assert.StartsWith("- Essential 36:", lines[0]);
        Assert.StartsWith("- Full Fibre 900:", lines[^1]);
    }

    [Fact]
    public async Task GetPromptContext_LeavesOutPackagesNoLongerOnSale()
    {
        var withdrawn = _database.Context.BroadbandPackages.Single(p => p.Name == "Flex 150");
        withdrawn.IsAvailable = false;
        await _database.Context.SaveChangesAsync();

        var context = await _service.GetPromptContextAsync();

        Assert.DoesNotContain("Flex 150", context);
        Assert.Contains("Fibre 150", context);
    }

    [Fact]
    public async Task GetPromptContext_WithNoPackages_ReturnsNull()
    {
        _database.Context.BroadbandPackages.RemoveRange(_database.Context.BroadbandPackages);
        await _database.Context.SaveChangesAsync();

        Assert.Null(await _service.GetPromptContextAsync());
    }

    [Fact]
    public void Describe_GivesSpeedsPriceInPoundsAndContract()
    {
        var package = new BroadbandPackage
        {
            Name = "Fibre 150", DownloadMbps = 150, UploadMbps = 30, MonthlyPrice = 29.99m, ContractMonths = 24,
            Description = "  Suited to a family.  "
        };

        Assert.Equal(
            "- Fibre 150: 150 Mbps download, 30 Mbps upload, £29.99 a month, 24-month contract. Suited to a family.",
            PackageCatalogueService.Describe(package));
    }

    [Fact]
    public void Describe_WithoutADescription_EndsAfterTheContract()
    {
        var package = new BroadbandPackage { Name = "Basic", DownloadMbps = 10, UploadMbps = 1, MonthlyPrice = 20m, ContractMonths = 12 };

        Assert.Equal("- Basic: 10 Mbps download, 1 Mbps upload, £20.00 a month, 12-month contract.",
            PackageCatalogueService.Describe(package));
    }
}
