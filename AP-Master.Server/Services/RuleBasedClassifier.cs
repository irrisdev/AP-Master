namespace AP_Master.Server.Services;

using System.Text;
using AP_Master.Server.Enums;

/// <summary>
/// Deterministic, weighted keyword classifier. Each matching phrase adds its weight to one request type;
/// the highest score wins and a confidence is calculated from how clear the win was.
/// </summary>
public class RuleBasedClassifier
{
    /// <summary>A score at or above this counts as a strong, unambiguous signal.</summary>
    private const int StrongSignalWeight = 3;

    private static readonly RequestType[] TieBreakOrder =
    {
        RequestType.Complaint,
        RequestType.TechnicalSupport,
        RequestType.ServiceIssue,
        RequestType.CustomerEnquiry
    };

    private sealed record Signal(string Phrase, RequestType Type, int Weight);

    private static readonly Signal[] Signals = BuildSignals();

    public ClassificationResult Classify(string? message)
    {
        var text = Normalise(message);
        var scores = new Dictionary<RequestType, int>();
        var matched = new List<string>();

        foreach (var signal in Signals)
        {
            if (!Matches(text, signal.Phrase))
                continue;

            scores[signal.Type] = scores.GetValueOrDefault(signal.Type) + signal.Weight;
            matched.Add($"{signal.Type}:{signal.Phrase.TrimEnd('*')}({signal.Weight:+0;-0})");
        }

        var positive = scores.Where(s => s.Value > 0).ToList();

        if (positive.Count == 0)
            return new ClassificationResult(RequestType.CustomerEnquiry, 0, ClassificationSource.Default, matched);

        var best = positive
            .OrderByDescending(s => s.Value)
            .ThenBy(s => Array.IndexOf(TieBreakOrder, s.Key))
            .First();

        // Share of the total score (how clear the win is) x strength of the winning score.
        // One strong phrase = 1.0; one weak phrase = 0.33; strong but contested (3 vs 2) = 0.6.
        var total = positive.Sum(s => s.Value);
        var confidence = (double)best.Value / total * Math.Min(1.0, (double)best.Value / StrongSignalWeight);

        return new ClassificationResult(best.Key, Math.Round(confidence, 2), ClassificationSource.Rules, matched);
    }

    /// <summary>
    /// A phrase must match whole words. A trailing * matches any word ending,
    /// e.g. "complain*" matches complain, complaint, complaints, complaining.
    /// </summary>
    private static bool Matches(string paddedText, string phrase) =>
        phrase.EndsWith('*')
            ? paddedText.Contains(" " + phrase[..^1], StringComparison.Ordinal)
            : paddedText.Contains(" " + phrase + " ", StringComparison.Ordinal);

    /// <summary>Lower-case, unify apostrophes, turn punctuation into spaces, collapse spaces, pad with a space each side.</summary>
    internal static string Normalise(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return string.Empty;

        var sb = new StringBuilder(message.Length + 2).Append(' ');
        var lastWasSpace = true;

        foreach (var original in message.ToLowerInvariant())
        {
            var c = original is '\u2019' or '\u2018' ? '\'' : original;

            if (char.IsLetterOrDigit(c) || c == '\'')
            {
                sb.Append(c);
                lastWasSpace = false;
            }
            else if (!lastWasSpace)
            {
                sb.Append(' ');
                lastWasSpace = true;
            }
        }

        if (!lastWasSpace)
            sb.Append(' ');

        return sb.Length <= 1 ? string.Empty : sb.ToString();
    }

    private static Signal[] BuildSignals()
    {
        var signals = new List<Signal>();

        void Add(RequestType type, int weight, params string[] phrases)
        {
            foreach (var phrase in phrases)
                signals.Add(new Signal(phrase, type, weight));
        }

        // ---- Complaint: dissatisfaction, wanting to complain or escalate ----
        Add(RequestType.Complaint, 3,
            "complain*", "unacceptable", "disgusted", "disgraceful", "appalling", "furious", "ombudsman",
            "compensation", "speak to a manager", "speak to your manager", "speak to someone senior",
            "terrible service", "awful service", "poor service", "rubbish service", "worst service");
        Add(RequestType.Complaint, 2,
            "unhappy", "not happy", "disappointed", "frustrat*", "angry", "fed up", "sick of", "ridiculous",
            "escalate", "rude", "overcharged", "charged twice", "wrongly charged", "cancel my contract",
            "switch provider", "leave telegroup");
        Add(RequestType.Complaint, 1,
            "refund", "still waiting", "worst");
        // Negations cancel out the "complain*" match.
        Add(RequestType.Complaint, -3,
            "no complain*", "not complaining", "not a complaint");

        // ---- TechnicalSupport: equipment or work that needs a technician, so a ticket straight away ----
        Add(RequestType.TechnicalSupport, 3,
            "engineer*", "technician*", "install*", "technical support", "replacement router",
            "router is broken", "broken router", "router is damaged", "won't turn on", "wont turn on",
            "doesn't turn on", "doesnt turn on", "not turning on", "won't power on", "no power");
        Add(RequestType.TechnicalSupport, 2,
            "set up", "setup", "new router", "faulty", "damaged", "hardware", "wiring", "socket",
            "no lights", "red light", "configur*", "port forwarding", "static ip");
        Add(RequestType.TechnicalSupport, 1,
            "technical", "router", "modem", "broken", "cable", "flashing");

        // ---- ServiceIssue: an existing service misbehaving, so troubleshoot first ----
        Add(RequestType.ServiceIssue, 3,
            "outage", "no internet", "no signal", "no connection", "internet is down", "keeps dropping",
            "dropping out", "drops out", "intermittent*", "packet loss", "no dial tone");
        Add(RequestType.ServiceIssue, 2,
            "slow*", "not working", "isn't working", "isnt working", "stopped working", "disconnect*",
            "buffering", "can't connect", "cant connect", "cannot connect", "unable to connect");
        Add(RequestType.ServiceIssue, 1,
            "down", "lag*", "wifi", "wi fi", "internet", "broadband", "speed*", "connection", "phone line");

        // ---- CustomerEnquiry: questions about products, accounts and information ----
        Add(RequestType.CustomerEnquiry, 3,
            "opening hours", "available in my area");
        Add(RequestType.CustomerEnquiry, 2,
            "how much", "price*", "pricing", "cost*", "upgrade", "package*", "do you offer",
            "availability", "direct debit", "change my address", "moving house");
        Add(RequestType.CustomerEnquiry, 1,
            "plan", "plans", "contract", "deal", "deals", "offer*", "how do i", "how can i", "can i",
            "what is", "my bill", "payment*", "account");

        return signals.ToArray();
    }
}