using AP_Master.Server.Models;

namespace AP_Master.Server.DTOs.Chat;

public class ChatResponse
{
    public int ConversationId { get; set; }

    public RequestType RequestType { get; set; }

    public string Message { get; set; } = string.Empty;

    public bool Escalated { get; set; }

    public int? TicketId { get; set; }
}