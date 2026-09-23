using AP_Master.Server.DTOs;
using AP_Master.Server.Services;
using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Controllers;

[Route("api/conversations")]
[ApiController]
[Produces("application/json")]
public class ConversationsController : ControllerBase
{
    private readonly IConversationService _conversationService;

    public ConversationsController(IConversationService conversationService)
    {
        _conversationService = conversationService;
    }

    /// <summary>Starts a new conversation for an existing customer.</summary>
    /// <response code="201">Conversation created.</response>
    /// <response code="400">Invalid request.</response>
    /// <response code="404">Customer not found.</response>
    [HttpPost]
    [ProducesResponseType(typeof(ConversationResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ConversationResponse>> Create([FromBody] CreateConversationRequest request, CancellationToken cancellationToken)
    {
        var conversation = await _conversationService.CreateAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = conversation.Id }, conversation);
    }

    /// <summary>Gets a conversation by ID.</summary>
    /// <response code="200">Conversation found.</response>
    /// <response code="404">Conversation not found.</response>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(ConversationResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ConversationResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        return Ok(await _conversationService.GetByIdAsync(id, cancellationToken));
    }
}
