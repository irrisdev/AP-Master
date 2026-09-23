using AP_Master.Server.Data;
using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

public interface IConversationService
{
    // API-facing operations (return DTOs)
    Task<ConversationResponse> CreateAsync(CreateConversationRequest request, CancellationToken cancellationToken = default);
    Task<ConversationResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ConversationResponse>> GetByCustomerAsync(int customerId, CancellationToken cancellationToken = default);
    Task<bool> ExistsAsync(int id, CancellationToken cancellationToken = default);

    // Chat-flow operations (work with the tracked entity)
    Task<Conversation> StartAsync(int customerId, RequestType requestType, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the conversation only if it belongs to the customer. A conversation owned by someone
    /// else is reported as not found, so callers cannot discover which conversation IDs exist.
    /// </summary>
    Task<Conversation> GetOwnedAsync(int customerId, int conversationId, CancellationToken cancellationToken = default);

    Task UpdateStateAsync(Conversation conversation, ConversationStatus status, RequestType? requestType = null, CancellationToken cancellationToken = default);
}

public class ConversationService : IConversationService
{
    private readonly TelegroupDbContext _dbContext;
    private readonly ICustomerService _customerService;
    private readonly ILogger<ConversationService> _logger;

    public ConversationService(TelegroupDbContext dbContext, ICustomerService customerService, ILogger<ConversationService> logger)
    {
        _dbContext = dbContext;
        _customerService = customerService;
        _logger = logger;
    }

    public async Task<ConversationResponse> CreateAsync(CreateConversationRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var conversation = await StartAsync(request.CustomerId, request.RequestType, cancellationToken);
        return ToResponse(conversation);
    }

    public async Task<ConversationResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var conversation = await _dbContext.Conversations
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken)
            ?? throw new NotFoundException($"Conversation {id} was not found.");

        return ToResponse(conversation);
    }

    public async Task<IReadOnlyList<ConversationResponse>> GetByCustomerAsync(int customerId, CancellationToken cancellationToken = default)
    {
        await _customerService.EnsureExistsAsync(customerId, cancellationToken);

        return await _dbContext.Conversations
            .AsNoTracking()
            .Where(c => c.CustomerId == customerId)
            .OrderByDescending(c => c.UpdatedAt)
            .Select(c => new ConversationResponse
            {
                Id = c.Id,
                CustomerId = c.CustomerId,
                RequestType = c.RequestType,
                Status = c.Status,
                CreatedAt = c.CreatedAt,
                UpdatedAt = c.UpdatedAt
            })
            .ToListAsync(cancellationToken);
    }

    public Task<bool> ExistsAsync(int id, CancellationToken cancellationToken = default) =>
        _dbContext.Conversations.AnyAsync(c => c.Id == id, cancellationToken);

    public async Task<Conversation> StartAsync(int customerId, RequestType requestType, CancellationToken cancellationToken = default)
    {
        await _customerService.EnsureExistsAsync(customerId, cancellationToken);

        var now = DateTime.UtcNow;
        var conversation = new Conversation
        {
            CustomerId = customerId,
            RequestType = requestType,
            Status = ConversationStatus.Active,
            CreatedAt = now,
            UpdatedAt = now
        };

        _dbContext.Conversations.Add(conversation);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Started conversation {ConversationId} for customer {CustomerId} as {RequestType}",
            conversation.Id, customerId, requestType);

        return conversation;
    }

    public async Task<Conversation> GetOwnedAsync(int customerId, int conversationId, CancellationToken cancellationToken = default)
    {
        var conversation = await _dbContext.Conversations
            .FirstOrDefaultAsync(c => c.Id == conversationId, cancellationToken);

        if (conversation is null || conversation.CustomerId != customerId)
        {
            if (conversation is not null)
            {
                _logger.LogWarning("Customer {CustomerId} attempted to access conversation {ConversationId} owned by another customer",
                    customerId, conversationId);
            }

            throw new NotFoundException($"Conversation {conversationId} was not found.");
        }

        return conversation;
    }

    public async Task UpdateStateAsync(Conversation conversation, ConversationStatus status, RequestType? requestType = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(conversation);

        var previousStatus = conversation.Status;

        conversation.Status = status;
        if (requestType.HasValue)
            conversation.RequestType = requestType.Value;
        conversation.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (previousStatus != status)
        {
            _logger.LogInformation("Conversation {ConversationId} status changed from {From} to {To}",
                conversation.Id, previousStatus, status);
        }
    }

    private static ConversationResponse ToResponse(Conversation c) => new()
    {
        Id = c.Id,
        CustomerId = c.CustomerId,
        RequestType = c.RequestType,
        Status = c.Status,
        CreatedAt = c.CreatedAt,
        UpdatedAt = c.UpdatedAt
    };
}