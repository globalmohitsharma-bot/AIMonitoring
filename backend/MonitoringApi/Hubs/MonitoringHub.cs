using Microsoft.AspNetCore.SignalR;
using MonitoringApi.Models;

namespace MonitoringApi.Hubs;

public class MonitoringHub : Hub
{
    private readonly EventStore _store;

    public MonitoringHub(EventStore store) => _store = store;

    // Called by each tester on connect — registers their session
    public async Task JoinSession(string sessionId)
    {
        _store.UpsertSession(sessionId);
        var session = _store.GetSession(sessionId)!;
        await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    // Called by the /monitor admin page on connect
    public async Task JoinMonitor()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, "admin-monitor");
        // Send current snapshot so the dashboard populates immediately
        await Clients.Caller.SendAsync("SessionsSnapshot", _store.GetSessions());
    }

    public async Task ReportEvent(MonitoringEvent evt)
    {
        evt.Id = Guid.NewGuid();
        evt.Timestamp = DateTime.UtcNow;
        _store.Add(evt);
        _store.UpdateStatus(evt);

        // Send back to the tester who reported it (their own event log)
        await Clients.Caller.SendAsync("EventReceived", evt);
        // Broadcast to admin monitor
        await Clients.Group("admin-monitor").SendAsync("EventReceived", evt);

        var session = _store.GetSession(evt.SessionId);
        if (session is not null)
            await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    // Relay a JPEG snapshot (base64, no data-url prefix) to the admin monitor
    public async Task SendVideoFrame(string sessionId, string frameData)
    {
        await Clients.Group("admin-monitor").SendAsync("VideoFrame", sessionId, frameData);
    }

    public Task<List<MonitoringEvent>> GetHistory(string sessionId)
        => Task.FromResult(_store.GetBySession(sessionId));
}

public class EventStore
{
    private readonly List<MonitoringEvent> _events = new();
    private readonly Dictionary<string, SessionInfo> _sessions = new();
    private readonly object _lock = new();

    public void Add(MonitoringEvent evt)
    {
        lock (_lock) _events.Add(evt);
    }

    public void UpsertSession(string sessionId)
    {
        lock (_lock)
        {
            if (!_sessions.ContainsKey(sessionId))
                _sessions[sessionId] = new SessionInfo { SessionId = sessionId };
        }
    }

    public void UpdateStatus(MonitoringEvent evt)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(evt.SessionId, out var session))
            {
                session = new SessionInfo { SessionId = evt.SessionId };
                _sessions[evt.SessionId] = session;
            }
            session.LastSeen = evt.Timestamp;
            session.EventCount++;

            switch (evt.Type)
            {
                case EventType.FaceNotDetected: session.FaceStatus = "alert";    break;
                case EventType.FaceReturned:    session.FaceStatus = "ok";       break;
                case EventType.SessionStart:    session.FaceStatus = "ok";       break;
                case EventType.TabSwitch:       session.TabStatus  = "switched"; break;
                case EventType.TabReturned:     session.TabStatus  = "active";   break;
            }
        }
    }

    public SessionInfo? GetSession(string sessionId)
    {
        lock (_lock) return _sessions.TryGetValue(sessionId, out var s) ? s : null;
    }

    public List<SessionInfo> GetSessions()
    {
        lock (_lock) return [.. _sessions.Values.OrderBy(s => s.StartedAt)];
    }

    public List<MonitoringEvent> GetAll()
    {
        lock (_lock) return _events.ToList();
    }

    public List<MonitoringEvent> GetBySession(string sessionId)
    {
        lock (_lock) return _events.Where(e => e.SessionId == sessionId).ToList();
    }

    public void Clear()
    {
        lock (_lock) { _events.Clear(); _sessions.Clear(); }
    }
}
