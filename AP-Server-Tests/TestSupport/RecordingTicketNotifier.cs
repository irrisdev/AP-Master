using System.Collections.Concurrent;
using AP_Master.Server.DTOs;
using AP_Master.Server.Services;

namespace AP_Server_Tests.TestSupport;

/// <summary>Records ticket events instead of broadcasting them.</summary>
public sealed class RecordingTicketNotifier : ITicketNotifier
{
    public ConcurrentQueue<TicketResponse> Created { get; } = new();
    public ConcurrentQueue<TicketResponse> Updated { get; } = new();

    public Task TicketCreatedAsync(TicketResponse ticket)
    {
        Created.Enqueue(ticket);
        return Task.CompletedTask;
    }

    public Task TicketUpdatedAsync(TicketResponse ticket)
    {
        Updated.Enqueue(ticket);
        return Task.CompletedTask;
    }
}
