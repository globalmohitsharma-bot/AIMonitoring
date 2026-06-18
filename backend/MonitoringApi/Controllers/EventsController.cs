using Microsoft.AspNetCore.Mvc;
using MonitoringApi.Hubs;
using MonitoringApi.Models;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class EventsController : ControllerBase
{
    private readonly EventStore _store;

    public EventsController(EventStore store)
    {
        _store = store;
    }

    [HttpGet]
    public IActionResult GetAll() => Ok(_store.GetAll());

    [HttpGet("{sessionId}")]
    public IActionResult GetBySession(string sessionId) => Ok(_store.GetBySession(sessionId));

    [HttpDelete]
    public IActionResult ClearAll()
    {
        // For POC demo — reset the store
        var field = typeof(EventStore).GetField("_events", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        var list = (List<MonitoringEvent>)field.GetValue(_store)!;
        lock (_store) list.Clear();
        return NoContent();
    }
}
