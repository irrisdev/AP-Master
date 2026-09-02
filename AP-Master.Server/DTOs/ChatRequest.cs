using System.ComponentModel.DataAnnotations;

namespace AP_Master.Server.DTOs;

public class ChatRequest
{
    [Required]
    public int CustomerId { get; set; }

    public int? ConversationId { get; set; }

    [Required]
    [MinLength(1)]
    [MaxLength(2000)]
    public string Message { get; set; } = string.Empty;
}