namespace AP_Master.Server.DTOs;

using System.ComponentModel.DataAnnotations;

public class CreateCustomerRequest
{
    /// <summary>Customer's full name.</summary>
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; set; } = string.Empty;

    /// <summary>Must be unique across all customers (case-insensitive).</summary>
    [Required, EmailAddress, StringLength(254)]
    public string Email { get; set; } = string.Empty;
}

public class CustomerResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}