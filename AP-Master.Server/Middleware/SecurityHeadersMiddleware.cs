namespace AP_Master.Server.Middleware;

/// <summary>
/// Adds standard browser security headers to every response: no MIME sniffing, no framing
/// (clickjacking), no referrer leakage, and no access to device features the app never uses.
/// </summary>
public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            return Task.CompletedTask;
        });

        return _next(context);
    }
}
