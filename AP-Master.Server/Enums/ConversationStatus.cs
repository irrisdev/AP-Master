namespace AP_Master.Server.Enums;

public enum ConversationStatus
{
    Active,
    Troubleshooting,
    Resolved,
    Escalated,

    /// <summary>
    /// The session has ended (a complaint was logged) and accepts no more messages.
    /// Added last so the integer values the API returns for the other statuses don't change.
    /// </summary>
    Closed
}
