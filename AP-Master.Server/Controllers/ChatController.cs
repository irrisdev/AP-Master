using AP_Master.Server.DTOs.Chat;
using AP_Master.Server.Middleware;
using AP_Master.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace AP_Master.Server.Controllers;

[Route("api/[controller]")]
[ApiController]
[Produces("application/json")]
public class ChatController : ControllerBase
{
    private readonly IChatService _chatService;

    public ChatController(IChatService chatService)
    {
        _chatService = chatService;
    }

    /// <summary>
    /// Sends a customer message and returns the assistant's reply. Omit ConversationId to start a new conversation.
    /// Depending on the request, this may raise a ticket (a support request or a complaint); its ID is returned as TicketId.
    /// </summary>
    /// <response code="200">Reply generated.</response>
    /// <response code="400">Message empty or too long.</response>
    /// <response code="404">Customer or conversation not found.</response>
    /// <response code="409">The previous message in this conversation is still being processed.</response>
    /// <response code="429">Too many messages; see the Retry-After header.</response>
    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.Chat)]
    [ProducesResponseType(typeof(ChatResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<ChatResponse>> SendMessage([FromBody] ChatRequest request, CancellationToken cancellationToken)
    {
        return Ok(await _chatService.ProcessMessageAsync(request, cancellationToken));
    }
}