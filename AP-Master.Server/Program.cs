using AP_Master.Server.Data;
using AP_Master.Server.HealthChecks;
using AP_Master.Server.Hubs;
using AP_Master.Server.Middleware;
using AP_Master.Server.Properties;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Add controllers; every error response, including validation failures, is application/problem+json
builder.Services.AddControllers(options => options.Filters.Add(new ProblemDetailsContentTypeFilter()));

// Map swagger and OpenAPI for API documentation
builder.Services.AddOpenApi();

// SQLite, with the path resolved the same way on every OS (see DatabaseSetup)
var connectionString = DatabaseSetup.ResolveSqliteConnectionString(
    builder.Configuration.GetConnectionString("DefaultConnection"), builder.Environment.ContentRootPath);
builder.Services.AddDbContext<TelegroupDbContext>(options => options.UseSqlite(connectionString));

// Application services, SignalR and health checks
builder.Services.AddApplicationServices();

// AI provider (real or placeholder), behind a server-wide concurrency limit
builder.Services.AddAIServices(builder.Configuration);

// Per-client rate limits on the API, with a tighter one on chat
builder.Services.AddApiRateLimiting(builder.Configuration);

// CORS for a frontend served from another origin. In development the Vite proxy makes the SPA
// same-origin, so this only matters if the client is hosted separately.
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()); // SignalR sends credentials on cross-origin connections
});

var app = builder.Build();

app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseMiddleware<SecurityHeadersMiddleware>();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.UseHttpsRedirection();

app.UseDefaultFiles();
app.MapStaticAssets();

// API documentation, development only
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/openapi/v1.json", "Telegroup API V1");
    });
    app.MapScalarApiReference();
}

app.UseCors("Frontend");

app.UseRateLimiter();

app.UseAuthorization();

app.MapHealthChecks("/health", new HealthCheckOptions { ResponseWriter = HealthCheckResponse.WriteAsync });

app.MapControllers();

app.MapHub<StaffHub>(StaffHub.Path);

// Unknown API routes are a JSON 404, not the SPA's index.html.
app.MapFallback("/api/{**path}", context => ProblemResponses.WriteAsync(context, StatusCodes.Status404NotFound,
    "Resource not found", $"No API endpoint matches {context.Request.Method} {context.Request.Path}."));

app.MapFallbackToFile("/index.html");

// Apply migrations and seed demo data before accepting requests (configurable under "Database").
await DatabaseSetup.InitialiseAsync(app.Services);

app.Run();

/// <summary>Exposed so integration tests can host the app with WebApplicationFactory.</summary>
public partial class Program;
