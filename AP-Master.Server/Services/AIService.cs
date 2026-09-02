namespace AP_Master.Server.Services;

public interface IAIService
{
    Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default);
}
public class AIService : IAIService
{
    public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
