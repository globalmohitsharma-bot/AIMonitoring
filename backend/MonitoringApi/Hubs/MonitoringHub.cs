using Microsoft.AspNetCore.SignalR;
using MonitoringApi.Models;

namespace MonitoringApi.Hubs;

public class MonitoringHub : Hub
{
    private readonly EventStore _store;

    public MonitoringHub(EventStore store)
    {
        _store = store;
    }

    public async Task ReportEvent(MonitoringEvent evt)
    {
        evt.Id = Guid.NewGuid();
        evt.Timestamp = DateTime.UtcNow;
        _store.Add(evt);
        await Clients.All.SendAsync("EventReceived", evt);
    }

    public Task<List<MonitoringEvent>> GetHistory(string sessionId)
    {
        return Task.FromResult(_store.GetBySession(sessionId));
    }
}

// Simple in-memory store for the POC
public class EventStore
{
    private readonly List<MonitoringEvent> _events = new();
    private readonly object _lock = new();

    public void Add(MonitoringEvent evt)
    {
        lock (_lock) _events.Add(evt);
    }

    public List<MonitoringEvent> GetAll()
    {
        lock (_lock) return _events.ToList();
    }

    public List<MonitoringEvent> GetBySession(string sessionId)
    {
        lock (_lock) return _events.Where(e => e.SessionId == sessionId).ToList();
    }
}
