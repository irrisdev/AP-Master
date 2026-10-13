using System.Globalization;
using System.Text;
using AP_Master.Server.Data;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

public interface IPackageCatalogueService
{
    /// <summary>
    /// The packages currently on sale, one per line, ready to put in an AI prompt.
    /// Null if there are none, so the caller can tell the AI it has no catalogue.
    /// </summary>
    Task<string?> GetPromptContextAsync(CancellationToken cancellationToken = default);
}

/// <summary>Reads Telegroup's broadband packages so the assistant can quote them accurately.</summary>
public class PackageCatalogueService : IPackageCatalogueService
{
    private static readonly CultureInfo UkCulture = CultureInfo.GetCultureInfo("en-GB");

    private readonly TelegroupDbContext _dbContext;
    private readonly ILogger<PackageCatalogueService> _logger;

    public PackageCatalogueService(TelegroupDbContext dbContext, ILogger<PackageCatalogueService> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<string?> GetPromptContextAsync(CancellationToken cancellationToken = default)
    {
        // Ordered by speed rather than price: SQLite stores decimals as text, so EF can't sort them in SQL.
        var packages = await _dbContext.BroadbandPackages
            .AsNoTracking()
            .Where(p => p.IsAvailable)
            .OrderBy(p => p.DownloadMbps)
            .ToListAsync(cancellationToken);

        if (packages.Count == 0)
        {
            _logger.LogWarning("No broadband packages are available; the assistant will not quote any");
            return null;
        }

        var lines = new StringBuilder();
        foreach (var package in packages)
            lines.AppendLine(Describe(package));

        return lines.ToString().TrimEnd();
    }

    /// <summary>For example "- Fibre 150: 150 Mbps download, 30 Mbps upload, £29.99 a month, 24-month contract."</summary>
    public static string Describe(BroadbandPackage package)
    {
        var line = string.Format(UkCulture, "- {0}: {1} Mbps download, {2} Mbps upload, {3:C} a month, {4}-month contract.",
            package.Name, package.DownloadMbps, package.UploadMbps, package.MonthlyPrice, package.ContractMonths);

        return string.IsNullOrWhiteSpace(package.Description) ? line : $"{line} {package.Description.Trim()}";
    }
}
