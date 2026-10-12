using System.Net;
using AP_Server_Tests.TestSupport;

namespace AP_Server_Tests.Integration;

/// <summary>Runs the app with a deliberately small chat allowance so the limiter can be observed.</summary>
public class TightRateLimitFactory : TelegroupApiFactory
{
    protected override IReadOnlyDictionary<string, string> Settings => new Dictionary<string, string>(base.Settings)
    {
        ["RateLimiting:Chat:TokenLimit"] = "3",
        ["RateLimiting:Chat:TokensPerPeriod"] = "1",
        ["RateLimiting:Chat:PeriodSeconds"] = "60",
    };
}

public class RateLimitingTests : IClassFixture<TightRateLimitFactory>
{
    private readonly HttpClient _client;

    public RateLimitingTests(TightRateLimitFactory factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Chat_OverTheAllowance_Is429WithRetryAfter_AndOtherEndpointsStillWork()
    {
        var customer = await _client.CreateCustomerAsync();

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await _client.PostChatAsync(customer.Id, "What are your opening hours?")).StatusCode);

        var limited = await _client.PostChatAsync(customer.Id, "What are your opening hours?");

        var problem = await limited.AssertProblemAsync(HttpStatusCode.TooManyRequests);
        Assert.Contains("too quickly", problem.GetProperty("detail").GetString());
        Assert.True(limited.Headers.RetryAfter?.Delta > TimeSpan.Zero, "429 should say when to retry.");

        // The chat limit is separate from the rest of the API.
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/tickets")).StatusCode);
    }
}
