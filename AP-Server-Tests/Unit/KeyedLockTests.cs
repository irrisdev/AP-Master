using AP_Master.Server.Concurrency;

namespace AP_Server_Tests.Unit;

public class KeyedLockTests
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task SameKey_HoldersRunOneAtATime()
    {
        var locks = new KeyedLock<int>();
        var inside = 0;
        var maxInside = 0;

        async Task Work()
        {
            using var handle = await locks.TryAcquireAsync(1, Wait);
            Assert.NotNull(handle);

            var now = Interlocked.Increment(ref inside);
            InterlockedMax(ref maxInside, now);
            await Task.Delay(20);
            Interlocked.Decrement(ref inside);
        }

        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(Work)));

        Assert.Equal(1, maxInside);
    }

    [Fact]
    public async Task DifferentKeys_DoNotBlockEachOther()
    {
        var locks = new KeyedLock<int>();

        using var first = await locks.TryAcquireAsync(1, Wait);
        using var second = await locks.TryAcquireAsync(2, TimeSpan.Zero);

        Assert.NotNull(first);
        Assert.NotNull(second); // acquired immediately even though key 1 is held
    }

    [Fact]
    public async Task HeldKey_TimesOutAndReturnsNull()
    {
        var locks = new KeyedLock<int>();
        using var holder = await locks.TryAcquireAsync(7, Wait);

        var waiter = await locks.TryAcquireAsync(7, TimeSpan.FromMilliseconds(50));

        Assert.Null(waiter);
        Assert.Equal(1, locks.ActiveKeys); // the timed-out waiter left no reference behind
    }

    [Fact]
    public async Task ReleasingLastHolder_RemovesTheEntry()
    {
        var locks = new KeyedLock<string>();

        using (await locks.TryAcquireAsync("conversation-42", Wait))
            Assert.Equal(1, locks.ActiveKeys);

        Assert.Equal(0, locks.ActiveKeys);
    }

    [Fact]
    public async Task Release_HandsTheLockToTheNextWaiter()
    {
        var locks = new KeyedLock<int>();
        var holder = await locks.TryAcquireAsync(3, Wait);

        var waiting = locks.TryAcquireAsync(3, Wait);
        Assert.False(waiting.IsCompleted);

        holder!.Dispose();
        using var next = await waiting;

        Assert.NotNull(next);
    }

    [Fact]
    public async Task CancelledWaiter_ThrowsAndCleansUp()
    {
        var locks = new KeyedLock<int>();
        var holder = await locks.TryAcquireAsync(5, Wait);
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => locks.TryAcquireAsync(5, Wait, cts.Token));

        holder!.Dispose();
        Assert.Equal(0, locks.ActiveKeys);
    }

    [Fact]
    public async Task DisposingTwice_ReleasesOnlyOnce()
    {
        var locks = new KeyedLock<int>();
        var handle = await locks.TryAcquireAsync(9, Wait);

        handle!.Dispose();
        handle.Dispose(); // would throw SemaphoreFullException if it released twice

        using var again = await locks.TryAcquireAsync(9, TimeSpan.Zero);
        Assert.NotNull(again);
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int current;
        while (value > (current = Volatile.Read(ref target)) &&
               Interlocked.CompareExchange(ref target, value, current) != current)
        {
        }
    }
}
