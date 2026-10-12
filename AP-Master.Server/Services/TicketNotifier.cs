using AP_Master.Server.DTOs;
using AP_Master.Server.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace AP_Master.Server.Services;

/// <summary>Tells staff about ticket changes as they happen.</summary>
public interface ITicketNotifier
{
    Task TicketCreatedAsync(TicketResponse ticket);
    Task TicketUpdatedAsync(TicketResponse ticket);
}

/// <summary>
/// Broadcasts ticket events to every connected staff dashboard over SignalR.
/// A failed broadcast is logged and swallowed: the ticket is already saved, and the dashboard
/// still sees it on its next load, so a notification problem must never fail the request.
/// </summary>
public class SignalRTicketNotifier : ITicketNotifier
{
    private readonly IHubContext<StaffHub> _hub;
    private readonly ILogger<SignalRTicketNotifier> _logger;

    public SignalRTicketNotifier(IHubContext<StaffHub> hub, ILogger<SignalRTicketNotifier> logger)
    {
        _hub = hub;
        _logger = logger;
    }

    public Task TicketCreatedAsync(TicketResponse ticket) => SendAsync(StaffHubEvents.TicketCreated, ticket);

    public Task TicketUpdatedAsync(TicketResponse ticket) => SendAsync(StaffHubEvents.TicketUpdated, ticket);

    private async Task SendAsync(string eventName, TicketResponse ticket)
    {
        try
        {
            // Not tied to the request's token: if the customer disconnects after the ticket is saved,
            // staff should still hear about it.
            await _hub.Clients.All.SendAsync(eventName, ticket, CancellationToken.None);
            _logger.LogDebug("Sent {Event} for ticket {Reference}", eventName, ticket.Reference);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send {Event} for ticket {Reference}", eventName, ticket.Reference);
        }
    }
}
