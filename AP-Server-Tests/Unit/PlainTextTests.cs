using AP_Master.Server.Services;

namespace AP_Server_Tests.Unit;

public class PlainTextTests
{
    [Theory]
    [InlineData("**Home broadband** is available.", "Home broadband is available.")]
    [InlineData("## Our plans\nFibre and copper.", "Our plans\nFibre and copper.")]
    [InlineData("Use the `Reset` button.", "Use the Reset button.")]
    [InlineData("It is *really* quick.", "It is really quick.")]
    [InlineData("* First\n* Second", "- First\n- Second")]
    [InlineData("Above\n\n---\n\nBelow", "Above\n\nBelow")]
    public void RemovesMarkdown(string input, string expected) => Assert.Equal(expected, PlainText.From(input));

    [Fact]
    public void KeepsNumberedStepsAndLineBreaks()
    {
        const string steps = "Try these:\n1. Restart the router.\n2. Check the cable.";

        Assert.Equal(steps, PlainText.From(steps));
    }

    [Fact]
    public void LeavesMarkersAndOrdinaryPunctuationAlone()
    {
        const string text = "[NEED_DETAILS] What's happening? It costs 2*3 - not snake_case_words.";

        Assert.Equal(text, PlainText.From(text));
    }
}

public class TroubleshootingStepsTests
{
    [Theory]
    [InlineData("1. Restart\n2. Check cables")]
    [InlineData("Try:\n- Restart\n- Check cables")]
    [InlineData("[NEED_DETAILS] Is it all devices?\n1) Restart\n2) Move closer")]
    public void FindsAList(string text) => Assert.True(TroubleshootingSteps.Present(text));

    [Theory]
    [InlineData("Great to hear that's fixed!")]
    [InlineData("Could you tell me what's happening?")]
    [InlineData("1. Restart the router and let me know.")] // a single step is not a list of steps
    public void IgnoresTextWithoutSteps(string text) => Assert.False(TroubleshootingSteps.Present(text));
}
