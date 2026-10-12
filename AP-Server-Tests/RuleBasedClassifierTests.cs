using AP_Master.Server.Enums;
using AP_Master.Server.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AP_Server_Tests;

public class RuleBasedClassifierTests
{
    private readonly RuleBasedClassifier _classifier = new();

    [Theory]
    [InlineData("I want to make a complaint about my bill", RequestType.Complaint)]
    [InlineData("This is unacceptable, I want compensation", RequestType.Complaint)]
    [InlineData("I'm really unhappy with the service", RequestType.Complaint)]
    [InlineData("My router won't turn on and there are no lights", RequestType.TechnicalSupport)]
    [InlineData("I need an engineer to install my new line", RequestType.TechnicalSupport)]
    [InlineData("The router is damaged", RequestType.TechnicalSupport)]
    [InlineData("My internet is really slow", RequestType.ServiceIssue)]
    [InlineData("The wifi keeps dropping", RequestType.ServiceIssue)]
    [InlineData("I can't connect to the internet", RequestType.ServiceIssue)]
    [InlineData("How much does the fibre upgrade cost?", RequestType.CustomerEnquiry)]
    [InlineData("What are your opening hours?", RequestType.CustomerEnquiry)]
    [InlineData("Can I change my address?", RequestType.CustomerEnquiry)]
    public void Classify_ClearMessage_ReturnsExpectedTypeFromRules(string message, RequestType expected)
    {
        var result = _classifier.Classify(message);

        Assert.Equal(expected, result.RequestType);
        Assert.Equal(ClassificationSource.Rules, result.Source);
        Assert.True(result.Confidence >= ClassificationService.ConfidenceThreshold);
    }

    [Fact]
    public void Classify_NegatedComplaint_IsNotAComplaint()
    {
        var result = _classifier.Classify("I have no complaints, just a question about prices");

        Assert.Equal(RequestType.CustomerEnquiry, result.RequestType);
    }

    [Fact]
    public void Classify_ComplaintAboutService_ComplaintWins()
    {
        // Complaint (3) outscores the service words "internet" (1) and "down" (1).
        var result = _classifier.Classify("I want to complain, my internet has been down all week");

        Assert.Equal(RequestType.Complaint, result.RequestType);
    }

    [Fact]
    public void Classify_Tie_ComplaintWinsWithLowConfidence()
    {
        // "engineer" (TechnicalSupport 3) ties with "unacceptable" (Complaint 3).
        var result = _classifier.Classify("The engineer never turned up, this is unacceptable");

        Assert.Equal(RequestType.Complaint, result.RequestType);
        Assert.True(result.Confidence < ClassificationService.ConfidenceThreshold);
    }

    [Fact]
    public void Classify_NoSignals_DefaultsToEnquiryWithZeroConfidence()
    {
        var result = _classifier.Classify("Hello there");

        Assert.Equal(RequestType.CustomerEnquiry, result.RequestType);
        Assert.Equal(ClassificationSource.Default, result.Source);
        Assert.Equal(0.0, result.Confidence);
        Assert.Empty(result.MatchedSignals);
    }

    [Fact]
    public void Classify_PartOfAWord_DoesNotMatch()
    {
        // "download" must not match the phrase "down".
        var result = _classifier.Classify("The download finished");

        Assert.Empty(result.MatchedSignals);
    }

    [Theory]
    [InlineData("MY INTERNET IS DOWN!!!", RequestType.ServiceIssue)]
    [InlineData("My router won\u2019t turn on", RequestType.TechnicalSupport)] // curly apostrophe
    public void Classify_IgnoresCaseAndPunctuation(string message, RequestType expected)
    {
        var result = _classifier.Classify(message);

        Assert.Equal(expected, result.RequestType);
    }
}

public class ClassificationServiceTests
{
    // Fake AI: returns a fixed reply (or throws) and counts how often it was called.
    private sealed class FakeAIService : IAIService
    {
        private readonly string? _reply;
        public int CallCount { get; private set; }

        public FakeAIService(string? reply) => _reply = reply;

        public Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
        {
            CallCount++;
            return _reply is null
                ? throw new AIServiceException("AI unavailable")
                : Task.FromResult(_reply);
        }

        // Not used by ClassificationService; required by the interface.
        public Task<string> GenerateChatResponseAsync(
            string systemPrompt, IReadOnlyList<AIChatMessage> history, CancellationToken cancellationToken = default) =>
            GenerateResponseAsync(systemPrompt, cancellationToken);
    }

    private static ClassificationService CreateService(FakeAIService ai) =>
        new(new RuleBasedClassifier(), ai, NullLogger<ClassificationService>.Instance);

    [Fact]
    public async Task ClassifyAsync_ConfidentRules_DoesNotCallAI()
    {
        var ai = new FakeAIService("Complaint");

        var result = await CreateService(ai).ClassifyAsync("My internet is really slow");

        Assert.Equal(RequestType.ServiceIssue, result.RequestType);
        Assert.Equal(ClassificationSource.Rules, result.Source);
        Assert.Equal(0, ai.CallCount);
    }

    [Theory]
    [InlineData("Complaint", RequestType.Complaint)]
    [InlineData("  technicalsupport. ", RequestType.TechnicalSupport)]
    [InlineData("Category: ServiceIssue", RequestType.ServiceIssue)]
    public async Task ClassifyAsync_UnclearMessage_UsesAICategory(string aiReply, RequestType expected)
    {
        var ai = new FakeAIService(aiReply);

        var result = await CreateService(ai).ClassifyAsync("Hello there");

        Assert.Equal(expected, result.RequestType);
        Assert.Equal(ClassificationSource.AI, result.Source);
        Assert.Equal(1, ai.CallCount);
    }

    [Theory]
    [InlineData("I'm not sure")]                   // no category named
    [InlineData("Complaint or ServiceIssue")]      // more than one category
    [InlineData(null)]                             // AI throws
    public async Task ClassifyAsync_BadOrFailedAIReply_FallsBackToRules(string? aiReply)
    {
        var ai = new FakeAIService(aiReply);

        var result = await CreateService(ai).ClassifyAsync("Hello there");

        Assert.Equal(RequestType.CustomerEnquiry, result.RequestType);
        Assert.Equal(ClassificationSource.Default, result.Source);
    }

    [Fact]
    public async Task ClassifyAsync_AISaysOutOfScope_ReturnsEnquiryWithNoAction()
    {
        var ai = new FakeAIService("OutOfScope");

        var result = await CreateService(ai).ClassifyAsync("my toilet is broken");

        Assert.Equal(RequestType.CustomerEnquiry, result.RequestType);
        Assert.Equal(ClassificationSource.OutOfScope, result.Source);
    }

    [Fact]
    public async Task ClassifyAsync_WeakActionSignalWithAIUnavailable_DoesNotRaiseTicket()
    {
        // "broken" alone is a weak TechnicalSupport signal (confidence 0.33).
        var ai = new FakeAIService(null);

        var result = await CreateService(ai).ClassifyAsync("my toilet is broken");

        Assert.Equal(RequestType.CustomerEnquiry, result.RequestType);
    }

    [Fact]
    public async Task ClassifyFollowUpAsync_UnclearReply_StaysOnCurrentTopicWithoutCallingAI()
    {
        var ai = new FakeAIService("Complaint");

        var result = await CreateService(ai).ClassifyFollowUpAsync("yea but you dont know the issue yet", RequestType.ServiceIssue);

        Assert.Equal(RequestType.ServiceIssue, result.RequestType);
        Assert.Equal(ClassificationSource.Context, result.Source);
        Assert.Equal(0, ai.CallCount);
    }

    [Fact]
    public async Task ClassifyFollowUpAsync_QuestionAboutExistingComplaint_IsNotANewComplaint()
    {
        var ai = new FakeAIService(null);

        var result = await CreateService(ai).ClassifyFollowUpAsync("can you remember what my complaint was", RequestType.CustomerEnquiry);

        Assert.Equal(RequestType.CustomerEnquiry, result.RequestType);
    }

    [Fact]
    public async Task ClassifyAsync_TieWithAIUnavailable_KeepsRuleTieBreak()
    {
        var ai = new FakeAIService(null);

        var result = await CreateService(ai).ClassifyAsync("The engineer never turned up, this is unacceptable");

        Assert.Equal(RequestType.Complaint, result.RequestType);
        Assert.Equal(1, ai.CallCount);
    }
}
public class ComplaintDetailsTests
{
    [Theory]
    [InlineData("i want to make a complain")]
    [InlineData("I'd like to make a complaint please")]
    [InlineData("complaint")]
    [InlineData("hi, I want to complain")]
    public void HasDetails_IntentOnly_ReturnsFalse(string message)
    {
        Assert.False(ComplaintDetails.HasDetails(message));
    }

    [Theory]
    [InlineData("your service is terrible")]
    [InlineData("I want to complain about my bill")]
    [InlineData("the engineer never turned up")]
    public void HasDetails_DescribesProblem_ReturnsTrue(string message)
    {
        Assert.True(ComplaintDetails.HasDetails(message));
    }
}
