namespace AP_Master.Server.Exceptions;

/// <summary>
/// Base type for expected, client-facing errors. The message is safe to return to the caller;
/// anything that is not an ApiException is treated as an internal error and hidden.
/// </summary>
public abstract class ApiException : Exception
{
    protected ApiException(string message) : base(message) { }

    public abstract int StatusCode { get; }
    public abstract string Title { get; }
}

public sealed class NotFoundException : ApiException
{
    public NotFoundException(string message) : base(message) { }
    public override int StatusCode => StatusCodes.Status404NotFound;
    public override string Title => "Resource not found";
}

public sealed class ConflictException : ApiException
{
    public ConflictException(string message) : base(message) { }
    public override int StatusCode => StatusCodes.Status409Conflict;
    public override string Title => "Conflict";
}

public sealed class BadRequestException : ApiException
{
    public BadRequestException(string message) : base(message) { }
    public override int StatusCode => StatusCodes.Status400BadRequest;
    public override string Title => "Invalid request";
}