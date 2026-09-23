using AP_Master.Server.Properties;
using AP_Master.Server.Data;
using AP_Master.Server.DTOs;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

public interface IMessageService
{
    /// <summary>Trims and validates customer text. Throws BadRequestException if empty or too long.</summary>
    string ValidateCustomerContent(string? content);

    Task<MessageResponse> AddCustomerMessageAsync(int conversationId, string content, CancellationToken cancellationToken = default);
    Task<MessageResponse> AddAssistantMessageAsync(int conversationId, string content, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<MessageResponse>> GetConversationMessagesAsync(int conversationId, CancellationToken cancellationToken = default);
}

public class MessageService : IMessageService
{
    private readonly TelegroupDbContext _dbContext;
    private readonly ILogger<MessageService> _logger;

    public MessageService(TelegroupDbContext dbContext, ILogger<MessageService> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    public string ValidateCustomerContent(string? content)
    {
        var trimmed = content?.Trim() ?? string.Empty;

        if (trimmed.Length == 0)
            throw new BadRequestException("Message cannot be empty.");

        if (trimmed.Length > MessageLimits.CustomerMaxLength)
            throw new BadRequestException($"Message cannot exceed {MessageLimits.CustomerMaxLength} characters.");

        return trimmed;
    }

    public Task<MessageResponse> AddCustomerMessageAsync(int conversationId, string content, CancellationToken cancellationToken = default) =>
        AddAsync(conversationId, MessageSenders.Customer, ValidateCustomerContent(content), cancellationToken);

    public Task<MessageResponse> AddAssistantMessageAsync(int conversationId, string content, CancellationToken cancellationToken = default)
    {
        var trimmed = content?.Trim() ?? string.Empty;

        if (trimmed.Length == 0)
            throw new InvalidOperationException("Assistant message cannot be empty.");

        // Never reject an assistant reply the customer is waiting for; truncate it instead.
        if (trimmed.Length > MessageLimits.AssistantMaxLength)
        {
            _logger.LogWarning("Assistant reply for conversation {ConversationId} truncated from {Length} characters",
                conversationId, trimmed.Length);
            trimmed = trimmed[..(MessageLimits.AssistantMaxLength - 1)] + "…";
        }

        return AddAsync(conversationId, MessageSenders.Assistant, trimmed, cancellationToken);
    }

    public async Task<IReadOnlyList<MessageResponse>> GetConversationMessagesAsync(int conversationId, CancellationToken cancellationToken = default)
    {
        if (!await _dbContext.Conversations.AnyAsync(c => c.Id == conversationId, cancellationToken))
            throw new NotFoundException($"Conversation {conversationId} was not found.");

        return await _dbContext.Messages
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .Select(m => new MessageResponse
            {
                Id = m.Id,
                ConversationId = m.ConversationId,
                Sender = m.Sender,
                Content = m.Content,
                CreatedAt = m.CreatedAt
            })
            .ToListAsync(cancellationToken);
    }

    private async Task<MessageResponse> AddAsync(int conversationId, string sender, string content, CancellationToken cancellationToken)
    {
        // FindAsync returns the already-tracked entity if ChatService loaded it in this request.
        var conversation = await _dbContext.Conversations.FindAsync(new object[] { conversationId }, cancellationToken)
            ?? throw new NotFoundException($"Conversation {conversationId} was not found.");

        var now = DateTime.UtcNow;
        var message = new Message
        {
            ConversationId = conversationId,
            Sender = sender,
            Content = content,
            CreatedAt = now
        };

        _dbContext.Messages.Add(message);
        conversation.UpdatedAt = now;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return new MessageResponse
        {
            Id = message.Id,
            ConversationId = message.ConversationId,
            Sender = message.Sender,
            Content = message.Content,
            CreatedAt = message.CreatedAt
        };
    }
}