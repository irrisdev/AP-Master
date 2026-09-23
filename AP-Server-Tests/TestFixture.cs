using AP_Master.Server.Data;
using AP_Master.Server.Development;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace AP_Server_Tests;

public class TestFixture : IDisposable, IClassFixture<TestFixture>
{
    private readonly SqliteConnection _connection;

    public TelegroupDbContext DbContext { get; }
    
    public TestFixture()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        
        var ops = new DbContextOptionsBuilder<TelegroupDbContext>()
            .UseSqlite(_connection)
            .Options;
        
        DbContext = new TelegroupDbContext(ops);
        DbContext.Database.EnsureCreated();
        DbSeeder.Seed(DbContext);

    }
    public void Dispose()
    {
        DbContext.Dispose();
        _connection.Dispose();
    }
}