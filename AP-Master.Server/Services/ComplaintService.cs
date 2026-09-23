using AP_Master.Server.Data;
using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

public interface IComplaintService
{
    // Used by ChatService
    Task<Complaint> CreateComplaintAsync(
        int customerId,
        int? conversationId,
        string description,
        CancellationToken cancellationToken = default);

    // Used by ComplaintsController / staff dashboard
    Task<IReadOnlyList<ComplaintResponse>> GetAllAsync(
        ComplaintStatus? status = null,
        ComplaintSeverity? severity = null,
        bool? escalated = null,
        CancellationToken cancellationToken = default);

    Task<ComplaintResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<ComplaintResponse> EscalateAsync(int id, CancellationToken cancellationToken = default);
}

public class ComplaintService : IComplaintService
{
    private readonly TelegroupDbContext _context;
    private readonly ILogger<ComplaintService> _logger;

    public ComplaintService(TelegroupDbContext context, ILogger<ComplaintService> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<Complaint> CreateComplaintAsync(int customerId, int? conversationId, string description, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(description))
            throw new BadRequestException("Complaint description cannot be empty.");

        var severity = DetermineSeverity(description);

        var complaint = new Complaint
        {
            CustomerId = customerId,
            ConversationId = conversationId,
            Description = description.Trim(),
            Category = DetermineCategory(description),
            Severity = severity,
            Status = ComplaintStatus.Open,

            // Severity and escalation are decided by business rules, not by the AI.
            Escalated = severity == ComplaintSeverity.High,

            Reference = GenerateReference()
        };

        _context.Complaints.Add(complaint);
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Created complaint {Reference} ({ComplaintId}) for customer {CustomerId}: {Category}, {Severity}, escalated={Escalated}",
            complaint.Reference, complaint.Id, customerId, complaint.Category, severity, complaint.Escalated);

        return complaint;
    }

    public async Task<IReadOnlyList<ComplaintResponse>> GetAllAsync(
        ComplaintStatus? status = null,
        ComplaintSeverity? severity = null,
        bool? escalated = null,
        CancellationToken cancellationToken = default)
    {
        var query = _context.Complaints.AsNoTracking();

        if (status.HasValue)
            query = query.Where(c => c.Status == status.Value);

        if (severity.HasValue)
            query = query.Where(c => c.Severity == severity.Value);

        if (escalated.HasValue)
            query = query.Where(c => c.Escalated == escalated.Value);

        var complaints = await query
            .OrderByDescending(c => c.Id) // newest first
            .ToListAsync(cancellationToken);

        return complaints.Select(ToResponse).ToList();
    }

    public async Task<ComplaintResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var complaint = await _context.Complaints
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken)
            ?? throw new NotFoundException($"Complaint {id} was not found.");

        return ToResponse(complaint);
    }

    public async Task<ComplaintResponse> EscalateAsync(int id, CancellationToken cancellationToken = default)
    {
        var complaint = await _context.Complaints.FirstOrDefaultAsync(c => c.Id == id, cancellationToken)
            ?? throw new NotFoundException($"Complaint {id} was not found.");

        if (complaint.Escalated)
            throw new ConflictException($"Complaint {complaint.Reference} has already been escalated.");

        complaint.Escalated = true;
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Complaint {Reference} ({ComplaintId}) manually escalated", complaint.Reference, id);

        return ToResponse(complaint);
    }

    // 8 random hex characters: collisions are practically impossible, unlike a 5-digit random number.
    private static string GenerateReference() =>
        $"CMP-{Guid.NewGuid().ToString("N")[..8].ToUpperInvariant()}";

    private static ComplaintSeverity DetermineSeverity(string description)
    {
        var text = description.ToLowerInvariant();

        if (text.Contains("legal") ||
            text.Contains("court") ||
            text.Contains("data breach") ||
            text.Contains("danger"))
        {
            return ComplaintSeverity.High;
        }

        if (text.Contains("refund") ||
            text.Contains("billing") ||
            text.Contains("charged"))
        {
            return ComplaintSeverity.Medium;
        }

        return ComplaintSeverity.Low;
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

    private static ComplaintResponse ToResponse(Complaint c) => new()
    {
        Id = c.Id,
        Reference = c.Reference,
        CustomerId = c.CustomerId,
        ConversationId = c.ConversationId,
        Description = c.Description,
        Category = c.Category,
        Severity = c.Severity,
        Status = c.Status,
        Escalated = c.Escalated
    };
}