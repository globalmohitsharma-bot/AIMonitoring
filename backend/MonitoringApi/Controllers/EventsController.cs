using Microsoft.AspNetCore.Mvc;
using MonitoringApi.Hubs;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class EventsController : ControllerBase
{
    private readonly EventStore _store;

    public EventsController(EventStore store) => _store = store;

    [HttpGet]
    public IActionResult GetAll() => Ok(_store.GetAll());

    [HttpGet("{sessionId}")]
    public IActionResult GetBySession(string sessionId) => Ok(_store.GetBySession(sessionId));

    [HttpDelete]
    public IActionResult ClearAll() { _store.Clear(); return NoContent(); }
}

[ApiController]
[Route("api/[controller]")]
public class SessionsController(EventStore store) : ControllerBase
{
    [HttpGet]
    public IActionResult GetAll() => Ok(store.GetSessions());
}
