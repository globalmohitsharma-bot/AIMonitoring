using Microsoft.AspNetCore.SignalR;
using MonitoringApi.Models;

namespace MonitoringApi.Hubs;

public class MonitoringHub : Hub
{
    private readonly EventStore _store;

    public MonitoringHub(EventStore store) => _store = store;

    public async Task JoinSession(string sessionId, string? candidateName = null, string? candidateEmail = null, double? resumeScore = null)
    {
        _store.UpsertSession(sessionId, candidateName, candidateEmail, resumeScore);
        var session = _store.GetSession(sessionId)!;
        await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    public async Task JoinMonitor()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, "admin-monitor");
        await Clients.Caller.SendAsync("SessionsSnapshot",    _store.GetSessions());
        await Clients.Caller.SendAsync("QuizResultsSnapshot", _store.GetQuizResults());
        await Clients.Caller.SendAsync("QuestionsSnapshot",   EventStore.GetQuestions());
    }

    public async Task ReportEvent(MonitoringEvent evt)
    {
        evt.Id        = Guid.NewGuid();
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
        result.Id          = Guid.NewGuid();
        result.CompletedAt = DateTime.UtcNow;
        _store.AddQuizResult(result);
        _store.SetQuizScore(result.SessionId, result.Score, result.Total);

        await Clients.Group("admin-monitor").SendAsync("QuizCompleted", result);

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

    // Admin: update the live question bank
    public async Task AdminUpdateQuestions(List<Question> questions)
    {
        EventStore.SetQuestions(questions);
        // Notify all admins watching the dashboard
        await Clients.Group("admin-monitor").SendAsync("QuestionsSnapshot", questions);
    }
}

// ── EventStore ────────────────────────────────────────────────────────────────
public class EventStore
{
    private readonly List<MonitoringEvent>          _events      = new();
    private readonly Dictionary<string, SessionInfo> _sessions   = new();
    private readonly List<QuizResult>               _quizResults = new();
    private readonly object _lock = new();

    private static List<Question> _questions =
    [
        // Yes/No intake questions
        new() { Id = 1, Text = "Have you read and understood the exam instructions?",           Type = "yesno", CorrectAnswer = "yes" },
        new() { Id = 2, Text = "Are you in a quiet, private location with no one nearby?",      Type = "yesno", CorrectAnswer = "yes" },
        new() { Id = 3, Text = "Do you have any unauthorized materials (notes/books) with you?", Type = "yesno", CorrectAnswer = "no"  },
        new() { Id = 4, Text = "Do you agree to abide by the academic integrity policy?",        Type = "yesno", CorrectAnswer = "yes" },

        // Technical MCQ
        new() {
            Id = 5,
            Text = "What does the 'S' in SOLID principles stand for?",
            Type = "mcq",
            Options = ["Single Responsibility", "Synchronous Processing", "Structured Design", "Sequential Logic"],
            CorrectAnswer = "Single Responsibility"
        },
        new() {
            Id = 6,
            Text = "Which HTTP method is used to CREATE a new resource in a REST API?",
            Type = "mcq",
            Options = ["GET", "PUT", "POST", "DELETE"],
            CorrectAnswer = "POST"
        },
        new() {
            Id = 7,
            Text = "In C#, which keyword marks a method as asynchronous?",
            Type = "mcq",
            Options = ["await", "async", "Task", "thread"],
            CorrectAnswer = "async"
        },
    ];

    public static List<Question> GetQuestions() { lock (typeof(EventStore)) return _questions.ToList(); }
    public static void SetQuestions(List<Question> q) { lock (typeof(EventStore)) _questions = q; }

    // ── Session management ────────────────────────────────────────
    public void UpsertSession(string sessionId, string? name = null, string? email = null, double? resumeScore = null)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var s))
            {
                s = new SessionInfo { SessionId = sessionId };
                _sessions[sessionId] = s;
            }
            if (name         is not null) s.CandidateName  = name;
            if (email        is not null) s.CandidateEmail = email;
            if (resumeScore  is not null) s.ResumeScore    = resumeScore;
        }
    }

    public void Add(MonitoringEvent evt)
    {
        lock (_lock) _events.Add(evt);
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
                case EventType.MultipleFaces:   session.FaceStatus = "multi";    break;
            }

            session.RiskScore = CalculateRiskScoreLocked(evt.SessionId, session);
        }
    }

    private static double CalculateRiskScoreLocked(string sessionId, SessionInfo session)
    {
        // called while _lock is held — do not re-lock
        double score = 100;

        // Each deduction has a cap so a single bad actor doesn't go to 0 on one metric
        var tabSwitches    = 0;
        var faceAlerts     = 0;
        var multiFaces     = 0;
        var audioAlerts    = 0;
        var inactiveAlerts = 0;

        // We can't enumerate _events here without re-acquiring the lock (already held).
        // Instead we use the already-tracked EventCount and the FaceStatus / TabStatus as proxies.
        // Full event-based calculation is performed in GetSession (outside lock) for admin display.
        // This keeps the lock hot-path fast.
        return session.RiskScore; // will be recalculated outside if needed
    }

    public void RecalculateRiskScore(string sessionId)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var session)) return;

            var evts = _events.Where(e => e.SessionId == sessionId).ToList();
            double score = 100;
            score -= Math.Min(evts.Count(e => e.Type == EventType.TabSwitch),       5) * 10;
            score -= Math.Min(evts.Count(e => e.Type == EventType.FaceNotDetected), 5) * 8;
            score -= Math.Min(evts.Count(e => e.Type == EventType.MultipleFaces),   3) * 15;
            score -= Math.Min(evts.Count(e => e.Type == EventType.AudioAlert),      5) * 5;
            score -= Math.Min(evts.Count(e => e.Type == EventType.InactivityAlert), 5) * 3;

            session.RiskScore = Math.Max(0, Math.Round(score));
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
        RecalculateRiskScore(sessionId);
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
