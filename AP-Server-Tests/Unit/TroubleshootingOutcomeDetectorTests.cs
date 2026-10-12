using AP_Master.Server.Enums;
using AP_Master.Server.Services;

namespace AP_Server_Tests.Unit;

public class TroubleshootingOutcomeDetectorTests
{
    private readonly TroubleshootingOutcomeDetector _detector = new();

    [Theory]
    [InlineData("Yes, that fixed it")]
    [InlineData("it's working now, thanks")]
    [InlineData("All good")]
    [InlineData("yes")]
    [InlineData("Sorted!")]
    public void Resolved(string reply) => Assert.Equal(TroubleshootingOutcome.Resolved, _detector.Detect(reply));

    [Theory]
    [InlineData("No")]
    [InlineData("no, still broken")]
    [InlineData("Thanks, but it's still not working")] // "thanks" must not read as a yes
    [InlineData("It's not fixed")]                    // contains "fixed"
    [InlineData("that didn't help at all")]
    [InlineData("Same problem as before")]
    public void NotResolved(string reply) => Assert.Equal(TroubleshootingOutcome.NotResolved, _detector.Detect(reply));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("What's the price of fibre?")]
    [InlineData("nothing has changed yet, I'll try later")] // "nothing" is not "no"
    public void Unclear(string reply) => Assert.Equal(TroubleshootingOutcome.Unclear, _detector.Detect(reply));
}
