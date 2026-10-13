namespace AP_Master.Server.Concurrency;

/// <summary>
/// An async mutex per key: callers holding the same key run one at a time, callers with different
/// keys run in parallel. Entries are created on demand and removed when nobody holds or waits for
/// them, so memory does not grow with the number of keys ever seen.
/// </summary>
/// <remarks>
/// In-process only. Running several server instances would need a distributed lock instead
/// (for example a database row lock or Redis).
/// </remarks>
public class KeyedLock<TKey> where TKey : notnull
{
    private readonly Dictionary<TKey, Entry> _entries = new();
    private readonly object _sync = new();

    /// <summary>Number of keys currently held or waited on. Exposed for diagnostics and tests.</summary>
    public int ActiveKeys
    {
        get
        {
            lock (_sync)
                return _entries.Count;
        }
    }

    /// <summary>
    /// Waits up to <paramref name="timeout"/> for exclusive access to <paramref name="key"/>.
    /// Returns a handle that releases the lock when disposed, or null if the wait timed out.
    /// </summary>
    public async Task<IDisposable?> TryAcquireAsync(TKey key, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        Entry entry;
        lock (_sync)
        {
            if (!_entries.TryGetValue(key, out entry!))
            {
                entry = new Entry();
                _entries[key] = entry;
            }

            entry.References++;
        }

        var acquired = false;
        try
        {
            acquired = await entry.Semaphore.WaitAsync(timeout, cancellationToken);
        }
        finally
        {
            // Timed out or cancelled: give up our reference without releasing a lock we never held.
            if (!acquired)
                Release(key, entry, held: false);
        }

        return acquired ? new Releaser(this, key, entry) : null;
    }

    private void Release(TKey key, Entry entry, bool held)
    {
        if (held)
            entry.Semaphore.Release();

        lock (_sync)
        {
            if (--entry.References == 0)
            {
                _entries.Remove(key);
                entry.Semaphore.Dispose();
            }
        }
    }

    private sealed class Entry
    {
        public SemaphoreSlim Semaphore { get; } = new(1, 1);

        /// <summary>Holders plus waiters. Only changed inside the lock on <c>_sync</c>.</summary>
        public int References { get; set; }
    }

    private sealed class Releaser : IDisposable
    {
        private readonly KeyedLock<TKey> _owner;
        private readonly TKey _key;
        private readonly Entry _entry;
        private int _disposed;

        public Releaser(KeyedLock<TKey> owner, TKey key, Entry entry)
        {
            _owner = owner;
            _key = key;
            _entry = entry;
        }

        public void Dispose()
        {
            // Safe to dispose twice; only the first call releases.
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
                _owner.Release(_key, _entry, held: true);
        }
    }
}

/// <summary>
/// Serialises chat turns within one conversation. Two messages sent to the same conversation at
/// once (a double-click, two browser tabs) would otherwise both see "no open ticket" and both
/// create one; different conversations are still processed in parallel.
/// </summary>
public sealed class ConversationLocks : KeyedLock<int>
{
}
