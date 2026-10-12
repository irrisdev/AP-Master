namespace AP_Master.Server.Services;

/// <summary>
/// Decides whether a complaint message says what actually went wrong, or only that the customer
/// wants to complain ("I want to make a complaint"). A complaint with no details is useless to the
/// staff reviewing it, so the chatbot asks for them before logging anything.
/// </summary>
public static class ComplaintDetails
{
    // Words that express the wish to complain (or are filler) rather than describing the problem.
    private static readonly HashSet<string> IntentWords = new(StringComparer.Ordinal)
    {
        "i", "i'd", "id", "i'm", "im", "i've", "ive", "me", "my", "we", "we'd",
        "want", "wanna", "would", "like", "need", "wish", "have", "got", "to", "do",
        "make", "file", "lodge", "raise", "submit", "register", "log", "put", "in", "open", "start",
        "a", "an", "the", "this", "that", "it", "is", "am", "be", "something", "some",
        "complain", "complains", "complaint", "complaints", "complaining", "formal", "official",
        "please", "pls", "plz", "hi", "hello", "hey", "hiya", "ok", "okay", "yes", "yeah", "yea",
        "can", "could", "you", "help", "with", "about", "for", "how", "so", "just", "really", "very",
        "again", "now", "today", "here", "there", "one", "another", "new"
    };

    /// <summary>True if the message contains at least one word that describes the problem itself.</summary>
    public static bool HasDetails(string? message)
    {
        var words = RuleBasedClassifier.Normalise(message)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries);

        return words.Any(word => !IntentWords.Contains(word));
    }
}
