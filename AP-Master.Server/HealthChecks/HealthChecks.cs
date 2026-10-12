using System.Text.Json;
using AP_Master.Server.Concurrency;
using AP_Master.Server.Data;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace AP_Master.Server.HealthChecks;

/// <summary>Healthy if the database answers.</summary>
public class DatabaseHealthCheck : IHealthCheck
{
    private readonly TelegroupDbContext _dbContext;

    public DatabaseHealthCheck(TelegroupDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _dbContext.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy("Database reachable.")
                : HealthCheckResult.Unhealthy("Database not reachable.");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Database check failed.", ex);
        }
    }
}

/// <summary>Degraded while every AI slot is busy: requests are queueing or falling back.</summary>
public class AIGateHealthCheck : IHealthCheck
{
    private readonly AIRequestGate _gate;

    public AIGateHealthCheck(AIRequestGate gate)
    {
        _gate = gate;
    }

    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var data = new Dictionary<string, object> { ["inUse"] = _gate.InUse, ["capacity"] = _gate.Capacity };

        return Task.FromResult(_gate.InUse >= _gate.Capacity
            ? HealthCheckResult.Degraded("All AI slots are in use.", data: data)
            : HealthCheckResult.Healthy("AI slots available.", data));
    }
}

public static class HealthCheckResponse
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>Writes the overall status plus each check, so /health is useful to a person as well as a probe.</summary>
    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        context.Response.ContentType = "application/json";

        var body = new
        {
            status = report.Status.ToString(),
            durationMs = Math.Round(report.TotalDuration.TotalMilliseconds, 1),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
                data = e.Value.Data.Count > 0 ? e.Value.Data : null
            })
        };

        return context.Response.WriteAsync(JsonSerializer.Serialize(body, Json));
    }
}
