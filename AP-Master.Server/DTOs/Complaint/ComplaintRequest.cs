using System.ComponentModel.DataAnnotations;

namespace AP_Master.Server.DTOs.Complaint;

public class ComplaintRequest
{
    [Required]
    public int CustomerId { get; set; }

    public int? ConversationId { get; set; }

    [Required]
    [MinLength(5)]
    [MaxLength(5000)]
    public string Description { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? Category { get; set; }
}