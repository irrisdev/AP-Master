using AP_Master.Server.Enums;

namespace AP_Master.Server.Models;

public class Conversation
{
    public int Id { get; set; }

    public int CustomerId { get; set; }

    public Customer Customer { get; set; } = null!;

    public RequestType RequestType { get; set; }

    public ConversationStatus Status { get; set; } = ConversationStatus.Active;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Message> Messages { get; set; } = new List<Message>();

    public ICollection<SupportTicket> SupportTickets { get; set; } = new List<SupportTicket>();

    public ICollection<Complaint> Complaints { get; set; } = new List<Complaint>();
}