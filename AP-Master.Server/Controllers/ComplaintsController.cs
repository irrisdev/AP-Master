using Microsoft.AspNetCore.Mvc;

namespace AP_Master.Server.Controllers
{
    public class ComplaintsController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
