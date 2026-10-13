using AP_Master.Server.Data;
using AP_Master.Server.Development;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace AP_Server_Tests.TestSupport;

/// <summary>
/// A private in-memory SQLite database for one test, with the real schema and the demo customers
/// (IDs 1-5). SQLite rather than the EF in-memory provider, so constraints and SQL translation are real.
/// </summary>
public sealed class TestDatabase : IDisposable
{
    private readonly SqliteConnection _connection;

    public TestDatabase()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        Context = CreateContext();
        Context.Database.EnsureCreated();
        DbSeeder.Seed(Context);
    }

    public TelegroupDbContext Context { get; }

    /// <summary>A second context on the same database, for checking what was actually saved.</summary>
    public TelegroupDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<TelegroupDbContext>().UseSqlite(_connection).Options);

    public void Dispose()
    {
        Context.Dispose();
        _connection.Dispose();
    }
}
