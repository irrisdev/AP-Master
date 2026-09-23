using AP_Master.Server.Data;
using AP_Master.Server.DTOs;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Services;

public interface ICustomerService
{
    Task<CustomerResponse> CreateAsync(CreateCustomerRequest request, CancellationToken cancellationToken = default);
    Task<CustomerResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<CustomerResponse?> FindByEmailAsync(string email, CancellationToken cancellationToken = default);
    Task<bool> ExistsAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>Throws NotFoundException if the customer does not exist.</summary>
    Task EnsureExistsAsync(int id, CancellationToken cancellationToken = default);
}

public class CustomerService : ICustomerService
{
    private readonly TelegroupDbContext _dbContext;
    private readonly ILogger<CustomerService> _logger;

    public CustomerService(TelegroupDbContext dbContext, ILogger<CustomerService> logger)
    {
        _dbContext = dbContext;
        
        _logger = logger;
    }

    public async Task<CustomerResponse> CreateAsync(CreateCustomerRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var name = request.Name?.Trim() ?? string.Empty;
        var email = NormaliseEmail(request.Email);

        if (name.Length == 0)
            throw new BadRequestException("Customer name is required.");
        if (email.Length == 0)
            throw new BadRequestException("Customer email is required.");

        if (await EmailExistsAsync(email, cancellationToken))
            throw new ConflictException("A customer with this email address already exists.");

        var customer = new Customer { Name = name, Email = email };
        _dbContext.Customers.Add(customer);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another request may have registered the same email between the check and the insert
            // (requires a unique index on Customer.Email to be caught here).
            _dbContext.Entry(customer).State = EntityState.Detached;

            if (await EmailExistsAsync(email, cancellationToken))
                throw new ConflictException("A customer with this email address already exists.");

            throw;
        }

        _logger.LogInformation("Created customer {CustomerId}", customer.Id);
        return ToResponse(customer);
    }

    public async Task<CustomerResponse> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken)
            ?? throw new NotFoundException($"Customer {id} was not found.");

        return ToResponse(customer);
    }

    public async Task<CustomerResponse?> FindByEmailAsync(string email, CancellationToken cancellationToken = default)
    {
        var normalised = NormaliseEmail(email);
        if (normalised.Length == 0)
            return null;

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Email.ToLower() == normalised, cancellationToken);

        return customer is null ? null : ToResponse(customer);
    }

    public Task<bool> ExistsAsync(int id, CancellationToken cancellationToken = default) =>
        _dbContext.Customers.AnyAsync(c => c.Id == id, cancellationToken);

    public async Task EnsureExistsAsync(int id, CancellationToken cancellationToken = default)
    {
        if (!await ExistsAsync(id, cancellationToken))
            throw new NotFoundException($"Customer {id} was not found.");
    }

    private Task<bool> EmailExistsAsync(string normalisedEmail, CancellationToken cancellationToken) =>
        _dbContext.Customers.AnyAsync(c => c.Email.ToLower() == normalisedEmail, cancellationToken);

    private static string NormaliseEmail(string? email) =>
        (email ?? string.Empty).Trim().ToLowerInvariant();

    private static CustomerResponse ToResponse(Customer customer) => new()
    {
        Id = customer.Id,
        Name = customer.Name,
        Email = customer.Email
    };
}