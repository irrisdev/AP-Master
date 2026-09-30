namespace AP_Master.Server.Services;

public enum AIChatRole
{
    User,
    Assistant
}

/// <summary>One turn of conversation history sent to the AI provider.</summary>
public sealed record AIChatMessage(AIChatRole Role, string Content);

/// <summary>
/// Prepares stored conversation history for an AI request: keeps only the most recent turns
/// that fit the budget, and fixes the shape so every provider accepts it.
/// Pure and dependency-free, so it is easy to unit test.
/// </summary>
public static class AIChatHistory
{
    public static IReadOnlyList<AIChatMessage> Prepare(
        IEnumerable<AIChatMessage> history, int maxMessages, int maxCharacters)
    {
        ArgumentNullException.ThrowIfNull(history);

        var cleaned = history
            .Where(m => !string.IsNullOrWhiteSpace(m.Content))
            .Select(m => m with { Content = m.Content.Trim() })
            .ToList();

        // Walk backwards from the newest message, keeping as many as fit the limits.
        var kept = new List<AIChatMessage>();
        var characters = 0;

        for (var i = cleaned.Count - 1; i >= 0; i--)
        {
            var message = cleaned[i];

            if (kept.Count >= maxMessages)
                break;

            // Always keep the newest message, even if it alone exceeds the character budget.
            if (kept.Count > 0 && characters + message.Content.Length > maxCharacters)
                break;

            kept.Add(message);
            characters += message.Content.Length;
        }

        kept.Reverse();

        // Most providers expect the conversation to start with the user,
        // so drop any assistant messages left at the front after trimming.
        var start = kept.FindIndex(m => m.Role == AIChatRole.User);
        if (start < 0)
            return Array.Empty<AIChatMessage>();

        // Merge consecutive messages from the same sender (e.g. a customer message whose
        // reply failed to save), because some models require user/assistant to alternate.
        var result = new List<AIChatMessage>();
        foreach (var message in kept.Skip(start))
        {
            if (result.Count > 0 && result[^1].Role == message.Role)
                result[^1] = result[^1] with { Content = result[^1].Content + "\n\n" + message.Content };
            else
                result.Add(message);
        }

        return result;
    }
}
