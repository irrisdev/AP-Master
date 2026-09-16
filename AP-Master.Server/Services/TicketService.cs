using AP_Master.Server.Data;
using AP_Master.Server.Enums;
using AP_Master.Server.Models;

namespace AP_Master.Server.Services;

public interface ITicketService
{
    Task<SupportTicket> CreateTicketAsync(
        int customerId, 
        int? conversationId, 
        string description, 
        CancellationToken cancellationToken = default);
}

public class TicketService : ITicketService
{
    private readonly TelegroupDbContext _dbContext;
    public TicketService(TelegroupDbContext dbContext)
    {
        _dbContext = dbContext;
    }
    public async Task<SupportTicket> CreateTicketAsync(int customerId, int? conversationId, string description, CancellationToken cancellationToken = default)
    {
        var ticket = new SupportTicket
        {
            CustomerId = customerId,
            ConversationId = conversationId,
            Description = description,
            Status = TicketStatus.AwaitingTechnician,
        };

        await _dbContext.SupportTickets.AddAsync(ticket, cancellationToken);

        await _dbContext.SaveChangesAsync();

        return ticket;


    }
}
