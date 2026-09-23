namespace AP_Master.Server.DTOs;

using System.ComponentModel.DataAnnotations;
using AP_Master.Server.Enums;

public class CreateConversationRequest
{
    [Range(1, int.MaxValue)]
    public int CustomerId { get; set; }

    /// <summary>Initial request type. Defaults to CustomerEnquiry; the chat flow updates it as messages arrive.</summary>
    public RequestType RequestType { get; set; } = RequestType.CustomerEnquiry;
}

public class ConversationResponse
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public RequestType RequestType { get; set; }
    public ConversationStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}