using AP_Master.Server.Data;
using Microsoft.Data.Sqlite;

namespace AP_Server_Tests.Unit;

public class DatabaseSetupTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"telegroup-setup-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public void RelativePath_ResolvesAgainstContentRoot_AndCreatesTheFolder()
    {
        var resolved = DatabaseSetup.ResolveSqliteConnectionString("Data Source=Data/app.db", _root);

        var dataSource = new SqliteConnectionStringBuilder(resolved).DataSource;
        Assert.Equal(Path.Combine(_root, "Data", "app.db"), dataSource);
        Assert.True(Directory.Exists(Path.Combine(_root, "Data")));
    }

    [Fact]
    public void WindowsSeparators_WorkOnEveryPlatform()
    {
        var resolved = DatabaseSetup.ResolveSqliteConnectionString(@"Data Source=Development\Data\app.db", _root);

        var dataSource = new SqliteConnectionStringBuilder(resolved).DataSource;
        Assert.EndsWith(Path.Combine("Development", "Data", "app.db"), dataSource);
    }

    [Fact]
    public void InMemoryDatabase_IsLeftAlone()
    {
        var resolved = DatabaseSetup.ResolveSqliteConnectionString("Data Source=:memory:", _root);

        Assert.Equal(":memory:", new SqliteConnectionStringBuilder(resolved).DataSource);
    }

    [Fact]
    public void MissingConnectionString_FailsClearly()
    {
        var error = Assert.Throws<InvalidOperationException>(() => DatabaseSetup.ResolveSqliteConnectionString(null, _root));
        Assert.Contains("DefaultConnection", error.Message);
    }
}
