using AP_Master.Server.Properties;

namespace AP_Master.Server.DTOs;

using System.ComponentModel.DataAnnotations;

public class CreateMessageRequest
{
    [Required, StringLength(MessageLimits.CustomerMaxLength, MinimumLength = 1)]
    public string Content { get; set; } = string.Empty;
}

public class MessageResponse
{
    public int Id { get; set; }
    public int ConversationId { get; set; }
    public string Sender { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}