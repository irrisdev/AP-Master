using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AP_Master.Server.Services;

public interface IAIService
{
    /// <summary>Single-turn request, for one-off tasks such as classification.</summary>
    Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default);

    /// <summary>
    /// Multi-turn request: the instructions go in a system message and the conversation history
    /// (oldest first, ending with the customer's latest message) follows as user/assistant turns.
    /// </summary>
    Task<string> GenerateChatResponseAsync(
        string systemPrompt,
        IReadOnlyList<AIChatMessage> history,
        CancellationToken cancellationToken = default);
}

/// <summary>Bound from the "AI" section of configuration. The API key comes from user secrets or an environment variable.</summary>
public class AIOptions
{
    public const string SectionName = "AI";

    /// <summary>Any OpenAI-compatible endpoint. Must end with a slash.</summary>
    public string BaseUrl { get; set; } = "https://openrouter.ai/api/v1/";
    public string Model { get; set; } = "openrouter/free";
    public string? ApiKey { get; set; }
    public int TimeoutSeconds { get; set; } = 30;
    public int MaxTokens { get; set; } = 800;

    /// <summary>Most recent messages from the conversation sent with each chat request.</summary>
    public int MaxHistoryMessages { get; set; } = 20;

    /// <summary>Character budget for history, so long conversations don't exceed the model's context window.</summary>
    public int MaxHistoryCharacters { get; set; } = 12000;

    /// <summary>Maximum AI calls in flight at once across the whole server (see AIRequestGate).</summary>
    public int MaxConcurrentRequests { get; set; } = 4;

    /// <summary>How long a request waits for a free AI slot before falling back to its non-AI reply.</summary>
    public int QueueTimeoutSeconds { get; set; } = 10;

    /// <summary>Artificial delay for the placeholder provider, to make load tests behave like a real one.</summary>
    public int DummyLatencyMilliseconds { get; set; }
}

/// <summary>Any failure talking to the AI provider: timeout, network, HTTP error, bad or empty response.</summary>
public class AIServiceException : Exception
{
    public AIServiceException(string message, Exception? innerException = null) : base(message, innerException) { }
}

/// <summary>
/// Calls an OpenAI-compatible chat completions API (OpenRouter by default).
/// Base address, timeout and API key are configured on the typed HttpClient in Program.cs.
/// </summary>
public class AIService : IAIService
{
    private readonly HttpClient _httpClient;
    private readonly AIOptions _options;
    private readonly ILogger<AIService> _logger;

    public AIService(HttpClient httpClient, IOptions<AIOptions> options, ILogger<AIService> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(prompt))
            throw new ArgumentException("Prompt cannot be empty.", nameof(prompt));

        return SendAsync(new[] { new ChatMessage("user", prompt) }, cancellationToken);
    }

    public Task<string> GenerateChatResponseAsync(
        string systemPrompt,
        IReadOnlyList<AIChatMessage> history,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(systemPrompt))
            throw new ArgumentException("System prompt cannot be empty.", nameof(systemPrompt));
        ArgumentNullException.ThrowIfNull(history);

        var turns = AIChatHistory.Prepare(history, _options.MaxHistoryMessages, _options.MaxHistoryCharacters);
        if (turns.Count == 0)
            throw new ArgumentException("History must contain at least one customer message.", nameof(history));

        var messages = new List<ChatMessage> { new("system", systemPrompt) };
        messages.AddRange(turns.Select(t => new ChatMessage(t.Role == AIChatRole.User ? "user" : "assistant", t.Content)));

        return SendAsync(messages, cancellationToken);
    }

    private async Task<string> SendAsync(IReadOnlyList<ChatMessage> messages, CancellationToken cancellationToken)
    {
        var request = new ChatCompletionRequest(_options.Model, messages, _options.MaxTokens);

        var stopwatch = Stopwatch.StartNew();
        HttpResponseMessage response;

        try
        {
            response = await _httpClient.PostAsJsonAsync("chat/completions", request, cancellationToken);
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            // HttpClient.Timeout fired (the caller did not cancel).
            throw new AIServiceException($"AI provider did not respond within {_options.TimeoutSeconds} seconds.", ex);
        }
        catch (HttpRequestException ex)
        {
            throw new AIServiceException("Could not reach the AI provider.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning("AI provider returned HTTP {StatusCode}: {Body}",
                    (int)response.StatusCode, body.Length > 500 ? body[..500] : body);

                throw new AIServiceException($"AI provider returned HTTP {(int)response.StatusCode}.");
            }

            ChatCompletionResponse? result;
            try
            {
                result = await response.Content.ReadFromJsonAsync<ChatCompletionResponse>(cancellationToken);
            }
            catch (JsonException ex)
            {
                throw new AIServiceException("AI provider returned invalid JSON.", ex);
            }

            // Some providers report errors inside a 200 response.
            if (result?.Error is not null)
                throw new AIServiceException($"AI provider error: {result.Error.Message}");

            var content = result?.Choices?.FirstOrDefault()?.Message?.Content?.Trim();
            if (string.IsNullOrEmpty(content))
                throw new AIServiceException("AI provider returned an empty response.");

            _logger.LogInformation("AI response from {Model} in {ElapsedMs} ms",
                result!.Model ?? _options.Model, stopwatch.ElapsedMilliseconds);

            return content;
        }
    }

    // ---- JSON contracts for the OpenAI-compatible chat completions API ----

    private sealed record ChatCompletionRequest(
        [property: JsonPropertyName("model")] string Model,
        [property: JsonPropertyName("messages")] IReadOnlyList<ChatMessage> Messages,
        [property: JsonPropertyName("max_tokens")] int MaxTokens);

    private sealed record ChatMessage(
        [property: JsonPropertyName("role")] string Role,
        [property: JsonPropertyName("content")] string? Content);

    private sealed record ChatCompletionResponse(
        [property: JsonPropertyName("model")] string? Model,
        [property: JsonPropertyName("choices")] IReadOnlyList<Choice>? Choices,
        [property: JsonPropertyName("error")] ApiError? Error);

    private sealed record Choice(
        [property: JsonPropertyName("message")] ChatMessage? Message);

    private sealed record ApiError(
        [property: JsonPropertyName("message")] string? Message);
}