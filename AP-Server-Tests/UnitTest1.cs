namespace AP_Server_Tests
{

    public class TestFixture : IDisposable, IClassFixture<TestFixture>
    {
        private readonly IServiceProvider _serviceProvider;

        public TestFixture()
        {
            // Setup code here
        }
        public void Dispose()
        {
            // Cleanup code here
        }
    }

    public class UnitTest1
    {
        [Fact]
        public void Test1()
        {

        }
    }
}
