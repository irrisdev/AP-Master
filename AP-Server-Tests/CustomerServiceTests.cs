using AP_Master.Server.DTOs;
using AP_Master.Server.Exceptions;
using AP_Master.Server.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace AP_Server_Tests;

public class CustomerServiceTests : IClassFixture<TestFixture>
{
    private readonly CustomerService _service;
 
    // xUnit injects the shared fixture; a fresh service is created for each test.
    public CustomerServiceTests(TestFixture fixture)
    {
        _service = new CustomerService(fixture.DbContext, NullLogger<CustomerService>.Instance);
    }
 
    [Fact]
    public async Task CreateAsync_ValidCustomer_ReturnsCustomerWithId()
    {
        var request = new CreateCustomerRequest { Name = "Test User", Email = "create@test.com" };
 
        var result = await _service.CreateAsync(request);
 
        Assert.True(result.Id > 0);
        Assert.Equal("create@test.com", result.Email);
    }
 
    [Fact]
    public async Task CreateAsync_DuplicateEmail_ThrowsConflict()
    {
        await _service.CreateAsync(new CreateCustomerRequest { Name = "First", Email = "dupe@test.com" });
 
        await Assert.ThrowsAsync<ConflictException>(() =>
            _service.CreateAsync(new CreateCustomerRequest { Name = "Second", Email = "DUPE@test.com" }));
    }
 
    [Fact]
    public async Task GetByIdAsync_UnknownId_ThrowsNotFound()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _service.GetByIdAsync(999_999));
    }
}