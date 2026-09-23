using AP_Master.Server.DTOs;
using AP_Master.Server.Enums;
using AP_Master.Server.Services;
using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Controllers;

[Route("api/complaints")]
[ApiController]
[Produces("application/json")]
public class ComplaintsController : ControllerBase
{
    private readonly IComplaintService _complaintService;

    public ComplaintsController(IComplaintService complaintService)
    {
        _complaintService = complaintService;
    }

    /// <summary>Lists complaints, newest first. Optionally filter by status, severity and/or escalation.</summary>
    /// <response code="200">Complaints returned (may be empty).</response>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<ComplaintResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ComplaintResponse>>> GetAll(
        [FromQuery] ComplaintStatus? status,
        [FromQuery] ComplaintSeverity? severity,
        [FromQuery] bool? escalated,
        CancellationToken cancellationToken)
    {
        return Ok(await _complaintService.GetAllAsync(status, severity, escalated, cancellationToken));
    }

    /// <summary>Gets a complaint by ID.</summary>
    /// <response code="200">Complaint found.</response>
    /// <response code="404">Complaint not found.</response>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(ComplaintResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ComplaintResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        return Ok(await _complaintService.GetByIdAsync(id, cancellationToken));
    }

    /// <summary>Manually escalates a complaint to senior staff.</summary>
    /// <response code="200">Complaint escalated.</response>
    /// <response code="404">Complaint not found.</response>
    /// <response code="409">Complaint was already escalated.</response>
    [HttpPost("{id:int}/escalate")]
    [ProducesResponseType(typeof(ComplaintResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ComplaintResponse>> Escalate(int id, CancellationToken cancellationToken)
    {
        return Ok(await _complaintService.EscalateAsync(id, cancellationToken));
    }
}