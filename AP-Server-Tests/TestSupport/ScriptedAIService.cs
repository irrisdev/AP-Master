using System.Collections.Concurrent;
using AP_Master.Server.Services;

namespace AP_Server_Tests.TestSupport;

/// <summary>
/// Programmable stand-in for the AI provider. Tests set what it answers, how slowly, or make it
/// fail, and can inspect what it was asked. Thread-safe, because integration tests call it from
/// concurrent requests.
/// </summary>
public sealed class ScriptedAIService : IAIService
{
    private int _chatCalls;
    private int _completionCalls;

    /// <summary>Reply to a chat request, given the system prompt and history.</summary>
    public Func<string, IReadOnlyList<AIChatMessage>, string> ChatReply { get; set; } = DefaultChatReply;

    /// <summary>Reply to a single-turn request (used by the classifier, which expects a category name).</summary>
    public Func<string, string> CompletionReply { get; set; } = DefaultCompletionReply;

    /// <summary>Simulated provider latency.</summary>
    public TimeSpan Delay { get; set; }

    /// <summary>When true every call throws, like a provider outage.</summary>
    public bool Fail { get; set; }

    public int ChatCalls => _chatCalls;
    public int CompletionCalls => _completionCalls;

    /// <summary>History sent with each chat request, in call order.</summary>
    public ConcurrentQueue<IReadOnlyList<AIChatMessage>> Histories { get; } = new();

    public void Reset()
    {
        ChatReply = DefaultChatReply;
        CompletionReply = DefaultCompletionReply;
        Delay = TimeSpan.Zero;
        Fail = false;
        _chatCalls = 0;
        _completionCalls = 0;
        Histories.Clear();
    }

    public async Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _completionCalls);
        await SimulateAsync(cancellationToken);
        return CompletionReply(prompt);
    }

    public async Task<string> GenerateChatResponseAsync(
        string systemPrompt, IReadOnlyList<AIChatMessage> history, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _chatCalls);
        Histories.Enqueue(history);
        await SimulateAsync(cancellationToken);
        return ChatReply(systemPrompt, history);
    }

    private async Task SimulateAsync(CancellationToken cancellationToken)
    {
        if (Delay > TimeSpan.Zero)
            await Task.Delay(Delay, cancellationToken);

        if (Fail)
            throw new AIServiceException("Simulated AI outage.");
    }

    private static string DefaultChatReply(string systemPrompt, IReadOnlyList<AIChatMessage> history) =>
        systemPrompt.Contains("troubleshooting steps", StringComparison.OrdinalIgnoreCase)
            ? "1. Restart your router.\n2. Check the cables are secure."
            : "Thanks for getting in touch, I can help with that.";

    // Unparseable on purpose: the classifier then falls back to its rules, which keeps routing predictable.
    private static string DefaultCompletionReply(string prompt) => "unsure";
}
