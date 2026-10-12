using System.Net;
using System.Net.Http.Json;
using AP_Master.Server.DTOs;
using AP_Master.Server.DTOs.Chat;

namespace AP_Server_Tests.TestSupport;

public static class ApiClientExtensions
{
    /// <summary>Registers a new customer with a unique email, so tests sharing a database don't interfere.</summary>
    public static async Task<CustomerResponse> CreateCustomerAsync(this HttpClient client, string name = "Test Customer")
    {
        var response = await client.PostAsJsonAsync("/api/customers",
            new CreateCustomerRequest { Name = name, Email = $"{Guid.NewGuid():N}@test.example" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CustomerResponse>())!;
    }

    public static Task<HttpResponseMessage> PostChatAsync(this HttpClient client, int customerId, string message, int? conversationId = null) =>
        client.PostAsJsonAsync("/api/chat", new ChatRequest { CustomerId = customerId, ConversationId = conversationId, Message = message });

    public static async Task<ChatResponse> ChatAsync(this HttpClient client, int customerId, string message, int? conversationId = null)
    {
        var response = await client.PostChatAsync(customerId, message, conversationId);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ChatResponse>())!;
    }

    public static async Task<IReadOnlyList<TicketResponse>> GetTicketsAsync(this HttpClient client, string query = "")
    {
        var tickets = await client.GetFromJsonAsync<List<TicketResponse>>($"/api/tickets{query}");
        return tickets!;
    }
}
