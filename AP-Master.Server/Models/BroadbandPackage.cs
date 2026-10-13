namespace AP_Master.Server.Models;

/// <summary>
/// A broadband package Telegroup currently sells. The chat assistant is given these so it can
/// answer questions about packages and prices from real data instead of inventing them.
/// </summary>
public class BroadbandPackage
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public int DownloadMbps { get; set; }

    public int UploadMbps { get; set; }

    public decimal MonthlyPrice { get; set; }

    public int ContractMonths { get; set; }

    /// <summary>Anything else worth telling a customer, such as the router included.</summary>
    public string? Description { get; set; }

    /// <summary>Packages that are no longer on sale stay in the table but are not offered.</summary>
    public bool IsAvailable { get; set; } = true;
}
