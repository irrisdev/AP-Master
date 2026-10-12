using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace AP_Master.Server.Models;

public class Customer
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Conversation> Conversations { get; set; } = new List<Conversation>();

    public ICollection<SupportTicket> SupportTickets { get; set; } = new List<SupportTicket>();
}