using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AP_Master.Server.Services;

public interface IAIService
{
    Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default);
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

    public async Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(prompt))
            throw new ArgumentException("Prompt cannot be empty.", nameof(prompt));

        var request = new ChatCompletionRequest(
            _options.Model,
            new[] { new ChatMessage("user", prompt) },
            _options.MaxTokens);

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