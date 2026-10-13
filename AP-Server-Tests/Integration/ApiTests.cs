using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Server_Tests.TestSupport;

namespace AP_Server_Tests.Integration;

/// <summary>
/// End-to-end tests over HTTP against the real application pipeline: routing, model validation,
/// the exception middleware, EF Core with SQLite, and the chat workflows.
/// </summary>
public class ApiTests : IClassFixture<TelegroupApiFactory>
{
    private readonly TelegroupApiFactory _factory;
    private readonly HttpClient _client;

    public ApiTests(TelegroupApiFactory factory)
    {
        _factory = factory;
        _factory.AI.Reset();
        _client = factory.CreateClient();
    }

    // ---------------------------------------------------------------- platform

    [Fact]
    public async Task Health_ReportsDatabaseAndAIProvider()
    {
        var response = await _client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("Healthy", body.RootElement.GetProperty("status").GetString());

        var checks = body.RootElement.GetProperty("checks").EnumerateArray()
            .Select(c => c.GetProperty("name").GetString()).ToList();
        Assert.Contains("database", checks);
        Assert.Contains("ai-provider", checks);
    }

    [Fact]
    public async Task Responses_CarrySecurityHeaders()
    {
        var response = await _client.GetAsync("/health");

        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
    }

    [Fact]
    public async Task UnknownApiRoute_IsAProblemDetails404_NotTheSpa()
    {
        var response = await _client.GetAsync("/api/complaints");

        await response.AssertProblemAsync(HttpStatusCode.NotFound);
    }

    // ---------------------------------------------------------------- customers and validation

    [Fact]
    public async Task CreateCustomer_Returns201WithLocation()
    {
        var response = await _client.PostAsJsonAsync("/api/customers",
            new CreateCustomerRequest { Name = "Ada Lovelace", Email = $"{Guid.NewGuid():N}@test.example" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(response.Headers.Location);

        var created = await response.Content.ReadFromJsonAsync<CustomerResponse>();
        var fetched = await _client.GetFromJsonAsync<CustomerResponse>(response.Headers.Location);
        Assert.Equal(created!.Id, fetched!.Id);
    }

    [Fact]
    public async Task CreateCustomer_InvalidEmail_Is400WithFieldErrors()
    {
        var response = await _client.PostAsJsonAsync("/api/customers",
            new CreateCustomerRequest { Name = "No Email", Email = "not-an-email" });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest);
        Assert.True(problem.GetProperty("errors").TryGetProperty("Email", out _));
    }

    [Fact]
    public async Task CreateCustomer_DuplicateEmail_Is409()
    {
        var email = $"{Guid.NewGuid():N}@test.example";
        await _client.PostAsJsonAsync("/api/customers", new CreateCustomerRequest { Name = "First", Email = email });

        var response = await _client.PostAsJsonAsync("/api/customers",
            new CreateCustomerRequest { Name = "Second", Email = email.ToUpperInvariant() });

        await response.AssertProblemAsync(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task UnknownCustomer_Is404()
    {
        var response = await _client.GetAsync("/api/customers/999999");

        await response.AssertProblemAsync(HttpStatusCode.NotFound);
    }

    // ---------------------------------------------------------------- chat over HTTP

    [Fact]
    public async Task Chat_EmptyOrTooLongMessage_Is400()
    {
        var customer = await _client.CreateCustomerAsync();

        await (await _client.PostChatAsync(customer.Id, "")).AssertProblemAsync(HttpStatusCode.BadRequest);
        await (await _client.PostChatAsync(customer.Id, new string('x', 2001))).AssertProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Chat_SomeoneElsesConversation_Is404()
    {
        var owner = await _client.CreateCustomerAsync("Owner");
        var intruder = await _client.CreateCustomerAsync("Intruder");
        var chat = await _client.ChatAsync(owner.Id, "What are your opening hours?");

        var response = await _client.PostChatAsync(intruder.Id, "Show me this", chat.ConversationId);

        await response.AssertProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Chat_ConversationIsPersistedAndReadable()
    {
        var customer = await _client.CreateCustomerAsync();
        var first = await _client.ChatAsync(customer.Id, "What are your opening hours?");
        await _client.ChatAsync(customer.Id, "And on Sundays?", first.ConversationId);

        var messages = await _client.GetFromJsonAsync<List<MessageResponse>>($"/api/conversations/{first.ConversationId}/messages");
        Assert.Equal(4, messages!.Count); // two questions, two replies
        Assert.Equal("What are your opening hours?", messages[0].Content);

        var conversations = await _client.GetFromJsonAsync<List<ConversationResponse>>($"/api/customers/{customer.Id}/conversations");
        Assert.Equal(first.ConversationId, Assert.Single(conversations!).Id);
    }

    [Fact]
    public async Task Chat_TechnicalSupport_AppearsInTheStaffTicketQueue()
    {
        var customer = await _client.CreateCustomerAsync();

        var chat = await _client.ChatAsync(customer.Id, "I need an engineer to install a new phone socket");

        var ticket = Assert.Single(await _client.GetTicketsAsync($"?customerId={customer.Id}"));
        Assert.Equal(chat.TicketId, ticket.Id);
        Assert.Equal(RequestType.TechnicalSupport, ticket.Type);
        Assert.Equal(TicketStatus.AwaitingTechnician, ticket.Status);
        Assert.Contains(ticket.Reference, chat.Message);
    }

    [Fact]
    public async Task Chat_Complaint_IsListedAsAComplaintTicket()
    {
        var customer = await _client.CreateCustomerAsync();

        var chat = await _client.ChatAsync(customer.Id, "I want to complain, I was charged twice on my bill");

        var complaints = await _client.GetTicketsAsync($"?type={(int)RequestType.Complaint}&customerId={customer.Id}");
        var complaint = Assert.Single(complaints);
        Assert.Equal(chat.TicketId, complaint.Id);
        Assert.Equal(TicketStatus.Open, complaint.Status);
        Assert.Equal("Billing", complaint.Category);
        Assert.NotNull(complaint.Severity);
    }

    [Fact]
    public async Task Chat_AfterAComplaintIsLogged_TheConversationIsClosed()
    {
        var customer = await _client.CreateCustomerAsync();
        var complaint = await _client.ChatAsync(customer.Id, "I want to complain, I was charged twice on my bill");

        Assert.Equal(ConversationStatus.Closed, complaint.ConversationStatus);
        Assert.StartsWith("CMP-", complaint.TicketReference);

        var followUp = await _client.PostChatAsync(customer.Id, "Hello again", complaint.ConversationId);
        await followUp.AssertProblemAsync(HttpStatusCode.Conflict);

        // A new conversation works as normal.
        var fresh = await _client.ChatAsync(customer.Id, "What are your opening hours?");
        Assert.NotEqual(complaint.ConversationId, fresh.ConversationId);
    }

    // ---------------------------------------------------------------- staff ticket workflow

    [Fact]
    public async Task Ticket_StaffWorkflow_StatusCloseAndEscalate()
    {
        var customer = await _client.CreateCustomerAsync();
        var chat = await _client.ChatAsync(customer.Id, "I need an engineer to install a new phone socket");
        var id = chat.TicketId!.Value;

        var inProgress = await _client.PutAsJsonAsync($"/api/tickets/{id}/status", new { status = (int)TicketStatus.InProgress });
        Assert.Equal(HttpStatusCode.OK, inProgress.StatusCode);
        Assert.Equal(TicketStatus.InProgress, (await inProgress.Content.ReadFromJsonAsync<TicketResponse>())!.Status);

        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsync($"/api/tickets/{id}/escalate", null)).StatusCode);
        await (await _client.PostAsync($"/api/tickets/{id}/escalate", null)).AssertProblemAsync(HttpStatusCode.Conflict);

        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsync($"/api/tickets/{id}/close", null)).StatusCode);
        await (await _client.PostAsync($"/api/tickets/{id}/close", null)).AssertProblemAsync(HttpStatusCode.Conflict);
        await (await _client.PutAsJsonAsync($"/api/tickets/{id}/status", new { status = (int)TicketStatus.InProgress }))
            .AssertProblemAsync(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Ticket_InvalidStatus_Is400()
    {
        var customer = await _client.CreateCustomerAsync();
        var chat = await _client.ChatAsync(customer.Id, "I need an engineer to install a new phone socket");

        var response = await _client.PutAsJsonAsync($"/api/tickets/{chat.TicketId}/status", new { status = 42 });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Ticket_Unknown_Is404()
    {
        await (await _client.GetAsync("/api/tickets/999999")).AssertProblemAsync(HttpStatusCode.NotFound);
        await (await _client.PostAsync("/api/tickets/999999/escalate", null)).AssertProblemAsync(HttpStatusCode.NotFound);
    }
}
