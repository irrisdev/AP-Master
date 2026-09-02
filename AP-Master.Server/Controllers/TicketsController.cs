using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Controllers
{
    public class TicketsController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
