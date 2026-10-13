using Microsoft.Extensions.Options;

namespace AP_Master.Server.Services;

/// <summary>
/// Used when no AI API key is configured, so every workflow can still be run and demonstrated
/// without an external provider.
/// </summary>
public class DummyAIService : IAIService
{
    // A numbered list, like a real model's steps: ChatService only starts troubleshooting when it sees one.
    private const string TroubleshootingReply =
        "Here are a couple of things to try:\n" +
        "1. Switch your router off at the wall for 30 seconds, then back on.\n" +
        "2. Check the cable between the router and the wall socket is pushed fully in.";

    private const string GeneralReply =
        "Thanks for your message. This is a sample reply because no AI provider is configured; " +
        "with one configured, the assistant would answer your question here.";

    private readonly TimeSpan _latency;
    private readonly ILogger<DummyAIService> _logger;

    public DummyAIService(IOptions<AIOptions> options, ILogger<DummyAIService> logger)
    {
        _latency = TimeSpan.FromMilliseconds(Math.Max(0, options.Value.DummyLatencyMilliseconds));
        _logger = logger;
    }

    public async Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("No AI provider configured; returning a placeholder response");
        await SimulateLatencyAsync(cancellationToken);

        return $"[Placeholder response - no AI provider configured] {GeneralReply}";
    }

    public async Task<string> GenerateChatResponseAsync(
        string systemPrompt,
        IReadOnlyList<AIChatMessage> history,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("No AI provider configured; returning a placeholder response ({Count} history messages)",
            history.Count);
        await SimulateLatencyAsync(cancellationToken);

        // Echo how much context was received, so the history plumbing can be checked without a real provider.
        var customerTurns = history.Count(m => m.Role == AIChatRole.User);

        // Router advice only makes sense as troubleshooting steps; anything else gets a neutral reply.
        var body = systemPrompt.Contains("troubleshooting steps", StringComparison.OrdinalIgnoreCase)
            ? TroubleshootingReply
            : GeneralReply;

        return $"[Placeholder response - no AI provider configured; received {history.Count} messages of context, " +
               $"{customerTurns} from you] {body}";
    }

    private Task SimulateLatencyAsync(CancellationToken cancellationToken) =>
        _latency > TimeSpan.Zero ? Task.Delay(_latency, cancellationToken) : Task.CompletedTask;
}
