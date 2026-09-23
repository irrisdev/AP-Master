namespace AP_Master.Server.DTOs;

using System.ComponentModel.DataAnnotations;
using AP_Master.Server.Enums;

public class TicketResponse
{
    public int Id { get; set; }

    /// <summary>Customer-facing reference, e.g. TKT-000042.</summary>
    public string Reference { get; set; } = string.Empty;

    public int CustomerId { get; set; }
    public int? ConversationId { get; set; }
    public string Description { get; set; } = string.Empty;
    public TicketStatus Status { get; set; }
}

public class UpdateTicketStatusRequest
{
    /// <summary>New status: AwaitingTechnician, InProgress, Resolved or Closed.</summary>
    [Required, EnumDataType(typeof(TicketStatus))]
    public TicketStatus? Status { get; set; }
}