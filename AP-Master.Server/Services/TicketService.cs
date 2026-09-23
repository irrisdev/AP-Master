using AP_Master.Server.Data;
using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

/// <summary>Customer-facing ticket reference, derived from the ID so no extra column is needed.</summary>
public static class TicketReference
{
    public static string For(int ticketId) => $"TKT-{ticketId:D6}";
}

public interface ITicketService
{
    // Used by ChatService
    Task<SupportTicket> CreateTicketAsync(
        int customerId,
        int? conversationId,
        string description,
        CancellationToken cancellationToken = default);

    // Used by TicketsController / staff dashboard
    Task<IReadOnlyList<TicketResponse>> GetAllAsync(TicketStatus? status = null, int? customerId = null, CancellationToken cancellationToken = default);
    Task<TicketResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<TicketResponse> UpdateStatusAsync(int id, TicketStatus status, CancellationToken cancellationToken = default);
    Task<TicketResponse> CloseAsync(int id, CancellationToken cancellationToken = default);
}

public class TicketService : ITicketService
{
    private readonly TelegroupDbContext _dbContext;
    private readonly ILogger<TicketService> _logger;

    public TicketService(TelegroupDbContext dbContext, ILogger<TicketService> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<SupportTicket> CreateTicketAsync(int customerId, int? conversationId, string description, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(description))
            throw new BadRequestException("Ticket description cannot be empty.");

        var ticket = new SupportTicket
        {
            CustomerId = customerId,
            ConversationId = conversationId,
            Description = description.Trim(),
            Status = TicketStatus.AwaitingTechnician,
        };

        _dbContext.SupportTickets.Add(ticket);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Created ticket {TicketId} for customer {CustomerId} (conversation {ConversationId})",
            ticket.Id, customerId, conversationId);

        return ticket;
    }

    public async Task<IReadOnlyList<TicketResponse>> GetAllAsync(TicketStatus? status = null, int? customerId = null, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.SupportTickets.AsNoTracking();

        if (status.HasValue)
            query = query.Where(t => t.Status == status.Value);

        if (customerId.HasValue)
            query = query.Where(t => t.CustomerId == customerId.Value);

        var tickets = await query
            .OrderByDescending(t => t.Id) // newest first
            .ToListAsync(cancellationToken);

        return tickets.Select(ToResponse).ToList();
    }

    public async Task<TicketResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var ticket = await _dbContext.SupportTickets
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
            ?? throw new NotFoundException($"Ticket {id} was not found.");

        return ToResponse(ticket);
    }

    public async Task<TicketResponse> UpdateStatusAsync(int id, TicketStatus status, CancellationToken cancellationToken = default)
    {
        var ticket = await FindTrackedAsync(id, cancellationToken);

        if (ticket.Status == status)
            return ToResponse(ticket); // nothing to change

        if (ticket.Status == TicketStatus.Closed)
            throw new ConflictException($"Ticket {TicketReference.For(id)} is closed and cannot be reopened.");

        var previous = ticket.Status;
        ticket.Status = status;
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Ticket {TicketId} status changed from {From} to {To}", id, previous, status);

        return ToResponse(ticket);
    }

    public async Task<TicketResponse> CloseAsync(int id, CancellationToken cancellationToken = default)
    {
        var ticket = await FindTrackedAsync(id, cancellationToken);

        if (ticket.Status == TicketStatus.Closed)
            throw new ConflictException($"Ticket {TicketReference.For(id)} is already closed.");

        return await UpdateStatusAsync(id, TicketStatus.Closed, cancellationToken);
    }

    private async Task<SupportTicket> FindTrackedAsync(int id, CancellationToken cancellationToken) =>
        await _dbContext.SupportTickets.FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
        ?? throw new NotFoundException($"Ticket {id} was not found.");

    private static TicketResponse ToResponse(SupportTicket t) => new()
    {
        Id = t.Id,
        Reference = TicketReference.For(t.Id),
        CustomerId = t.CustomerId,
        ConversationId = t.ConversationId,
        Description = t.Description,
        Status = t.Status
    };
}