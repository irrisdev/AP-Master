using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Controllers
{
    public class ConversationsController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
