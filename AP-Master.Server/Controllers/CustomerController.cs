using AP_Master.Server.DTOs;
using AP_Master.Server.Services;
using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Controllers;

[Route("api/customers")]
[ApiController]
[Produces("application/json")]
public class CustomersController : ControllerBase
{
    private readonly ICustomerService _customerService;
    private readonly IConversationService _conversationService;

    public CustomersController(ICustomerService customerService, IConversationService conversationService)
    {
        _customerService = customerService;
        _conversationService = conversationService;
    }

    /// <summary>Registers a new customer.</summary>
    /// <response code="201">Customer created.</response>
    /// <response code="400">Name or email missing or invalid.</response>
    /// <response code="409">A customer with this email already exists.</response>
    [HttpPost]
    [ProducesResponseType(typeof(CustomerResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<CustomerResponse>> Create([FromBody] CreateCustomerRequest request, CancellationToken cancellationToken)
    {
        var customer = await _customerService.CreateAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = customer.Id }, customer);
    }

    /// <summary>Gets a customer by ID.</summary>
    /// <response code="200">Customer found.</response>
    /// <response code="404">Customer not found.</response>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(CustomerResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CustomerResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        return Ok(await _customerService.GetByIdAsync(id, cancellationToken));
    }

    /// <summary>Lists a customer's conversations, most recently updated first.</summary>
    /// <response code="200">Conversations returned (may be empty).</response>
    /// <response code="404">Customer not found.</response>
    [HttpGet("{id:int}/conversations")]
    [ProducesResponseType(typeof(IReadOnlyList<ConversationResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<ConversationResponse>>> GetConversations(int id, CancellationToken cancellationToken)
    {
        return Ok(await _conversationService.GetByCustomerAsync(id, cancellationToken));
    }
}