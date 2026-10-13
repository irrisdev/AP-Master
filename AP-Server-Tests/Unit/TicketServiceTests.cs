using AP_Master.Server.Enums;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Services;
using AP_Server_Tests.TestSupport;
using Microsoft.Extensions.Logging.Abstractions;

namespace AP_Server_Tests.Unit;

public class TicketServiceTests : IDisposable
{
    private readonly TestDatabase _database = new();
    private readonly RecordingTicketNotifier _notifier = new();
    private readonly TicketService _service;

    public TicketServiceTests()
    {
        _service = new TicketService(_database.Context, _notifier, NullLogger<TicketService>.Instance);
    }

    public void Dispose() => _database.Dispose();

    [Theory]
    [InlineData(RequestType.TechnicalSupport)]
    [InlineData(RequestType.ServiceIssue)]
    public async Task CreateTicket_SupportRequest_AwaitsTechnicianWithNoComplaintFields(RequestType type)
    {
        var ticket = await _service.CreateTicketAsync(1, null, type, "  Router lights are all red  ");

        Assert.Equal(type, ticket.Type);
        Assert.Equal(TicketStatus.AwaitingTechnician, ticket.Status);
        Assert.Matches("^TKT-[0-9A-F]{8}$", ticket.Reference);
        Assert.Equal("Router lights are all red", ticket.Description);
        Assert.Null(ticket.Category);
        Assert.Null(ticket.Severity);
        Assert.False(ticket.Escalated);
    }

    [Theory]
    [InlineData("I'll be taking legal action over this", TicketSeverity.High, true)]
    [InlineData("There has been a data breach of my details", TicketSeverity.High, true)]
    [InlineData("I want a refund for the outage", TicketSeverity.Medium, false)]
    [InlineData("The engineer was rude to me", TicketSeverity.Low, false)]
    public async Task CreateTicket_Complaint_SeverityAndEscalationFollowBusinessRules(
        string description, TicketSeverity severity, bool escalated)
    {
        var ticket = await _service.CreateTicketAsync(1, null, RequestType.Complaint, description);

        Assert.Equal(RequestType.Complaint, ticket.Type);
        Assert.Equal(TicketStatus.Open, ticket.Status);
        Assert.Matches("^CMP-[0-9A-F]{8}$", ticket.Reference);
        Assert.Equal(severity, ticket.Severity);
        Assert.Equal(escalated, ticket.Escalated);
    }

    [Theory]
    [InlineData("I was charged twice", "Billing")]
    [InlineData("My broadband keeps dropping", "Service")]
    [InlineData("The technician never turned up", "Technical Support")]
    [InlineData("The engineer missed two appointments", "Technical Support")]
    [InlineData("Your staff were unhelpful", "General")]
    public async Task CreateTicket_Complaint_IsCategorised(string description, string category)
    {
        var ticket = await _service.CreateTicketAsync(1, null, RequestType.Complaint, description);

        Assert.Equal(category, ticket.Category);
    }

    [Fact]
    public async Task CreateTicket_EnquiryOrEmptyDescription_IsRejected()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _service.CreateTicketAsync(1, null, RequestType.CustomerEnquiry, "What are your prices?"));
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _service.CreateTicketAsync(1, null, RequestType.TechnicalSupport, "   "));
    }

    [Fact]
    public async Task CreateTicket_NotifiesStaff()
    {
        var ticket = await _service.CreateTicketAsync(2, null, RequestType.TechnicalSupport, "No dial tone");

        var created = Assert.Single(_notifier.Created);
        Assert.Equal(ticket.Reference, created.Reference);
    }

    [Fact]
    public async Task References_AreUnique()
    {
        var references = new HashSet<string>();
        for (var i = 0; i < 50; i++)
            references.Add((await _service.CreateTicketAsync(1, null, RequestType.Complaint, $"Complaint {i}")).Reference);

        Assert.Equal(50, references.Count);
    }

    [Fact]
    public async Task UpdateStatus_ChangesStatusAndNotifies()
    {
        var ticket = await _service.CreateTicketAsync(1, null, RequestType.TechnicalSupport, "Broken hub");

        var updated = await _service.UpdateStatusAsync(ticket.Id, TicketStatus.InProgress);

        Assert.Equal(TicketStatus.InProgress, updated.Status);
        Assert.Equal(TicketStatus.InProgress, Assert.Single(_notifier.Updated).Status);
    }

    [Fact]
    public async Task ClosedTicket_CannotBeReopenedOrClosedAgain()
    {
        var ticket = await _service.CreateTicketAsync(1, null, RequestType.TechnicalSupport, "Broken hub");
        await _service.CloseAsync(ticket.Id);

        await Assert.ThrowsAsync<ConflictException>(() => _service.UpdateStatusAsync(ticket.Id, TicketStatus.InProgress));
        await Assert.ThrowsAsync<ConflictException>(() => _service.CloseAsync(ticket.Id));
    }

    [Fact]
    public async Task Escalate_OnlyOnce()
    {
        var ticket = await _service.CreateTicketAsync(1, null, RequestType.Complaint, "Poor service");

        var escalated = await _service.EscalateAsync(ticket.Id);

        Assert.True(escalated.Escalated);
        await Assert.ThrowsAsync<ConflictException>(() => _service.EscalateAsync(ticket.Id));
    }

    [Fact]
    public async Task UnknownTicket_IsNotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _service.GetByIdAsync(999));
        await Assert.ThrowsAsync<NotFoundException>(() => _service.UpdateStatusAsync(999, TicketStatus.Resolved));
        await Assert.ThrowsAsync<NotFoundException>(() => _service.EscalateAsync(999));
    }

    [Fact]
    public async Task GetAll_FiltersByTypeSeverityEscalationAndCustomer()
    {
        await _service.CreateTicketAsync(1, null, RequestType.TechnicalSupport, "Router fault");
        await _service.CreateTicketAsync(1, null, RequestType.Complaint, "Taking legal action");
        await _service.CreateTicketAsync(2, null, RequestType.Complaint, "Rude staff");

        Assert.Equal(2, (await _service.GetAllAsync(type: RequestType.Complaint)).Count);
        Assert.Single(await _service.GetAllAsync(severity: TicketSeverity.High));
        Assert.Single(await _service.GetAllAsync(escalated: true));
        Assert.Equal(2, (await _service.GetAllAsync(customerId: 1)).Count);

        var all = await _service.GetAllAsync();
        Assert.True(all.Select(t => t.Id).SequenceEqual(all.Select(t => t.Id).OrderDescending()), "Newest first");
    }

    [Fact]
    public async Task OpenTicketLookups_KeepComplaintsAndSupportTicketsSeparate()
    {
        await using var context = _database.CreateContext();
        var conversation = new AP_Master.Server.Models.Conversation { CustomerId = 1, RequestType = RequestType.Complaint };
        context.Conversations.Add(conversation);
        await context.SaveChangesAsync();

        var complaint = await _service.CreateTicketAsync(1, conversation.Id, RequestType.Complaint, "Overcharged");

        Assert.Equal(complaint.Id, (await _service.GetOpenComplaintAsync(conversation.Id))?.Id);
        Assert.Null(await _service.GetOpenSupportTicketAsync(conversation.Id));
        Assert.True(await _service.AnyComplaintForConversationAsync(conversation.Id));

        await _service.CloseAsync(complaint.Id);

        Assert.Null(await _service.GetOpenComplaintAsync(conversation.Id));
        Assert.True(await _service.AnyComplaintForConversationAsync(conversation.Id)); // closed still counts as "logged"
    }
}
