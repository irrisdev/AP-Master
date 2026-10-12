using Microsoft.AspNetCore.SignalR;

namespace AP_Master.Server.Hubs;

/// <summary>
/// Real-time channel for the staff dashboard. The server pushes ticket events here the moment a
/// ticket is raised or changed, so agents see new work without refreshing. Clients only listen;
/// every change still goes through the REST API.
/// </summary>
public class StaffHub : Hub
{
    public const string Path = "/hubs/staff";

    private readonly ILogger<StaffHub> _logger;

    public StaffHub(ILogger<StaffHub> logger)
    {
        _logger = logger;
    }

    public override Task OnConnectedAsync()
    {
        _logger.LogInformation("Staff dashboard connected ({ConnectionId})", Context.ConnectionId);
        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("Staff dashboard disconnected ({ConnectionId})", Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}

/// <summary>Event names sent on <see cref="StaffHub"/>. Each event carries a TicketResponse.</summary>
public static class StaffHubEvents
{
    public const string TicketCreated = "TicketCreated";
    public const string TicketUpdated = "TicketUpdated";
}
