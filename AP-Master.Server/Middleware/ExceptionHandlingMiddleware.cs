using AP_Master.Server.Exceptions;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Middleware;

/// <summary>
/// Converts exceptions into consistent ProblemDetails responses.
/// Expected errors (ApiException) return their own status and message;
/// everything else is logged in full and returned as a generic 500 with no internal detail.
/// </summary>
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (ApiException ex)
        {
            _logger.LogWarning("{Title}: {Message} ({Method} {Path})",
                ex.Title, ex.Message, context.Request.Method, context.Request.Path);

            await WriteProblemAsync(context, ex.StatusCode, ex.Title, ex.Message);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client disconnected; there is nobody to send a response to.
            _logger.LogInformation("Request cancelled by client ({Method} {Path})",
                context.Request.Method, context.Request.Path);
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "Database update failed ({Method} {Path})",
                context.Request.Method, context.Request.Path);

            await WriteProblemAsync(context, StatusCodes.Status500InternalServerError,
                "Database error", "The request could not be saved. Please try again later.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception ({Method} {Path})",
                context.Request.Method, context.Request.Path);

            await WriteProblemAsync(context, StatusCodes.Status500InternalServerError,
                "Server error", "An unexpected error occurred. Please try again later.");
        }
    }

    private static Task WriteProblemAsync(HttpContext context, int status, string title, string detail)
    {
        if (context.Response.HasStarted)
            return Task.CompletedTask;

        // Discard anything a handler set before it failed (headers, partial content type).
        context.Response.Clear();
        return ProblemResponses.WriteAsync(context, status, title, detail);
    }
}
