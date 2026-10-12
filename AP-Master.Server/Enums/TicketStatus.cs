namespace AP_Master.Server.Enums;

public enum TicketStatus
{
    AwaitingTechnician,
    InProgress,
    Resolved,
    Closed,

    // Starting status for complaint tickets. Added last so the integer values
    // the API returns for the existing statuses don't change.
    Open
}
