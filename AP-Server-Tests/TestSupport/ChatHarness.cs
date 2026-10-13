using AP_Master.Server.Concurrency;
using AP_Master.Server.DTOs.Chat;
using AP_Master.Server.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace AP_Server_Tests.TestSupport;

/// <summary>
/// The real ChatService with its real collaborators (classifier, tickets, conversations, messages)
/// over a private SQLite database. Only the AI provider and the SignalR notifier are fakes, so
/// these tests exercise the actual workflow rules end to end without a network.
/// </summary>
public sealed class ChatHarness : IDisposable
{
    public ChatHarness()
    {
        Database = new TestDatabase();
        var context = Database.Context;

        var customers = new CustomerService(context, NullLogger<CustomerService>.Instance);
        var conversations = new ConversationService(context, customers, NullLogger<ConversationService>.Instance);
        var messages = new MessageService(context, NullLogger<MessageService>.Instance);
        var classification = new ClassificationService(new RuleBasedClassifier(), AI, NullLogger<ClassificationService>.Instance);
        Tickets = new TicketService(context, Notifier, NullLogger<TicketService>.Instance);

        Packages = new PackageCatalogueService(context, NullLogger<PackageCatalogueService>.Instance);

        Chat = new ChatService(customers, conversations, messages, classification, Tickets, AI, Packages,
            new TroubleshootingOutcomeDetector(), new ConversationLocks(), NullLogger<ChatService>.Instance);
    }

    public TestDatabase Database { get; }
    public ScriptedAIService AI { get; } = new();
    public RecordingTicketNotifier Notifier { get; } = new();
    public TicketService Tickets { get; }
    public PackageCatalogueService Packages { get; }
    public ChatService Chat { get; }

    public Task<ChatResponse> SendAsync(string message, int? conversationId = null, int customerId = 1) =>
        Chat.ProcessMessageAsync(new ChatRequest { CustomerId = customerId, ConversationId = conversationId, Message = message });

    public void Dispose() => Database.Dispose();
}
