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
    }
}
