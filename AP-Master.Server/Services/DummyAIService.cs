namespace AP_Master.Server.Services;

/// <summary>
/// Used when no AI API key is configured, so every workflow can still be run and demonstrated
/// without an external provider.
/// </summary>
public class DummyAIService : IAIService
{
    private readonly ILogger<DummyAIService> _logger;

    public DummyAIService(ILogger<DummyAIService> logger)
    {
        _logger = logger;
    }

    public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("No AI provider configured; returning a placeholder response");

        return Task.FromResult(
            "[Placeholder response - no AI provider configured] " +
            "Thanks for your message. Please try restarting your router by switching it off for 30 seconds, " +
            "then check whether the problem continues.");
    }

    public Task<string> GenerateChatResponseAsync(
        string systemPrompt,
        IReadOnlyList<AIChatMessage> history,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("No AI provider configured; returning a placeholder response ({Count} history messages)",
            history.Count);

        // Echo how much context was received, so the history plumbing can be checked without a real provider.
        var customerTurns = history.Count(m => m.Role == AIChatRole.User);

        return Task.FromResult(
            $"[Placeholder response - no AI provider configured; received {history.Count} messages of context, " +
            $"{customerTurns} from you] " +
            "Thanks for your message. Please try restarting your router by switching it off for 30 seconds, " +
            "then check whether the problem continues.");
    }
}
