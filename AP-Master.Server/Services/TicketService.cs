using AP_Master.Server.Models;

namespace AP_Master.Server.Services;

public interface ITicketService
{
    Task<SupportTicket> CreateTicketAsync(int customerId, int? conversationId, string description, CancellationToken cancellationToken = default);
}

public class TicketService : ITicketService
{
    public Task<SupportTicket> CreateTicketAsync(int customerId, int? conversationId, string description, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
