using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AP_Master.Server.Middleware;

/// <summary>
/// The controllers' [Produces("application/json")] also applies to the framework's own validation
/// errors, which would otherwise go out as plain JSON. This runs after it and restores the RFC 7807
/// content type, so every error the API returns is application/problem+json.
/// </summary>
public sealed class ProblemDetailsContentTypeFilter : IResultFilter, IOrderedFilter
{
    // Result filters with a higher order run later, so this wins over [Produces].
    public int Order => int.MaxValue;

    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is ObjectResult { Value: ProblemDetails } result)
        {
            result.ContentTypes.Clear();
            result.ContentTypes.Add("application/problem+json");
        }
    }

    public void OnResultExecuted(ResultExecutedContext context)
    {
    }
}
