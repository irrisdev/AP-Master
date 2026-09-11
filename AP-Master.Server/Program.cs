


using AP_Master.Server.Data;
using AP_Master.Server.Properties;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);


// Add controllers
builder.Services.AddControllers();

// Map swagger and OpenAPI for API documentation
builder.Services.AddOpenApi();

builder.Services.AddDbContext<TelegroupDbContext>(options =>
{
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection"));
});

// Dependency injection for application services
builder.Services.AddApplicationServices();

// Cors to allow React frontend to communicate with API
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowAnyOrigin();
    });
});

var app = builder.Build();

app.UseExceptionHandler();

app.UseDefaultFiles();
app.MapStaticAssets();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/openapi/v1.json", "Telegroup API V1");
    });
    app.MapScalarApiReference();
    
    // Ensure database is created and migrations are applied during development
    using (var scope = app.Services.CreateScope())
    {
        var dbContext = scope.ServiceProvider.GetRequiredService<TelegroupDbContext>();
        dbContext.Database.EnsureCreated();
        dbContext.Database.Migrate();
    }

}

app.UseHttpsRedirection();

app.UseAuthorization();

app.UseCors("Frontend");

app.MapControllers();

app.MapFallbackToFile("/index.html");

app.Run();
