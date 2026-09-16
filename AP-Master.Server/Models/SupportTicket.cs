using AP_Master.Server.Enums;

namespace AP_Master.Server.Models;

public class SupportTicket
{
    public int Id { get; set; }

    public int CustomerId { get; set; }

    public Customer Customer { get; set; } = null!;

    public int? ConversationId { get; set; }

    public Conversation? Conversation { get; set; }

    public string Description { get; set; } = string.Empty;

    public TicketStatus Status { get; set; } = TicketStatus.AwaitingTechnician;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}