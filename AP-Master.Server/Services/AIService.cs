namespace AP_Master.Server.Services;

public interface IAIService
{
    Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default);
}
public class AIService : IAIService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public AIService(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        return Task.FromResult("not implemented");
    }
}
