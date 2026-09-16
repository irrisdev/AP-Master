using AP_Master.Server.Enums;

namespace AP_Master.Server.Services;

public interface IClassificationService
{
    RequestType Classify(string message);

}

public class ClassificationService : IClassificationService
{
    public RequestType Classify(string message)
    {
        var text = message.ToLowerInvariant();

        if (text.Contains("complaint") ||
            text.Contains("complain") ||
            text.Contains("unhappy") ||
            text.Contains("disappointed"))
        {
            return RequestType.Complaint;
        }

        if (text.Contains("router") ||
            text.Contains("technical") ||
            text.Contains("cannot connect") ||
            text.Contains("can't connect"))
        {
            return RequestType.TechnicalSupport;
        }

        if (text.Contains("slow") ||
            text.Contains("outage") ||
            text.Contains("not working") ||
            text.Contains("disconnect"))
        {
            return RequestType.ServiceIssue;
        }

        return RequestType.CustomerEnquiry;
    }
}