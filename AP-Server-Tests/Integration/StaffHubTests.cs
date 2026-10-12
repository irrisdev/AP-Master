using System.Net.Http.Json;
using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Master.Server.Hubs;
using AP_Server_Tests.TestSupport;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace AP_Server_Tests.Integration;

/// <summary>The staff dashboard's real-time feed: ticket events arrive over SignalR as they happen.</summary>
public class StaffHubTests : IClassFixture<TelegroupApiFactory>, IAsyncDisposable
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    private readonly TelegroupApiFactory _factory;
    private readonly HttpClient _client;
    private readonly HubConnection _hub;

    public StaffHubTests(TelegroupApiFactory factory)
    {
        _factory = factory;
        _factory.AI.Reset();
        _client = factory.CreateClient();

        // Long polling works over the in-memory test server; browsers use WebSockets.
        _hub = new HubConnectionBuilder()
            .WithUrl(new Uri(_factory.Server.BaseAddress, StaffHub.Path.TrimStart('/')), options =>
            {
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
            })
            .Build();
    }

    public async ValueTask DisposeAsync() => await _hub.DisposeAsync();

    [Fact]
    public async Task NewTicket_IsPushedToConnectedStaff()
    {
        var received = new TaskCompletionSource<TicketResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        _hub.On<TicketResponse>(StaffHubEvents.TicketCreated, ticket => received.TrySetResult(ticket));
        await _hub.StartAsync();

        var customer = await _client.CreateCustomerAsync();
        var chat = await _client.ChatAsync(customer.Id, "I need an engineer to install a new phone socket");

        var pushed = await received.Task.WaitAsync(Timeout);
        Assert.Equal(chat.TicketId, pushed.Id);
        Assert.Equal(RequestType.TechnicalSupport, pushed.Type);
    }

    [Fact]
    public async Task StatusChange_IsPushedToConnectedStaff()
    {
        var customer = await _client.CreateCustomerAsync();
        var chat = await _client.ChatAsync(customer.Id, "I need an engineer to install a new phone socket");

        var received = new TaskCompletionSource<TicketResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        _hub.On<TicketResponse>(StaffHubEvents.TicketUpdated, ticket =>
        {
            if (ticket.Id == chat.TicketId)
                received.TrySetResult(ticket);
        });
        await _hub.StartAsync();

        await _client.PutAsJsonAsync($"/api/tickets/{chat.TicketId}/status", new { status = (int)TicketStatus.Resolved });

        var pushed = await received.Task.WaitAsync(Timeout);
        Assert.Equal(TicketStatus.Resolved, pushed.Status);
    }
}
