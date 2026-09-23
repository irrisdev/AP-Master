namespace AP_Master.Server.DTOs;

using AP_Master.Server.Enums;

public class ComplaintResponse
{
    public int Id { get; set; }
    public string Reference { get; set; } = string.Empty;
    public int CustomerId { get; set; }
    public int? ConversationId { get; set; }
    public string Description { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public ComplaintSeverity Severity { get; set; }
    public ComplaintStatus Status { get; set; }
    public bool Escalated { get; set; }
}