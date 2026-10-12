using System.Diagnostics;
using AP_Master.Server.Concurrency;

namespace AP_Master.Server.Services;

/// <summary>
/// Decorator that puts every AI call through the shared <see cref="AIRequestGate"/>.
/// It wraps whichever provider is configured (real or placeholder), so the limit applies
/// without either implementation knowing about it.
/// </summary>
public sealed class ConcurrencyLimitedAIService : IAIService
{
    private readonly IAIService _inner;
    private readonly AIRequestGate _gate;
    private readonly ILogger<ConcurrencyLimitedAIService> _logger;

    public ConcurrencyLimitedAIService(IAIService inner, AIRequestGate gate, ILogger<ConcurrencyLimitedAIService> logger)
    {
        _inner = inner;
        _gate = gate;
        _logger = logger;
    }

    public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default) =>
        RunAsync(token => _inner.GenerateResponseAsync(prompt, token), cancellationToken);

    public Task<string> GenerateChatResponseAsync(
        string systemPrompt,
        IReadOnlyList<AIChatMessage> history,
        CancellationToken cancellationToken = default) =>
        RunAsync(token => _inner.GenerateChatResponseAsync(systemPrompt, history, token), cancellationToken);

    private async Task<string> RunAsync(Func<CancellationToken, Task<string>> call, CancellationToken cancellationToken)
    {
        var waited = Stopwatch.StartNew();

        if (!await _gate.TryEnterAsync(cancellationToken))
        {
            _logger.LogWarning("AI provider busy: all {Capacity} slots in use for {Timeout}s; caller will use its fallback",
                _gate.Capacity, _gate.QueueTimeout.TotalSeconds);

            // Callers already treat AIServiceException as "AI unavailable" and degrade gracefully.
            throw new AIServiceException($"AI provider is busy ({_gate.Capacity} requests already in progress).");
        }

        try
        {
            if (waited.ElapsedMilliseconds >= 50)
            {
                _logger.LogInformation("Waited {WaitMs} ms for an AI slot ({InUse}/{Capacity} in use)",
                    waited.ElapsedMilliseconds, _gate.InUse, _gate.Capacity);
            }

            return await call(cancellationToken);
        }
        finally
        {
            _gate.Exit();
        }
    }
}
