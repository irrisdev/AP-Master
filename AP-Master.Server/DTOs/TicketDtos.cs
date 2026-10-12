namespace AP_Master.Server.DTOs;

using System.ComponentModel.DataAnnotations;
using AP_Master.Server.Enums;

public class TicketResponse
{
    public int Id { get; set; }

    /// <summary>Customer-facing reference, e.g. TKT-1A2B3C4D for support tickets or CMP-6D4A1140 for complaints.</summary>
    public string Reference { get; set; } = string.Empty;

    /// <summary>TechnicalSupport, ServiceIssue or Complaint.</summary>
    public RequestType Type { get; set; }

    public int CustomerId { get; set; }
    public int? ConversationId { get; set; }
    public string Description { get; set; } = string.Empty;
    public TicketStatus Status { get; set; }

    /// <summary>Complaints only; null for other ticket types.</summary>
    public string? Category { get; set; }

    /// <summary>Complaints only; null for other ticket types.</summary>
    public TicketSeverity? Severity { get; set; }

    public bool Escalated { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class UpdateTicketStatusRequest
{
    /// <summary>New status: Open, AwaitingTechnician, InProgress, Resolved or Closed.</summary>
    [Required, EnumDataType(typeof(TicketStatus))]
    public TicketStatus? Status { get; set; }
}
