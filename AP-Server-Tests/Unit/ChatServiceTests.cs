using AP_Master.Server.Enums;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Services;
using AP_Server_Tests.TestSupport;
using Microsoft.EntityFrameworkCore;

namespace AP_Server_Tests.Unit;

/// <summary>
/// The four chat workflows, each tied to a user story. The real ChatService and its collaborators
/// run against a private SQLite database; only the AI provider is scripted.
/// </summary>
public class ChatServiceTests : IDisposable
{
    private readonly ChatHarness _harness = new();

    public void Dispose() => _harness.Dispose();

    private async Task<AP_Master.Server.Models.Conversation> LoadConversationAsync(int id)
    {
        await using var context = _harness.Database.CreateContext();
        return await context.Conversations.AsNoTracking().SingleAsync(c => c.Id == id);
    }

    private async Task<List<AP_Master.Server.Models.SupportTicket>> LoadTicketsAsync(int conversationId)
    {
        await using var context = _harness.Database.CreateContext();
        return await context.SupportTickets.AsNoTracking().Where(t => t.ConversationId == conversationId).ToListAsync();
    }

    // ---------------------------------------------------------------- Story 1: customer enquiries

    [Fact]
    public async Task Enquiry_RepliesWithTheAIAnswer_AndCreatesNoTicket()
    {
        _harness.AI.ChatReply = (_, _) => "We're open 8am to 8pm, Monday to Saturday.";

        var response = await _harness.SendAsync("What are your opening hours?");

        Assert.Equal(RequestType.CustomerEnquiry, response.RequestType);
        Assert.Equal("We're open 8am to 8pm, Monday to Saturday.", response.Message);
        Assert.Null(response.TicketId);
        Assert.False(response.Escalated);
    }

    [Fact]
    public async Task Enquiry_FollowUp_SendsTheConversationSoFarToTheAI()
    {
        var first = await _harness.SendAsync("What are your opening hours?");
        await _harness.SendAsync("And on Sundays?", first.ConversationId);

        var history = _harness.AI.Histories.Last();
        Assert.Equal(3, history.Count); // question, answer, follow-up
        Assert.Equal("What are your opening hours?", history[0].Content);
        Assert.Equal(AIChatRole.Assistant, history[1].Role);
        Assert.Equal("And on Sundays?", history[2].Content);
    }

    [Fact]
    public async Task Enquiry_WhenTheAIIsDown_StillAnswersWithAFallback()
    {
        _harness.AI.Fail = true;

        var response = await _harness.SendAsync("What are your opening hours?");

        Assert.Contains("unable to answer", response.Message);
        Assert.Null(response.TicketId);
    }

    // ---------------------------------------------------------------- Story 2: technical support

    [Fact]
    public async Task TechnicalSupport_RaisesATicketStraightAway_AndEscalates()
    {
        var response = await _harness.SendAsync("I need an engineer to install a new phone socket");

        Assert.Equal(RequestType.TechnicalSupport, response.RequestType);
        Assert.True(response.Escalated);
        Assert.NotNull(response.TicketId);

        var ticket = Assert.Single(await LoadTicketsAsync(response.ConversationId));
        Assert.Equal(RequestType.TechnicalSupport, ticket.Type);
        Assert.Equal(TicketStatus.AwaitingTechnician, ticket.Status);
        Assert.Contains(ticket.Reference, response.Message);
        Assert.Equal(ticket.Reference, response.TicketReference);
        Assert.Equal(ConversationStatus.Escalated, response.ConversationStatus);
        Assert.Equal(ConversationStatus.Escalated, (await LoadConversationAsync(response.ConversationId)).Status);
        Assert.Single(_harness.Notifier.Created);
    }

    [Fact]
    public async Task TechnicalSupport_SecondRequestInTheSameConversation_ReusesTheOpenTicket()
    {
        var first = await _harness.SendAsync("I need an engineer to install a new phone socket");
        var second = await _harness.SendAsync("Can the engineer also install a second socket upstairs?", first.ConversationId);

        Assert.Equal(first.TicketId, second.TicketId);
        Assert.Single(await LoadTicketsAsync(first.ConversationId));
    }

    [Fact]
    public async Task TechnicalSupport_UnrelatedToTelegroup_IsDeclinedWithoutATicket()
    {
        _harness.AI.ChatReply = (_, _) => "[OUT_OF_SCOPE] Sorry, I can only help with Telegroup telecoms services.";

        var response = await _harness.SendAsync("I need an engineer to fix my boiler");

        Assert.Null(response.TicketId);
        Assert.Equal(RequestType.CustomerEnquiry, response.RequestType);
        Assert.DoesNotContain("[OUT_OF_SCOPE]", response.Message);
        Assert.Empty(await LoadTicketsAsync(response.ConversationId));
    }

    // ---------------------------------------------------------------- Story 3: service issues

    [Fact]
    public async Task ServiceIssue_GivesStepsAndAsksIfTheyWorked()
    {
        var response = await _harness.SendAsync("My internet keeps dropping out");

        Assert.Equal(RequestType.ServiceIssue, response.RequestType);
        Assert.Contains("Restart your router", response.Message);
        Assert.Contains("Did that fix the problem?", response.Message);
        Assert.Equal(ConversationStatus.Troubleshooting, (await LoadConversationAsync(response.ConversationId)).Status);
    }

    [Fact]
    public async Task ServiceIssue_AnsweredNo_HandsOverToATechnicianWithTheWholeStory()
    {
        var steps = await _harness.SendAsync("My internet keeps dropping out");
        var handover = await _harness.SendAsync("No, it's still not working", steps.ConversationId);

        Assert.True(handover.Escalated);
        Assert.NotNull(handover.TicketId);

        var ticket = Assert.Single(await LoadTicketsAsync(steps.ConversationId));
        Assert.Equal(RequestType.ServiceIssue, ticket.Type);
        Assert.Contains("keeps dropping out", ticket.Description);
        Assert.Contains("still not working", ticket.Description);
        Assert.Equal(ConversationStatus.Escalated, (await LoadConversationAsync(steps.ConversationId)).Status);
    }

    [Fact]
    public async Task ServiceIssue_AnsweredYes_ResolvesTheConversation()
    {
        var steps = await _harness.SendAsync("My internet keeps dropping out");
        var done = await _harness.SendAsync("Yes, that fixed it", steps.ConversationId);

        Assert.Null(done.TicketId);
        Assert.Equal(ConversationStatus.Resolved, (await LoadConversationAsync(steps.ConversationId)).Status);
    }

    [Fact]
    public async Task ServiceIssue_WithoutDetails_AsksWhatIsWrongBeforeTroubleshooting()
    {
        _harness.AI.ChatReply = (_, _) => "[NEED_DETAILS] What's happening with your service?";

        var response = await _harness.SendAsync("My internet is not working");

        Assert.Equal("What's happening with your service?", response.Message);
        Assert.DoesNotContain("Did that fix", response.Message);
        Assert.Equal(ConversationStatus.Active, (await LoadConversationAsync(response.ConversationId)).Status);
    }

    [Fact]
    public async Task ServiceIssue_ReplyThatAsksAndGivesSteps_StillStartsTroubleshooting()
    {
        // Seen with a real model: it marked the reply as needing details but listed steps anyway.
        _harness.AI.ChatReply = (_, _) =>
            "[NEED_DETAILS] Is it every device?\n1. Restart your router.\n2. Move closer to the router.";

        var response = await _harness.SendAsync("My wifi is really slow");

        Assert.Equal(ConversationStatus.Troubleshooting, response.ConversationStatus);
        Assert.Contains("Did that fix the problem?", response.Message);
        Assert.DoesNotContain("[NEED_DETAILS]", response.Message);

        var resolved = await _harness.SendAsync("Yes, that fixed it", response.ConversationId);
        Assert.Equal(ConversationStatus.Resolved, resolved.ConversationStatus);
    }

    [Fact]
    public async Task ServiceIssue_ReplyWithoutSteps_DoesNotAskWhetherTheyWorked()
    {
        _harness.AI.ChatReply = (_, _) => "That sounds frustrating. Is it affecting every device in the house?";

        var response = await _harness.SendAsync("My internet keeps dropping out");

        Assert.Equal(ConversationStatus.Active, response.ConversationStatus);
        Assert.DoesNotContain("Did that fix", response.Message);
    }

    [Fact]
    public async Task ServiceIssue_AfterATicketIsRaised_StillNotWorking_GoesToTheTicket_NotNewTroubleshooting()
    {
        // Seen with a real model: troubleshooting failed, a ticket was raised, and "still not working"
        // then started troubleshooting again.
        _harness.AI.Fail = true;
        var escalated = await _harness.SendAsync("My internet keeps dropping out");
        Assert.NotNull(escalated.TicketId);

        _harness.AI.Fail = false;
        var followUp = await _harness.SendAsync("No, it's still not working", escalated.ConversationId);

        Assert.Equal(escalated.TicketId, followUp.TicketId);
        Assert.Equal(ConversationStatus.Escalated, followUp.ConversationStatus);
        Assert.DoesNotContain("Did that fix", followUp.Message);
        Assert.Single(await LoadTicketsAsync(escalated.ConversationId));
    }

    [Fact]
    public async Task Replies_AreShownAsPlainText_EvenWhenTheModelUsesMarkdown()
    {
        _harness.AI.ChatReply = (_, _) => "**Home broadband**\n\n* Fibre\n* Copper";

        var response = await _harness.SendAsync("What broadband packages do you offer?");

        Assert.Equal("Home broadband\n\n- Fibre\n- Copper", response.Message);
    }

    [Fact]
    public async Task ServiceIssue_WhenTroubleshootingIsUnavailable_GoesStraightToATicket()
    {
        _harness.AI.Fail = true;

        var response = await _harness.SendAsync("My internet keeps dropping out");

        Assert.NotNull(response.TicketId);
        Assert.True(response.Escalated);
    }

    // ---------------------------------------------------------------- Story 4: complaints

    [Fact]
    public async Task Complaint_WithoutDetails_AsksWhatHappened_ThenLogsTheDetails()
    {
        var ask = await _harness.SendAsync("I want to make a complaint");

        Assert.Null(ask.TicketId);
        Assert.Contains("Could you tell me what happened?", ask.Message);
        Assert.Empty(await LoadTicketsAsync(ask.ConversationId));

        var logged = await _harness.SendAsync("I was charged twice on my bill last month", ask.ConversationId);

        var ticket = Assert.Single(await LoadTicketsAsync(ask.ConversationId));
        Assert.Equal(RequestType.Complaint, ticket.Type);
        Assert.Equal(TicketStatus.Open, ticket.Status);
        Assert.Equal("Billing", ticket.Category);
        Assert.Equal(ticket.Id, logged.TicketId);
        Assert.Equal(ticket.Reference, logged.TicketReference);
        Assert.Contains(ticket.Reference, logged.Message);
        Assert.StartsWith("CMP-", ticket.Reference);
    }

    [Theory]
    [InlineData("The engineer missed two appointments and nobody called")]
    [InlineData("My broadband keeps dropping out and nobody has fixed it in a month")]
    public async Task Complaint_DetailsThatMentionAFault_AreLoggedAsTheComplaint_NotANewTicket(string details)
    {
        var ask = await _harness.SendAsync("I want to make a complaint");
        var logged = await _harness.SendAsync(details, ask.ConversationId);

        Assert.Equal(RequestType.Complaint, logged.RequestType);
        var ticket = Assert.Single(await LoadTicketsAsync(ask.ConversationId));
        Assert.Equal(RequestType.Complaint, ticket.Type);
    }

    [Fact]
    public async Task Complaint_CustomerChangesTheirMindWithAQuestion_IsAnswered()
    {
        var ask = await _harness.SendAsync("I want to make a complaint");
        var answered = await _harness.SendAsync("Actually, what are your opening hours?", ask.ConversationId);

        Assert.Equal(RequestType.CustomerEnquiry, answered.RequestType);
        Assert.Empty(await LoadTicketsAsync(ask.ConversationId));
    }

    [Fact]
    public async Task Complaint_HighSeverity_IsEscalatedToSeniorStaff()
    {
        var response = await _harness.SendAsync("This is unacceptable, I'm taking legal action over a data breach");

        Assert.True(response.Escalated);
        Assert.Contains("escalated to a senior member", response.Message);

        var ticket = Assert.Single(await LoadTicketsAsync(response.ConversationId));
        Assert.Equal(TicketSeverity.High, ticket.Severity);
        Assert.True(ticket.Escalated);
    }

    [Fact]
    public async Task Complaint_OnceLogged_EndsTheSession()
    {
        var logged = await _harness.SendAsync("I want to complain, the engineer was rude to me");

        Assert.Equal(ConversationStatus.Closed, logged.ConversationStatus);
        Assert.Equal(ConversationStatus.Closed, (await LoadConversationAsync(logged.ConversationId)).Status);
        Assert.Contains("This conversation is now closed", logged.Message);
    }

    [Fact]
    public async Task EndedConversation_RefusesFurtherMessages_WithoutLoggingAnotherComplaint()
    {
        var logged = await _harness.SendAsync("I want to complain, the engineer was rude to me");

        var error = await Assert.ThrowsAsync<ConflictException>(() =>
            _harness.SendAsync("This is unacceptable, I want to complain again", logged.ConversationId));

        Assert.Contains("start a new conversation", error.Message);
        Assert.Single(await LoadTicketsAsync(logged.ConversationId));
    }

    // ---------------------------------------------------------------- validation and ownership

    [Fact]
    public async Task AnotherCustomersConversation_IsReportedAsNotFound()
    {
        var mine = await _harness.SendAsync("What are your opening hours?", customerId: 1);

        await Assert.ThrowsAsync<NotFoundException>(() =>
            _harness.SendAsync("Let me in", mine.ConversationId, customerId: 2));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task EmptyMessage_IsRejectedBeforeAnythingIsSaved(string message)
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _harness.SendAsync(message));

        await using var context = _harness.Database.CreateContext();
        Assert.Empty(context.Conversations);
    }

    [Fact]
    public async Task UnknownCustomer_IsNotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _harness.SendAsync("Hello", customerId: 999));
    }
}
