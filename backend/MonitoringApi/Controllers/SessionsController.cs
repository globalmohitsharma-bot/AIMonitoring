using Microsoft.AspNetCore.Mvc;
using MonitoringApi.Hubs;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly EventStore _store;
    public SessionsController(EventStore store) => _store = store;

    [HttpGet]
    public IActionResult GetHistory() => Ok(_store.GetSessionHistory());
}
