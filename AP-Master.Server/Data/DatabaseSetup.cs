using AP_Master.Server.Development;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Data;

/// <summary>Bound from the "Database" section of configuration.</summary>
public class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>Apply pending EF Core migrations at start-up, so a fresh deployment gets its schema.</summary>
    public bool MigrateOnStartup { get; set; } = true;

    /// <summary>Insert the demo customers if the database has none.</summary>
    public bool SeedDemoData { get; set; } = true;
}

public static class DatabaseSetup
{
    /// <summary>
    /// Makes a SQLite connection string work the same on every OS and from any working directory:
    /// a relative path is resolved against the app's content root, Windows-style separators are
    /// accepted on macOS/Linux, and the folder is created if it doesn't exist.
    /// </summary>
    public static string ResolveSqliteConnectionString(string? configured, string contentRootPath)
    {
        if (string.IsNullOrWhiteSpace(configured))
            throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");

        var builder = new SqliteConnectionStringBuilder(configured);
        var dataSource = builder.DataSource;

        if (string.IsNullOrWhiteSpace(dataSource) || dataSource == ":memory:" || builder.Mode == SqliteOpenMode.Memory)
            return builder.ToString();

        // "Development\Data\telegroup.db" on macOS/Linux would otherwise be a single file with backslashes in its name.
        if (Path.DirectorySeparatorChar == '/')
            dataSource = dataSource.Replace('\\', '/');

        var fullPath = Path.GetFullPath(Path.IsPathRooted(dataSource) ? dataSource : Path.Combine(contentRootPath, dataSource));
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        builder.DataSource = fullPath;
        return builder.ToString();
    }

    /// <summary>Applies migrations and seeds demo data, as configured. Runs once at start-up.</summary>
    public static async Task InitialiseAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        using var scope = services.CreateScope();
        var options = scope.ServiceProvider.GetRequiredService<IConfiguration>()
                          .GetSection(DatabaseOptions.SectionName).Get<DatabaseOptions>() ?? new DatabaseOptions();
        var dbContext = scope.ServiceProvider.GetRequiredService<TelegroupDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(DatabaseSetup));

        if (options.MigrateOnStartup)
        {
            var pending = (await dbContext.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
            await dbContext.Database.MigrateAsync(cancellationToken);

            if (pending.Count > 0)
                logger.LogInformation("Applied {Count} database migration(s): {Migrations}", pending.Count, string.Join(", ", pending));
        }

        if (options.SeedDemoData)
            await DbSeeder.SeedAsync(dbContext);
    }
}
