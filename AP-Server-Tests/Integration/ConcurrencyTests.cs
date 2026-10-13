using System.Net;
using System.Net.Http.Json;
using AP_Master.Server.DTOs;
using AP_Master.Server.DTOs.Chat;
using AP_Master.Server.Enums;
using AP_Server_Tests.TestSupport;

namespace AP_Server_Tests.Integration;

/// <summary>
/// Concurrent requests against the real server: many customers at once, and several messages
/// racing into the same conversation.
/// </summary>
public class ConcurrencyTests : IClassFixture<TelegroupApiFactory>
{
    private readonly TelegroupApiFactory _factory;
    private readonly HttpClient _client;

    public ConcurrencyTests(TelegroupApiFactory factory)
    {
        _factory = factory;
        _factory.AI.Reset();
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task SimultaneousMessagesToOneConversation_RaiseExactlyOneTicket()
    {
        // A slow AI widens the gap between "is there an open ticket?" and "create the ticket",
        // which is exactly where unsynchronised requests would each create their own.
        _factory.AI.Delay = TimeSpan.FromMilliseconds(150);
        var customer = await _client.CreateCustomerAsync();

        var start = await _client.PostAsJsonAsync("/api/conversations",
            new CreateConversationRequest { CustomerId = customer.Id, RequestType = RequestType.TechnicalSupport });
        var conversation = (await start.Content.ReadFromJsonAsync<ConversationResponse>())!;

        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ =>
            _client.PostChatAsync(customer.Id, "I need an engineer to install a new phone socket", conversation.Id)));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));

        var tickets = await _client.GetTicketsAsync($"?customerId={customer.Id}");
        var ticket = Assert.Single(tickets);

        // Every reply refers to that one ticket.
        foreach (var response in responses)
            Assert.Equal(ticket.Id, (await response.Content.ReadFromJsonAsync<ChatResponse>())!.TicketId);
    }

    [Fact]
    public async Task ManyCustomersAtOnce_AreAllServed()
    {
        _factory.AI.Delay = TimeSpan.FromMilliseconds(50);
        var customers = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => _client.CreateCustomerAsync($"Customer {i}")));

        var replies = await Task.WhenAll(customers.Select(c => _client.ChatAsync(c.Id, "What are your opening hours?")));

        Assert.Equal(10, replies.Select(r => r.ConversationId).Distinct().Count());
        Assert.All(replies, r => Assert.False(string.IsNullOrWhiteSpace(r.Message)));
    }
}
