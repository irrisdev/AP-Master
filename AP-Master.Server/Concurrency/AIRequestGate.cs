using AP_Master.Server.Services;
using Microsoft.Extensions.Options;

namespace AP_Master.Server.Concurrency;

/// <summary>
/// Process-wide limit on simultaneous calls to the AI provider, shared by every request.
/// A traffic spike queues briefly here instead of flooding the provider (which rate-limits
/// free models and would start failing every call); a request that cannot get a slot in time
/// is told to use its fallback reply.
/// </summary>
public sealed class AIRequestGate : IDisposable
{
    private readonly SemaphoreSlim _semaphore;

    public AIRequestGate(IOptions<AIOptions> options)
    {
        var settings = options.Value;
        Capacity = Math.Max(1, settings.MaxConcurrentRequests);
        QueueTimeout = TimeSpan.FromSeconds(Math.Max(0, settings.QueueTimeoutSeconds));
        _semaphore = new SemaphoreSlim(Capacity, Capacity);
    }

    /// <summary>Maximum number of AI calls in flight at once.</summary>
    public int Capacity { get; }

    /// <summary>How long a request waits for a free slot before giving up.</summary>
    public TimeSpan QueueTimeout { get; }

    /// <summary>AI calls currently in flight.</summary>
    public int InUse => Capacity - _semaphore.CurrentCount;

    /// <summary>Waits for a free slot. Returns false if none became free within <see cref="QueueTimeout"/>.</summary>
    public Task<bool> TryEnterAsync(CancellationToken cancellationToken) =>
        _semaphore.WaitAsync(QueueTimeout, cancellationToken);

    public void Exit() => _semaphore.Release();

    public void Dispose() => _semaphore.Dispose();
}
