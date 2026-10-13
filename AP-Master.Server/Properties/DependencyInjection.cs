using System.Net.Http.Headers;
using AP_Master.Server.Concurrency;
using AP_Master.Server.HealthChecks;
using AP_Master.Server.Services;

namespace AP_Master.Server.Properties;

public static class DependencyInjection
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        // ProblemDetails still formats the framework's own responses (model validation 400s).
        // Application exceptions are handled by ExceptionHandlingMiddleware instead: an IExceptionHandler
        // registered here would run *inside* that middleware, catch every exception first, and
        // report NotFoundException as a 500.
        services.AddProblemDetails();

        services.AddScoped<IChatService, ChatService>();
        services.AddScoped<IClassificationService, ClassificationService>();
        services.AddScoped<ITicketService, TicketService>();
        services.AddScoped<ICustomerService, CustomerService>();
        services.AddScoped<IConversationService, ConversationService>();
        services.AddScoped<IMessageService, MessageService>();
        services.AddScoped<IPackageCatalogueService, PackageCatalogueService>();
        services.AddSingleton<RuleBasedClassifier>();
        services.AddSingleton<ITroubleshootingOutcomeDetector, TroubleshootingOutcomeDetector>();

        // Concurrency control: one lock per conversation, shared by every request.
        services.AddSingleton<ConversationLocks>();

        // Real-time ticket events for the staff dashboard.
        services.AddSignalR();
        services.AddSingleton<ITicketNotifier, SignalRTicketNotifier>();

        services.AddHealthChecks()
            .AddCheck<DatabaseHealthCheck>("database")
            .AddCheck<AIGateHealthCheck>("ai-provider");

        return services;
    }

    /// <summary>
    /// Registers the AI provider: the real OpenAI-compatible client when an API key is configured
    /// (AI:ApiKey in user secrets, or the AI__ApiKey environment variable), otherwise the placeholder.
    /// Either way it is wrapped in <see cref="ConcurrencyLimitedAIService"/>, so consumers of
    /// <see cref="IAIService"/> get the concurrency limit without knowing it exists.
    /// </summary>
    public static IServiceCollection AddAIServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AIOptions>(configuration.GetSection(AIOptions.SectionName));
        var ai = configuration.GetSection(AIOptions.SectionName).Get<AIOptions>() ?? new AIOptions();

        services.AddSingleton<AIRequestGate>();

        if (string.IsNullOrWhiteSpace(ai.ApiKey))
        {
            services.AddSingleton<DummyAIService>();
            services.AddScoped<IAIService>(LimitedAI<DummyAIService>);
        }
        else
        {
            services.AddHttpClient<AIService>(client =>
            {
                client.BaseAddress = new Uri(ai.BaseUrl);
                client.Timeout = TimeSpan.FromSeconds(ai.TimeoutSeconds);
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ai.ApiKey);
                client.DefaultRequestHeaders.Add("X-Title", "Telegroup Customer Service");
            });
            services.AddScoped<IAIService>(LimitedAI<AIService>);
        }

        return services;
    }

    private static IAIService LimitedAI<TProvider>(IServiceProvider provider) where TProvider : IAIService =>
        new ConcurrencyLimitedAIService(
            provider.GetRequiredService<TProvider>(),
            provider.GetRequiredService<AIRequestGate>(),
            provider.GetRequiredService<ILogger<ConcurrencyLimitedAIService>>());
}
