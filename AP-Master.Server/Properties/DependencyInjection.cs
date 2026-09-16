using AP_Master.Server.Exceptions;
using AP_Master.Server.Services;
using System.Runtime.CompilerServices;

namespace AP_Master.Server.Properties;

public static class DependencyInjection
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        services.AddProblemDetails();
        services.AddExceptionHandler<GlobalExceptionHandler>();

        services.AddScoped<IAIService, AIService>();
        services.AddScoped<IChatService, ChatService>();
        services.AddScoped<IClassificationService, ClassificationService>();
        services.AddScoped<ITicketService, TicketService>();
        services.AddScoped<IComplaintService, ComplaintService>();

        services.AddHttpClient<IAIService, AIService>();

        return services;

    }
}
