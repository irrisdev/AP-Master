namespace AP_Master.Server.Properties;

/// <summary>Sender values stored in Message.Sender. Kept as strings to match the existing schema.</summary>
public static class MessageSenders
{
    public const string Customer = "Customer";
    public const string Assistant = "AI";
}

public static class MessageLimits
{
    public const int CustomerMaxLength = 2000;
    public const int AssistantMaxLength = 4000;
}