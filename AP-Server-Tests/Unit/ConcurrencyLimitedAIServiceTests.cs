using AP_Master.Server.Concurrency;
using AP_Master.Server.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AP_Server_Tests.Unit;

public class ConcurrencyLimitedAIServiceTests
{
    private static readonly IReadOnlyList<AIChatMessage> History = [new(AIChatRole.User, "hello")];

    private static (ConcurrencyLimitedAIService Service, AIRequestGate Gate) Create(IAIService inner, int capacity, int queueTimeoutSeconds)
    {
        var gate = new AIRequestGate(Options.Create(new AIOptions
        {
            MaxConcurrentRequests = capacity,
            QueueTimeoutSeconds = queueTimeoutSeconds
        }));

        return (new ConcurrencyLimitedAIService(inner, gate, NullLogger<ConcurrencyLimitedAIService>.Instance), gate);
    }

    [Fact]
    public async Task NeverRunsMoreCallsAtOnceThanCapacity()
    {
        var inner = new TrackingAIService(TimeSpan.FromMilliseconds(40));
        var (service, _) = Create(inner, capacity: 2, queueTimeoutSeconds: 10);

        var replies = await Task.WhenAll(Enumerable.Range(0, 10)
            .Select(_ => service.GenerateChatResponseAsync("system", History)));

        Assert.All(replies, reply => Assert.Equal("ok", reply));
        Assert.Equal(2, inner.MaxConcurrent);
        Assert.Equal(10, inner.Calls);
    }

    [Fact]
    public async Task WhenNoSlotFreesUpInTime_ThrowsAIServiceException()
    {
        var blocker = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var inner = new BlockingAIService(blocker.Task);
        var (service, gate) = Create(inner, capacity: 1, queueTimeoutSeconds: 0);

        var first = service.GenerateResponseAsync("first");
        var second = await Assert.ThrowsAsync<AIServiceException>(() => service.GenerateResponseAsync("second"));

        Assert.Contains("busy", second.Message);
        Assert.Equal(1, gate.InUse);

        blocker.SetResult("done");
        Assert.Equal("done", await first);
        Assert.Equal(0, gate.InUse);
    }

    [Fact]
    public async Task FailedCall_ReleasesItsSlot()
    {
        var inner = new FailingOnceAIService();
        var (service, gate) = Create(inner, capacity: 1, queueTimeoutSeconds: 0);

        await Assert.ThrowsAsync<AIServiceException>(() => service.GenerateResponseAsync("fails"));

        Assert.Equal(0, gate.InUse);
        Assert.Equal("recovered", await service.GenerateResponseAsync("works"));
    }

    [Fact]
    public async Task CancelledWhileQueued_ThrowsAndDoesNotTakeASlot()
    {
        var blocker = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var (service, gate) = Create(new BlockingAIService(blocker.Task), capacity: 1, queueTimeoutSeconds: 30);
        var first = service.GenerateResponseAsync("holds the slot");

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.GenerateResponseAsync("queued", cts.Token));

        blocker.SetResult("done");
        await first;
        Assert.Equal(0, gate.InUse);
    }

    private sealed class TrackingAIService(TimeSpan delay) : IAIService
    {
        private int _current;
        private int _max;
        private int _calls;

        public int MaxConcurrent => _max;
        public int Calls => _calls;

        public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default) =>
            RunAsync(cancellationToken);

        public Task<string> GenerateChatResponseAsync(string systemPrompt, IReadOnlyList<AIChatMessage> history,
            CancellationToken cancellationToken = default) => RunAsync(cancellationToken);

        private async Task<string> RunAsync(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            var now = Interlocked.Increment(ref _current);
            int seen;
            while (now > (seen = Volatile.Read(ref _max)) && Interlocked.CompareExchange(ref _max, now, seen) != seen)
            {
            }

            await Task.Delay(delay, cancellationToken);
            Interlocked.Decrement(ref _current);
            return "ok";
        }
    }

    private sealed class BlockingAIService(Task<string> result) : IAIService
    {
        public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default) => result;

        public Task<string> GenerateChatResponseAsync(string systemPrompt, IReadOnlyList<AIChatMessage> history,
            CancellationToken cancellationToken = default) => result;
    }

    private sealed class FailingOnceAIService : IAIService
    {
        private int _calls;

        public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default) =>
            Interlocked.Increment(ref _calls) == 1
                ? throw new AIServiceException("provider down")
                : Task.FromResult("recovered");

        public Task<string> GenerateChatResponseAsync(string systemPrompt, IReadOnlyList<AIChatMessage> history,
            CancellationToken cancellationToken = default) => GenerateResponseAsync(systemPrompt, cancellationToken);
    }
}
