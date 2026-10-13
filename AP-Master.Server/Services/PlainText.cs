using System.Text.RegularExpressions;

namespace AP_Master.Server.Services;

/// <summary>
/// Turns an AI reply into plain text. The chat shows text as written, and models add markdown
/// even when asked not to, so "**Home broadband**" would otherwise appear with its asterisks.
/// Lists and line breaks are kept; only the markup goes.
/// </summary>
public static partial class PlainText
{
    public static string From(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return string.Empty;

        var result = text.Replace("\r\n", "\n");
        result = Headings().Replace(result, string.Empty);          // "## Plans" -> "Plans"
        result = Bold().Replace(result, "$2");                       // **x** / __x__ -> x
        result = Italic().Replace(result, "$1$2");                   // *x* / _x_ -> x (not list bullets)
        result = InlineCode().Replace(result, "$1");                 // `x` -> x
        result = HorizontalRules().Replace(result, string.Empty);    // --- lines
        result = Bullets().Replace(result, "- ");                    // "* item" / "• item" -> "- item"
        result = ExtraBlankLines().Replace(result, "\n\n");
        return result.Trim();
    }

    [GeneratedRegex(@"^[ \t]{0,3}#{1,6}[ \t]+", RegexOptions.Multiline)]
    private static partial Regex Headings();

    [GeneratedRegex(@"(\*\*|__)(?=\S)(.+?)(?<=\S)\1")]
    private static partial Regex Bold();

    [GeneratedRegex(@"(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])|(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])")]
    private static partial Regex Italic();

    [GeneratedRegex(@"`([^`\n]+)`")]
    private static partial Regex InlineCode();

    [GeneratedRegex(@"^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$", RegexOptions.Multiline)]
    private static partial Regex HorizontalRules();

    [GeneratedRegex(@"^[ \t]*[*•][ \t]+", RegexOptions.Multiline)]
    private static partial Regex Bullets();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex ExtraBlankLines();
}

/// <summary>Whether an AI reply actually contains troubleshooting steps (a list of two or more).</summary>
public static partial class TroubleshootingSteps
{
    public static bool Present(string text) => ListItem().Matches(text ?? string.Empty).Count >= 2;

    [GeneratedRegex(@"^[ \t]*(?:\d{1,2}[.)]|[-*•])[ \t]+\S", RegexOptions.Multiline)]
    private static partial Regex ListItem();
}
