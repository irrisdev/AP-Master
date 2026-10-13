using AP_Master.Server.Concurrency;
using AP_Master.Server.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace AP_Server_Tests.TestSupport;

/// <summary>
/// Hosts the real application in memory (the full middleware pipeline, controllers, EF Core,
/// rate limiting and SignalR) against a throwaway SQLite file. Only the AI provider is replaced,
/// and it still sits behind the real concurrency-limiting decorator.
/// </summary>
public class TelegroupApiFactory : WebApplicationFactory<Program>
{
    private readonly string _databasePath =
        Path.Combine(Path.GetTempPath(), $"telegroup-tests-{Guid.NewGuid():N}.db");

    public ScriptedAIService AI { get; } = new();

    /// <summary>Configuration for the test host. Override to change limits for a particular test class.</summary>
    protected virtual IReadOnlyDictionary<string, string> Settings => new Dictionary<string, string>
    {
        ["ConnectionStrings:DefaultConnection"] = $"Data Source={_databasePath}",
        ["AI:ApiKey"] = "",
        ["AI:MaxConcurrentRequests"] = "8",
        ["AI:QueueTimeoutSeconds"] = "10",
        // Generous limits so functional tests never trip them; RateLimitingTests uses its own factory.
        ["RateLimiting:Api:TokenLimit"] = "10000",
        ["RateLimiting:Api:TokensPerPeriod"] = "10000",
        ["RateLimiting:Chat:TokenLimit"] = "10000",
        ["RateLimiting:Chat:TokensPerPeriod"] = "10000",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        foreach (var (key, value) in Settings)
            builder.UseSetting(key, value);

        builder.ConfigureLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IAIService>();
            services.AddScoped<IAIService>(provider => new ConcurrencyLimitedAIService(
                AI,
                provider.GetRequiredService<AIRequestGate>(),
                provider.GetRequiredService<ILogger<ConcurrencyLimitedAIService>>()));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (!disposing)
            return;

        SqliteConnection.ClearAllPools();
        foreach (var suffix in new[] { "", "-shm", "-wal" })
            File.Delete(_databasePath + suffix);
    }
}
