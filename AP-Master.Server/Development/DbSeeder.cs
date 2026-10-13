using AP_Master.Server.Data;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Development;

public class DbSeeder
{
    public static async Task SeedAsync(TelegroupDbContext db)
    {
        // Seed database with initial data
        if (!await db.Customers.AnyAsync())
        {
            db.Customers.AddRange(
                new Customer { Name = "John Doe", Email = "johndoe@example.com" },
                new Customer { Name = "Sarah Jones", Email = "sarahjones@example.com" },
                new Customer { Name = "Sophie Smith", Email = "sophiesmith@example.com" },
                new Customer { Name = "Michael Brown", Email = "michaelbrown@example.com" },
                new Customer { Name = "Emily Davis", Email = "emilydavis@example.com" }
            );

            await db.SaveChangesAsync();
        }

        // Checked separately, so an existing database with customers still gets the packages
        if (!await db.BroadbandPackages.AnyAsync())
        {
            db.BroadbandPackages.AddRange(BroadbandPackages());
            await db.SaveChangesAsync();
        }
    }

    public static void Seed(TelegroupDbContext db)
    {
        // Seed database with initial data
        if (!db.Customers.Any())
        {
            db.Customers.AddRange(
                new Customer { Name = "John Doe", Email = "johndoe@example.com" },
                new Customer { Name = "Sarah Jones", Email = "sarahjones@example.com" },
                new Customer { Name = "Sophie Smith", Email = "sophiesmith@example.com" },
                new Customer { Name = "Michael Brown", Email = "michaelbrown@example.com" },
                new Customer { Name = "Emily Davis", Email = "emilydavis@example.com" }
            );

            db.SaveChanges();
        }

        if (!db.BroadbandPackages.Any())
        {
            db.BroadbandPackages.AddRange(BroadbandPackages());
            db.SaveChanges();
        }
    }

    /// <summary>The demo catalogue. Fictional packages and prices, for the assistant to quote.</summary>
    private static BroadbandPackage[] BroadbandPackages() =>
    [
        new() { Name = "Essential 36", DownloadMbps = 36, UploadMbps = 9, MonthlyPrice = 24.99m, ContractMonths = 24,
                Description = "Our entry-level fibre package, suited to browsing, email and streaming on one or two devices." },
        new() { Name = "Fibre 150", DownloadMbps = 150, UploadMbps = 30, MonthlyPrice = 29.99m, ContractMonths = 24,
                Description = "Suited to a family streaming and video calling at the same time." },
        new() { Name = "Full Fibre 500", DownloadMbps = 500, UploadMbps = 75, MonthlyPrice = 39.99m, ContractMonths = 24,
                Description = "Includes a Wi-Fi 6 hub. Suited to busy homes, gaming and large downloads." },
        new() { Name = "Full Fibre 900", DownloadMbps = 900, UploadMbps = 110, MonthlyPrice = 49.99m, ContractMonths = 24,
                Description = "Includes a Wi-Fi 6 hub and a Wi-Fi booster. Our fastest package." },
        new() { Name = "Flex 150", DownloadMbps = 150, UploadMbps = 30, MonthlyPrice = 34.99m, ContractMonths = 1,
                Description = "The same speed as Fibre 150 on a rolling one-month contract, with no long-term commitment." }
    ];
}
