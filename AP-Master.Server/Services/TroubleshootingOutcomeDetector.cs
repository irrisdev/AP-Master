using AP_Master.Server.Enums;

namespace AP_Master.Server.Services;

/// <summary>
/// Decides whether a customer's reply to troubleshooting steps means the issue is fixed.
/// Rule-based for now, isolated behind an interface so it can be replaced with AI later
/// (same approach as IClassificationService).
/// </summary>
public interface ITroubleshootingOutcomeDetector
{
    TroubleshootingOutcome Detect(string message);
}

public class TroubleshootingOutcomeDetector : ITroubleshootingOutcomeDetector
{
    private static readonly string[] NotResolvedPhrases =
    {
        "not working", "still not", "still broken", "still down", "still getting", "still having",
        "still no", "still the same", "didn't work", "didnt work", "did not work", "didn't help",
        "didnt help", "did not help", "doesn't work", "doesnt work", "does not work", "not fixed",
        "not resolved", "unresolved", "same problem", "same issue", "no luck", "no change"
    };

    private static readonly string[] ResolvedPhrases =
    {
        "fixed", "working now", "works now", "resolved", "sorted", "that worked", "it worked",
        "all good", "problem solved", "back up", "back online", "that helped"
    };

    public TroubleshootingOutcome Detect(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return TroubleshootingOutcome.Unclear;

        var text = message.Trim().ToLowerInvariant();

        // Negatives are checked first: "thanks, but it's still not working" must not count as resolved,
        // and "not fixed" contains "fixed".
        if (NotResolvedPhrases.Any(p => text.Contains(p)) || StartsWithWord(text, "no"))
            return TroubleshootingOutcome.NotResolved;

        if (ResolvedPhrases.Any(p => text.Contains(p)) || StartsWithWord(text, "yes"))
            return TroubleshootingOutcome.Resolved;

        return TroubleshootingOutcome.Unclear;
    }

    // Matches "no", "no.", "no it isn't" but not "nothing" or "now".
    private static bool StartsWithWord(string text, string word) =>
        text.StartsWith(word) && (text.Length == word.Length || !char.IsLetter(text[word.Length]));
}