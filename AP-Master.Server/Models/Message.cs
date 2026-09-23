namespace AP_Master.Server.Models;

public class Message
{
    public int Id { get; set; }

    public int ConversationId { get; set; }

    public Conversation Conversation { get; set; } = null!;

    public string Sender { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}