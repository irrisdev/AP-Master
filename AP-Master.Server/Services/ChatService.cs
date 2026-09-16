using AP_Master.Server.Data;
using AP_Master.Server.DTOs.Chat;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

public interface IChatService
{
    Task<ChatResponse> ProcessMessageAsync(ChatRequest request, CancellationToken cancellationToken = default);
    Task<ChatResponse> HandleCustomerEnquiryAsync(Conversation conversation, string message, CancellationToken cancellationToken = default);
    Task<ChatResponse> HandleTechnicalSupportAsync(Conversation conversation, string message, CancellationToken cancellationToken = default);
    Task<ChatResponse> HandleServiceIssueAsync(Conversation conversation, string message, CancellationToken cancellationToken = default);
    Task<ChatResponse> HandleComplaintAsync(Conversation conversation, string message, CancellationToken cancellationToken = default);
    Task SaveAIMessageAsync(int conversationId, string response, CancellationToken cancellationToken = default);
}
public class ChatService : IChatService
{
    private readonly TelegroupDbContext _dbContext;
    private readonly IClassificationService _classificationService;
    private readonly IComplaintService _complaintService;
    private readonly IAIService _aiService;
    private readonly ITicketService _ticketService;
    public ChatService(
        TelegroupDbContext dbContext,
        IClassificationService classificationService,
        IComplaintService complaintService,
        IAIService aiService,
        ITicketService ticketService)
    {
        _dbContext = dbContext;
        _classificationService = classificationService;
        _complaintService = complaintService;
        _aiService = aiService;
        _ticketService = ticketService;
    }

    public async Task<ChatResponse> ProcessMessageAsync(ChatRequest request, CancellationToken cancellationToken = default)
    {
        var requestType = _classificationService.Classify(request.Message);

        Conversation conversation;

        if (request.ConversationId.HasValue)
        {
            conversation = await _dbContext.Conversations
                .FirstOrDefaultAsync(c => c.Id == request.ConversationId.Value, cancellationToken) ?? throw new KeyNotFoundException("Conversation was not found.");
        }
        else
        {
            conversation = new Conversation
            {
                CustomerId = request.CustomerId,
                RequestType = requestType,
                Status = ConversationStatus.Active,
            };

            await _dbContext.Conversations.AddAsync(conversation, cancellationToken);

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var customerMessage = new Message
        {
            ConversationId = conversation.Id,
            Sender = "Customer",
            Content = request.Message,
        };

        await _dbContext.Messages.AddAsync(customerMessage, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return requestType switch
        {
            RequestType.CustomerEnquiry => await HandleCustomerEnquiryAsync(conversation, request.Message, cancellationToken),
            RequestType.TechnicalSupport => await HandleTechnicalSupportAsync(conversation, request.Message, cancellationToken),
            RequestType.ServiceIssue => await HandleServiceIssueAsync(conversation, request.Message, cancellationToken),
            RequestType.Complaint => await HandleComplaintAsync(conversation, request.Message, cancellationToken),
            _ => throw new InvalidOperationException("Unsupported request type."),
        };

    }

    public async Task<ChatResponse> HandleComplaintAsync(Conversation conversation, string message, CancellationToken cancellationToken = default)
    {
        var complaint = await _complaintService.CreateComplaintAsync(conversation.CustomerId, conversation.Id, message, cancellationToken);

        conversation.Status = complaint.Escalated ? ConversationStatus.Escalated : ConversationStatus.Active;

        await _dbContext.SaveChangesAsync(cancellationToken);

        var response = $"Your complaint has been recorded. Your complaint reference is {complaint.Reference}";

        await SaveAIMessageAsync(conversation.Id, response, cancellationToken);

        return new ChatResponse
        {
            ConversationId = conversation.Id,
            RequestType = RequestType.Complaint,
            Message = response,
            Escalated = complaint.Escalated
        };
    }

    public async Task<ChatResponse> HandleCustomerEnquiryAsync(Conversation conversation, string message, CancellationToken cancellationToken = default)
    {
        var prompt = $"""
            You are the Telegroup Limited customer service assistant.

            Answer the customer's question clearly and professionaly.

            Customer message: {message}

            Do not invent customer account information,
            prices, policies or technical information.
            If you are uncertain, explain that the customer should be transferred to a human agent for further assistance.
            """;

        var aiResponse = await _aiService.GenerateResponseAsync(prompt, cancellationToken);

        await SaveAIMessageAsync(conversation.Id, aiResponse, cancellationToken);

        return new ChatResponse
        {
            ConversationId = conversation.Id,
            RequestType = conversation.RequestType,
            Message = aiResponse,
            Escalated = false,
        };

    }

    public async Task<ChatResponse> HandleServiceIssueAsync(Conversation conversation, string message, CancellationToken cancellationToken = default)
    {
        conversation.Status = ConversationStatus.Troubleshooting;

        var prompt = $"""
            You are a Telegroup technical troubleshooting assistant.

            Provide simple, safe troubleshooting instructions
            for the customer's service issue.

            Customer issue:
            {message}

            Do not ask the customer to perform dangerous actions.
            """;

        var aiResponse = await _aiService.GenerateResponseAsync(prompt, cancellationToken);

        await SaveAIMessageAsync(conversation.Id, aiResponse, cancellationToken);

        return new ChatResponse
        {
            ConversationId = conversation.Id,
            RequestType = conversation.RequestType,
            Message = aiResponse,
            Escalated = false,
        };
    }

    public async Task<ChatResponse> HandleTechnicalSupportAsync(Conversation conversation, string message, CancellationToken cancellationToken = default)
    {
        var ticket = await _ticketService.CreateTicketAsync(conversation.CustomerId, conversation.Id, message, cancellationToken);

        conversation.Status = ConversationStatus.Escalated;

        await _dbContext.SaveChangesAsync(cancellationToken);

        var response = 
            $"Your request has been passed to out technical support team. " +
            $"A support ticket has been created with ID: {ticket.Id}. " +
            $"Our team will reach out to you shortly.";

        return new ChatResponse
        {
            ConversationId = conversation.Id,
            RequestType = conversation.RequestType,
            Message = response,
            Escalated = true,
            TicketId = ticket.Id
        };
    }



    public async Task SaveAIMessageAsync(int conversationId, string response, CancellationToken cancellationToken = default)
    {
        var message = new Message
        {
            ConversationId = conversationId,
            Sender = "AI",
            Content = response,
        };

        await _dbContext.Messages.AddAsync(message, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}
