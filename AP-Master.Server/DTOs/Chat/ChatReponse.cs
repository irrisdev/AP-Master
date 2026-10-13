using AP_Master.Server.Enums;

namespace AP_Master.Server.DTOs.Chat;

public class ChatResponse
{
    public int ConversationId { get; set; }

    /// <summary>The conversation's status after this turn. Closed means the session has ended.</summary>
    public ConversationStatus ConversationStatus { get; set; }

    public RequestType RequestType { get; set; }

    public string Message { get; set; } = string.Empty;

    public bool Escalated { get; set; }

    /// <summary>Set when the reply relates to a ticket: one just raised, or an open one being followed up.</summary>
    public int? TicketId { get; set; }

    /// <summary>The customer-facing reference of that ticket, e.g. TKT-1A2B3C4D or CMP-6D4A1140.</summary>
    public string? TicketReference { get; set; }
}
