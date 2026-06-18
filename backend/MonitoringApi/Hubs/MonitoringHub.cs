using Microsoft.AspNetCore.SignalR;
using MonitoringApi.Models;

namespace MonitoringApi.Hubs;

public class MonitoringHub : Hub
{
    private readonly EventStore _store;

    public MonitoringHub(EventStore store) => _store = store;

    public async Task JoinSession(string sessionId)
    {
        _store.UpsertSession(sessionId);
        var session = _store.GetSession(sessionId)!;
        await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    public async Task JoinMonitor()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, "admin-monitor");
        await Clients.Caller.SendAsync("SessionsSnapshot", _store.GetSessions());
        await Clients.Caller.SendAsync("QuizResultsSnapshot", _store.GetQuizResults());
    }

    public async Task ReportEvent(MonitoringEvent evt)
    {
        evt.Id = Guid.NewGuid();
        evt.Timestamp = DateTime.UtcNow;
        _store.Add(evt);
        _store.UpdateStatus(evt);

        await Clients.Caller.SendAsync("EventReceived", evt);
        await Clients.Group("admin-monitor").SendAsync("EventReceived", evt);

        var session = _store.GetSession(evt.SessionId);
        if (session is not null)
            await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    public async Task SubmitQuizResult(QuizResult result)
    {
        result.Id = Guid.NewGuid();
        result.CompletedAt = DateTime.UtcNow;
        _store.AddQuizResult(result);
        _store.SetQuizScore(result.SessionId, result.Score, result.Total);

        // Notify admin monitor
        await Clients.Group("admin-monitor").SendAsync("QuizCompleted", result);

        // Log event for the event feed
        var pct = result.Total > 0 ? result.Score * 100 / result.Total : 100;
        var evt = new MonitoringEvent
        {
            Id        = Guid.NewGuid(),
            SessionId = result.SessionId,
            Type      = EventType.QuizCompleted,
            Timestamp = result.CompletedAt,
            Message   = $"Quiz completed — {result.Score}/{result.Total} ({pct}%)",
            Severity  = pct == 100 ? "info" : pct >= 60 ? "warning" : "error",
        };
        _store.Add(evt);
        await Clients.Caller.SendAsync("EventReceived", evt);
        await Clients.Group("admin-monitor").SendAsync("EventReceived", evt);

        var session = _store.GetSession(result.SessionId);
        if (session is not null)
            await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

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
    private readonly List<QuizResult> _quizResults = new();
    private readonly object _lock = new();

    // Default question bank — edit here to change quiz questions
    public static readonly List<Question> Questions =
    [
        new() { Id = 1, Text = "Have you read and understood the exam instructions?",               CorrectAnswer = true  },
        new() { Id = 2, Text = "Are you in a quiet, private location?",                             CorrectAnswer = true  },
        new() { Id = 3, Text = "Have you closed all unnecessary applications and browser tabs?",     CorrectAnswer = true  },
        new() { Id = 4, Text = "Do you have any unauthorized materials (notes, books) nearby?",     CorrectAnswer = false },
        new() { Id = 5, Text = "Do you agree to abide by the academic integrity policy?",           CorrectAnswer = true  },
    ];

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

    public void SetQuizScore(string sessionId, int score, int total)
    {
        lock (_lock)
        {
            if (_sessions.TryGetValue(sessionId, out var s))
            {
                s.QuizScore = score;
                s.QuizTotal = total;
            }
        }
    }

    public void AddQuizResult(QuizResult result)
    {
        lock (_lock) _quizResults.Add(result);
    }

    public List<QuizResult> GetQuizResults()
    {
        lock (_lock) return _quizResults.ToList();
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
        lock (_lock) { _events.Clear(); _sessions.Clear(); _quizResults.Clear(); }
    }
}
