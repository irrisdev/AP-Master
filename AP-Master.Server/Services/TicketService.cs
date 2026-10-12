using AP_Master.Server.Data;
using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

public interface ITicketService
{
    // Used by ChatService. Complaints get a category, severity and escalation decided by business rules.
    Task<SupportTicket> CreateTicketAsync(
        int customerId,
        int? conversationId,
        RequestType type,
        string description,
        CancellationToken cancellationToken = default);

    // Used by TicketsController / staff dashboard
    Task<IReadOnlyList<TicketResponse>> GetAllAsync(
        TicketStatus? status = null,
        RequestType? type = null,
        TicketSeverity? severity = null,
        bool? escalated = null,
        int? customerId = null,
        CancellationToken cancellationToken = default);

    Task<TicketResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<TicketResponse> UpdateStatusAsync(int id, TicketStatus status, CancellationToken cancellationToken = default);
    Task<TicketResponse> CloseAsync(int id, CancellationToken cancellationToken = default);
    Task<TicketResponse> EscalateAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>The newest non-complaint ticket in this conversation that is still open, if any.</summary>
    Task<SupportTicket?> GetOpenSupportTicketAsync(int conversationId, CancellationToken cancellationToken = default);

    /// <summary>The newest complaint ticket in this conversation that is still open, if any.</summary>
    Task<SupportTicket?> GetOpenComplaintAsync(int conversationId, CancellationToken cancellationToken = default);

    /// <summary>Whether any complaint ticket, in any status, has been logged in this conversation.</summary>
    Task<bool> AnyComplaintForConversationAsync(int conversationId, CancellationToken cancellationToken = default);
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

    public Task<SupportTicket?> GetOpenSupportTicketAsync(int conversationId, CancellationToken cancellationToken = default) =>
        GetOpenForConversationAsync(conversationId, complaints: false, cancellationToken);

    public Task<SupportTicket?> GetOpenComplaintAsync(int conversationId, CancellationToken cancellationToken = default) =>
        GetOpenForConversationAsync(conversationId, complaints: true, cancellationToken);

    public Task<bool> AnyComplaintForConversationAsync(int conversationId, CancellationToken cancellationToken = default) =>
        _dbContext.SupportTickets.AnyAsync(t => t.ConversationId == conversationId && t.Type == RequestType.Complaint, cancellationToken);

    private Task<SupportTicket?> GetOpenForConversationAsync(int conversationId, bool complaints, CancellationToken cancellationToken) =>
        _dbContext.SupportTickets
            .AsNoTracking()
            .Where(t => t.ConversationId == conversationId &&
                        (t.Type == RequestType.Complaint) == complaints &&
                        (t.Status == TicketStatus.Open || t.Status == TicketStatus.AwaitingTechnician || t.Status == TicketStatus.InProgress))
            .OrderByDescending(t => t.Id)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<SupportTicket> CreateTicketAsync(int customerId, int? conversationId, RequestType type, string description, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(description))
            throw new BadRequestException("Ticket description cannot be empty.");

        if (type == RequestType.CustomerEnquiry)
            throw new BadRequestException("Customer enquiries do not create tickets.");

        var ticket = new SupportTicket
        {
            CustomerId = customerId,
            ConversationId = conversationId,
            Type = type,
            Description = description.Trim(),
            Reference = GenerateReference(type),
            Status = TicketStatus.AwaitingTechnician,
        };

        if (type == RequestType.Complaint)
        {
            var severity = DetermineSeverity(description);

            ticket.Status = TicketStatus.Open;
            ticket.Category = DetermineCategory(description);
            ticket.Severity = severity;

            // Severity and escalation are decided by business rules, not by the AI.
            ticket.Escalated = severity == TicketSeverity.High;
        }

        _dbContext.SupportTickets.Add(ticket);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Created {Type} ticket {Reference} ({TicketId}) for customer {CustomerId} (conversation {ConversationId}): {Category}, {Severity}, escalated={Escalated}",
            type, ticket.Reference, ticket.Id, customerId, conversationId, ticket.Category, ticket.Severity, ticket.Escalated);

        return ticket;
    }

    public async Task<IReadOnlyList<TicketResponse>> GetAllAsync(
        TicketStatus? status = null,
        RequestType? type = null,
        TicketSeverity? severity = null,
        bool? escalated = null,
        int? customerId = null,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.SupportTickets.AsNoTracking();

        if (status.HasValue)
            query = query.Where(t => t.Status == status.Value);

        if (type.HasValue)
            query = query.Where(t => t.Type == type.Value);

        if (severity.HasValue)
            query = query.Where(t => t.Severity == severity.Value);

        if (escalated.HasValue)
            query = query.Where(t => t.Escalated == escalated.Value);

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
            throw new ConflictException($"Ticket {ticket.Reference} is closed and cannot be reopened.");

        var previous = ticket.Status;
        ticket.Status = status;
        ticket.UpdatedAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Ticket {Reference} ({TicketId}) status changed from {From} to {To}", ticket.Reference, id, previous, status);

        return ToResponse(ticket);
    }

    public async Task<TicketResponse> CloseAsync(int id, CancellationToken cancellationToken = default)
    {
        var ticket = await FindTrackedAsync(id, cancellationToken);

        if (ticket.Status == TicketStatus.Closed)
            throw new ConflictException($"Ticket {ticket.Reference} is already closed.");

        return await UpdateStatusAsync(id, TicketStatus.Closed, cancellationToken);
    }

    public async Task<TicketResponse> EscalateAsync(int id, CancellationToken cancellationToken = default)
    {
        var ticket = await FindTrackedAsync(id, cancellationToken);

        if (ticket.Escalated)
            throw new ConflictException($"Ticket {ticket.Reference} has already been escalated.");

        ticket.Escalated = true;
        ticket.UpdatedAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Ticket {Reference} ({TicketId}) manually escalated", ticket.Reference, id);

        return ToResponse(ticket);
    }

    private async Task<SupportTicket> FindTrackedAsync(int id, CancellationToken cancellationToken) =>
        await _dbContext.SupportTickets.FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
        ?? throw new NotFoundException($"Ticket {id} was not found.");

    // 8 random hex characters: collisions are practically impossible, and the reference is known before saving.
    private static string GenerateReference(RequestType type) =>
        $"{(type == RequestType.Complaint ? "CMP" : "TKT")}-{Guid.NewGuid().ToString("N")[..8].ToUpperInvariant()}";

    private static TicketSeverity DetermineSeverity(string description)
    {
        var text = description.ToLowerInvariant();

        if (text.Contains("legal") ||
            text.Contains("court") ||
            text.Contains("data breach") ||
            text.Contains("danger"))
        {
            return TicketSeverity.High;
        }

        if (text.Contains("refund") ||
            text.Contains("billing") ||
            text.Contains("charged"))
        {
            return TicketSeverity.Medium;
        }

        return TicketSeverity.Low;
    }

    private static string DetermineCategory(string description)
    {
        var text = description.ToLowerInvariant();

        if (text.Contains("bill") || text.Contains("charged") || text.Contains("refund"))
            return "Billing";

        if (text.Contains("internet") || text.Contains("broadband"))
            return "Service";

        if (text.Contains("technician") || text.Contains("technical"))
            return "Technical Support";

        return "General";
    }

    private static TicketResponse ToResponse(SupportTicket t) => new()
    {
        Id = t.Id,
        Reference = t.Reference,
        Type = t.Type,
        CustomerId = t.CustomerId,
        ConversationId = t.ConversationId,
        Description = t.Description,
        Status = t.Status,
        Category = t.Category,
        Severity = t.Severity,
        Escalated = t.Escalated,
        CreatedAt = t.CreatedAt,
        UpdatedAt = t.UpdatedAt
    };
}
