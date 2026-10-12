using AP_Master.Server.Exceptions;
using AP_Master.Server.Services;
using System.Runtime.CompilerServices;

namespace AP_Master.Server.Properties;

public static class DependencyInjection
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        // ProblemDetails still formats the framework's own responses (model validation 400s).
        // Application exceptions are handled by ExceptionHandlingMiddleware instead: registering
        // GlobalExceptionHandler here put it *inside* that middleware, where it caught every
        // exception first and reported NotFoundException as a 500.
        services.AddProblemDetails();

        services.AddScoped<IChatService, ChatService>();
        services.AddScoped<IClassificationService, ClassificationService>();
        services.AddScoped<ITicketService, TicketService>();
        services.AddScoped<ICustomerService, CustomerService>();
        services.AddScoped<IConversationService, ConversationService>();
        services.AddScoped<IMessageService, MessageService>();
        services.AddSingleton<RuleBasedClassifier>();

        services.AddSingleton<ITroubleshootingOutcomeDetector, TroubleshootingOutcomeDetector>();
        return services;

    }
}
