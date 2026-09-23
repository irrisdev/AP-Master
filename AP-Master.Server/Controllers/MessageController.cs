namespace AP_Master.Server.Controllers;

using AP_Master.Server.DTOs;
using AP_Master.Server.Services;
using Microsoft.AspNetCore.Mvc;

/// <summary>
/// Raw message storage and history. To send a message and get the assistant's reply, use POST /api/chat.
/// </summary>
[Route("api/conversations/{conversationId:int}/messages")]
[ApiController]
[Produces("application/json")]
public class MessagesController : ControllerBase
{
    private readonly IMessageService _messageService;

    public MessagesController(IMessageService messageService)
    {
        _messageService = messageService;
    }

    /// <summary>Gets the full message history of a conversation, oldest first.</summary>
    /// <response code="200">Messages returned (may be empty).</response>
    /// <response code="404">Conversation not found.</response>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<MessageResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<MessageResponse>>> GetMessages(int conversationId, CancellationToken cancellationToken)
    {
        return Ok(await _messageService.GetConversationMessagesAsync(conversationId, cancellationToken));
    }

    /// <summary>Stores a customer message without generating a reply.</summary>
    /// <response code="201">Message stored.</response>
    /// <response code="400">Message empty or too long.</response>
    /// <response code="404">Conversation not found.</response>
    [HttpPost]
    [ProducesResponseType(typeof(MessageResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<MessageResponse>> AddMessage(int conversationId, [FromBody] CreateMessageRequest request, CancellationToken cancellationToken)
    {
        var message = await _messageService.AddCustomerMessageAsync(conversationId, request.Content, cancellationToken);
        return CreatedAtAction(nameof(GetMessages), new { conversationId }, message);
    }
}