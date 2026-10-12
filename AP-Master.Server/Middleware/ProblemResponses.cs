using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Middleware;

/// <summary>
/// Writes RFC 7807 ProblemDetails responses with the request's trace ID, so every error the API
/// produces (exceptions, rate limiting, unknown routes) has the same shape.
/// </summary>
public static class ProblemResponses
{
    public static async Task WriteAsync(HttpContext context, int status, string title, string detail,
        CancellationToken cancellationToken = default)
    {
        if (context.Response.HasStarted)
            return;

        context.Response.StatusCode = status;

        var problem = new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = detail,
            Instance = context.Request.Path
        };
        problem.Extensions["traceId"] = context.TraceIdentifier;

        await context.Response.WriteAsJsonAsync(problem, options: null, contentType: "application/problem+json",
            cancellationToken: cancellationToken);
    }
}
