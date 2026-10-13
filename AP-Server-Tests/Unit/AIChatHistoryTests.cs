using AP_Master.Server.Services;

namespace AP_Server_Tests.Unit;

public class AIChatHistoryTests
{
    private static AIChatMessage User(string text) => new(AIChatRole.User, text);
    private static AIChatMessage Bot(string text) => new(AIChatRole.Assistant, text);

    [Fact]
    public void KeepsTheMostRecentMessagesWithinTheLimit()
    {
        var history = new[] { User("1"), Bot("2"), User("3"), Bot("4"), User("5") };

        var prepared = AIChatHistory.Prepare(history, maxMessages: 3, maxCharacters: 1000);

        Assert.Equal(new[] { "3", "4", "5" }, prepared.Select(m => m.Content));
    }

    [Fact]
    public void RespectsTheCharacterBudget_ButAlwaysKeepsTheNewestMessage()
    {
        var history = new[] { User(new string('a', 50)), Bot(new string('b', 50)), User(new string('c', 80)) };

        var prepared = AIChatHistory.Prepare(history, maxMessages: 10, maxCharacters: 60);

        Assert.Equal(new string('c', 80), Assert.Single(prepared).Content);
    }

    [Fact]
    public void DropsLeadingAssistantMessages_SoTheConversationStartsWithTheUser()
    {
        var prepared = AIChatHistory.Prepare(new[] { Bot("welcome"), User("hi") }, 10, 1000);

        Assert.Equal(AIChatRole.User, prepared[0].Role);
        Assert.Single(prepared);
    }

    [Fact]
    public void MergesConsecutiveMessagesFromTheSameSender()
    {
        var prepared = AIChatHistory.Prepare(new[] { User("first"), User("second"), Bot("reply") }, 10, 1000);

        Assert.Equal(2, prepared.Count);
        Assert.Equal("first\n\nsecond", prepared[0].Content);
    }

    [Fact]
    public void IgnoresBlankMessages_AndReturnsEmptyWhenNoCustomerMessage()
    {
        Assert.Empty(AIChatHistory.Prepare(new[] { User("  "), Bot("only me") }, 10, 1000));
    }
}
