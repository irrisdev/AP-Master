namespace AP_Master.Server.Models;


public enum ComplaintStatus
{
    Open,
    InProgress,
    Resolved,
    Closed
}

public enum ComplaintSeverity
{
    Low,
    Medium,
    High
}

public class Complaint
{
    public int Id { get; set; }

    public int CustomerId { get; set; }

    public Customer Customer { get; set; } = null!;

    public int? ConversationId { get; set; }

    public Conversation? Conversation { get; set; }

    public string Reference { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string Category { get; set; } = string.Empty;

    public ComplaintSeverity Severity { get; set; }

    public ComplaintStatus Status { get; set; } = ComplaintStatus.Open;

    public bool Escalated { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}