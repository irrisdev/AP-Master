using AP_Master.Server.Enums;

namespace AP_Master.Server.Models;

/// <summary>
/// Anything the chat flow hands over to staff: a technical support request, an unresolved service issue,
/// or a formal complaint. Type says which; Category and Severity are only set for complaints.
/// </summary>
public class SupportTicket
{
    public int Id { get; set; }

    public int CustomerId { get; set; }

    public Customer Customer { get; set; } = null!;

    public int? ConversationId { get; set; }

    public Conversation? Conversation { get; set; }

    /// <summary>TechnicalSupport, ServiceIssue or Complaint.</summary>
    public RequestType Type { get; set; } = RequestType.TechnicalSupport;

    public string Reference { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public TicketStatus Status { get; set; } = TicketStatus.AwaitingTechnician;

    /// <summary>Complaints only.</summary>
    public string? Category { get; set; }

    /// <summary>Complaints only.</summary>
    public TicketSeverity? Severity { get; set; }

    /// <summary>Escalated to senior staff.</summary>
    public bool Escalated { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
