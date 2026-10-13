using System.Net;
using System.Text.Json;

namespace AP_Server_Tests.TestSupport;

public static class ProblemDetailsAssertions
{
    /// <summary>Asserts the response is RFC 7807 ProblemDetails with the given status and a trace ID.</summary>
    public static async Task<JsonElement> AssertProblemAsync(this HttpResponseMessage response, HttpStatusCode expected)
    {
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement.Clone();

        Assert.Equal((int)expected, root.GetProperty("status").GetInt32());
        Assert.True(root.TryGetProperty("traceId", out var traceId) && traceId.GetString()!.Length > 0,
            "ProblemDetails should carry a traceId.");

        return root;
    }
}
