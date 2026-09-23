
using AP_Master.Server.Enums;

namespace AP_Master.Server.Services;

public enum ClassificationSource
{
    /// <summary>Keyword rules matched with enough confidence.</summary>
    Rules,

    /// <summary>Rules were unsure, so the AI chose the category.</summary>
    AI,

    /// <summary>Nothing matched and the AI was unavailable: fell back to CustomerEnquiry.</summary>
    Default
}

/// <param name="Confidence">0 to 1 for rule-based results; null when the AI decided.</param>
/// <param name="MatchedSignals">Which rule phrases matched, for logging and debugging.</param>
public sealed record ClassificationResult(
    RequestType RequestType,
    double? Confidence,
    ClassificationSource Source,
    IReadOnlyList<string> MatchedSignals);