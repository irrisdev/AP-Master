using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Master.Server.Services;
using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Controllers;

[Route("api/tickets")]
[ApiController]
[Produces("application/json")]
public class TicketsController : ControllerBase
{
    private readonly ITicketService _ticketService;

    public TicketsController(ITicketService ticketService)
    {
        _ticketService = ticketService;
    }

    /// <summary>
    /// Lists tickets (support requests and complaints), newest first.
    /// Optionally filter by status, type (TechnicalSupport, ServiceIssue, Complaint), severity, escalation and/or customer.
    /// </summary>
    /// <response code="200">Tickets returned (may be empty).</response>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<TicketResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<TicketResponse>>> GetAll(
        [FromQuery] TicketStatus? status,
        [FromQuery] RequestType? type,
        [FromQuery] TicketSeverity? severity,
        [FromQuery] bool? escalated,
        [FromQuery] int? customerId,
        CancellationToken cancellationToken)
    {
        return Ok(await _ticketService.GetAllAsync(status, type, severity, escalated, customerId, cancellationToken));
    }

    /// <summary>Gets a ticket by ID.</summary>
    /// <response code="200">Ticket found.</response>
    /// <response code="404">Ticket not found.</response>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(TicketResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TicketResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        return Ok(await _ticketService.GetByIdAsync(id, cancellationToken));
    }

    /// <summary>Changes a ticket's status (e.g. AwaitingTechnician → InProgress → Resolved). Closed tickets cannot be reopened.</summary>
    /// <response code="200">Status updated.</response>
    /// <response code="400">Missing or invalid status.</response>
    /// <response code="404">Ticket not found.</response>
    /// <response code="409">Ticket is closed.</response>
    [HttpPut("{id:int}/status")]
    [ProducesResponseType(typeof(TicketResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TicketResponse>> UpdateStatus(int id, [FromBody] UpdateTicketStatusRequest request, CancellationToken cancellationToken)
    {
        return Ok(await _ticketService.UpdateStatusAsync(id, request.Status!.Value, cancellationToken));
    }

    /// <summary>Closes a ticket.</summary>
    /// <response code="200">Ticket closed.</response>
    /// <response code="404">Ticket not found.</response>
    /// <response code="409">Ticket is already closed.</response>
    [HttpPost("{id:int}/close")]
    [ProducesResponseType(typeof(TicketResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TicketResponse>> Close(int id, CancellationToken cancellationToken)
    {
        return Ok(await _ticketService.CloseAsync(id, cancellationToken));
    }

    /// <summary>Manually escalates a ticket to senior staff.</summary>
    /// <response code="200">Ticket escalated.</response>
    /// <response code="404">Ticket not found.</response>
    /// <response code="409">Ticket was already escalated.</response>
    [HttpPost("{id:int}/escalate")]
    [ProducesResponseType(typeof(TicketResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TicketResponse>> Escalate(int id, CancellationToken cancellationToken)
    {
        return Ok(await _ticketService.EscalateAsync(id, cancellationToken));
    }
}