using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace AP_Master.Server.Middleware;

/// <summary>Token-bucket settings: a client may burst up to TokenLimit requests, then gets TokensPerPeriod more every PeriodSeconds.</summary>
public class TokenBucketSettings
{
    public int TokenLimit { get; set; }
    public int TokensPerPeriod { get; set; }
    public int PeriodSeconds { get; set; }

    public TokenBucketRateLimiterOptions ToLimiterOptions() => new()
    {
        TokenLimit = Math.Max(1, TokenLimit),
        TokensPerPeriod = Math.Max(1, TokensPerPeriod),
        ReplenishmentPeriod = TimeSpan.FromSeconds(Math.Max(1, PeriodSeconds)),
        AutoReplenishment = true,
        QueueLimit = 0 // reject straight away with a Retry-After rather than hold connections open
    };
}

/// <summary>Bound from the "RateLimiting" section of configuration.</summary>
public class RateLimitingOptions
{
    public const string SectionName = "RateLimiting";

    public bool Enabled { get; set; } = true;

    /// <summary>Applies to every /api request, per client IP.</summary>
    public TokenBucketSettings Api { get; set; } = new() { TokenLimit = 120, TokensPerPeriod = 60, PeriodSeconds = 30 };

    /// <summary>Applies to POST /api/chat on top of the API limit, per client IP. Each chat turn can call the AI.</summary>
    public TokenBucketSettings Chat { get; set; } = new() { TokenLimit = 15, TokensPerPeriod = 5, PeriodSeconds = 20 };
}

public static class RateLimitPolicies
{
    public const string Chat = "chat";
}

public static class RateLimitingSetup
{
    /// <summary>
    /// Two layers, both partitioned by client IP so one busy client cannot starve the others:
    /// a general limit on the whole API, and a tighter one on chat because every chat turn can
    /// cost an AI call. Rejections are 429 ProblemDetails with a Retry-After header.
    /// </summary>
    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(RateLimitingOptions.SectionName).Get<RateLimitingOptions>()
                      ?? new RateLimitingOptions();

        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            limiter.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                options.Enabled && context.Request.Path.StartsWithSegments("/api")
                    ? RateLimitPartition.GetTokenBucketLimiter($"api:{ClientKey(context)}", _ => options.Api.ToLimiterOptions())
                    : RateLimitPartition.GetNoLimiter("unlimited"));

            limiter.AddPolicy(RateLimitPolicies.Chat, context =>
                options.Enabled
                    ? RateLimitPartition.GetTokenBucketLimiter($"chat:{ClientKey(context)}", _ => options.Chat.ToLimiterOptions())
                    : RateLimitPartition.GetNoLimiter("unlimited"));

            limiter.OnRejected = async (context, cancellationToken) =>
            {
                var http = context.HttpContext;
                var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait)
                    ? (int)Math.Ceiling(wait.TotalSeconds)
                    : (int?)null;

                if (retryAfter.HasValue)
                    http.Response.Headers.RetryAfter = retryAfter.Value.ToString(CultureInfo.InvariantCulture);

                http.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("AP_Master.Server.RateLimiting")
                    .LogWarning("Rate limit exceeded for {Client} ({Method} {Path})",
                        ClientKey(http), http.Request.Method, http.Request.Path);

                var detail = retryAfter.HasValue
                    ? $"You're sending requests too quickly. Please wait {retryAfter} seconds and try again."
                    : "You're sending requests too quickly. Please wait a moment and try again.";

                await ProblemResponses.WriteAsync(http, StatusCodes.Status429TooManyRequests, "Too many requests", detail,
                    cancellationToken);
            };
        });

        return services;
    }

    // Behind a reverse proxy this would be the proxy's address; enable ForwardedHeaders there.
    private static string ClientKey(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}
