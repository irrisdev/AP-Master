using System.Net;
using System.Text;
using System.Text.Json;
using AP_Master.Server.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AP_Server_Tests.Unit;

/// <summary>The real AIService against a scripted HTTP handler: no network, real request and response handling.</summary>
public class AIServiceTests
{
    private static readonly IReadOnlyList<AIChatMessage> History = [new(AIChatRole.User, "hello")];

    private static string Completion(string? content) => JsonSerializer.Serialize(new
    {
        model = "test-model",
        choices = new[] { new { message = new { role = "assistant", content } } }
    });

    private static (AIService Service, ScriptedHandler Handler) Create(params Func<HttpResponseMessage>[] responses)
    {
        var handler = new ScriptedHandler(responses);
        var client = new HttpClient(handler) { BaseAddress = new Uri("https://ai.test/") };
        var options = Options.Create(new AIOptions { MaxAttempts = 2, RetryDelayMilliseconds = 0 });
        return (new AIService(client, options, NullLogger<AIService>.Instance), handler);
    }

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    [Fact]
    public async Task EmptyReply_IsRetried_AndTheSecondAnswerUsed()
    {
        var (service, handler) = Create(() => Json(Completion("")), () => Json(Completion("Hello there")));

        var reply = await service.GenerateChatResponseAsync("system", History);

        Assert.Equal("Hello there", reply);
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task ServerError_IsRetried()
    {
        var (service, handler) = Create(() => Json("{}", HttpStatusCode.BadGateway), () => Json(Completion("Recovered")));

        Assert.Equal("Recovered", await service.GenerateResponseAsync("prompt"));
        Assert.Equal(2, handler.Calls);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests)] // retrying a rate limit only spends more quota
    public async Task ClientErrorOrRateLimit_IsNotRetried(HttpStatusCode status)
    {
        var (service, handler) = Create(() => Json("{}", status), () => Json(Completion("never")));

        var error = await Assert.ThrowsAsync<AIServiceException>(() => service.GenerateResponseAsync("prompt"));

        Assert.False(error.Transient);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task GivesUpAfterTheLastAttempt()
    {
        var (service, handler) = Create(() => Json(Completion(null)), () => Json(Completion(null)), () => Json(Completion("too late")));

        await Assert.ThrowsAsync<AIServiceException>(() => service.GenerateResponseAsync("prompt"));
        Assert.Equal(2, handler.Calls);
    }

    private sealed class ScriptedHandler(Func<HttpResponseMessage>[] responses) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(responses[Math.Min(Calls++, responses.Length - 1)]());
    }
}
