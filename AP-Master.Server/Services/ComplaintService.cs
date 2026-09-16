using AP_Master.Server.Data;
using AP_Master.Server.Enums;
using AP_Master.Server.Models;

namespace AP_Master.Server.Services;

public interface IComplaintService
{
    Task<Complaint> CreateComplaintAsync(
        int customerId,
        int? conversationId,
        string description,
        CancellationToken cancellationToken = default);
}

public class ComplaintService : IComplaintService
{
    private readonly TelegroupDbContext _context;

    public ComplaintService(TelegroupDbContext context)
    {
        _context = context;
    }

    public async Task<Complaint> CreateComplaintAsync(int customerId, int? conversationId, string description, CancellationToken cancellationToken = default)
    {
        var severity = DetermineSeverity(description);

        var complaint = new Complaint
        {
            CustomerId = customerId,
            ConversationId = conversationId,
            Description = description,
            Category = DetermineCategory(description),
            Severity = severity,
            Status = ComplaintStatus.Open,

            // Assert severity via logic rather than relying on AI response
            Escalated = severity == ComplaintSeverity.High,

            Reference = $"C-{Random.Shared.Next(10000, 99999)}"
        };

        await _context.Complaints.AddAsync(complaint, cancellationToken);

        await _context.SaveChangesAsync(cancellationToken);

        return complaint;
    }

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
        {
            return "Billing";
        }

        if (text.Contains("internet") || text.Contains("broadband"))
        {
            return "Service";
        }

        if (text.Contains("technician") || text.Contains("technical"))
        {
            return "Technical Support";
        }

        return "General";
    }
}