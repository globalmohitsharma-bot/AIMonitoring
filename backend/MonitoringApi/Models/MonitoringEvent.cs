namespace MonitoringApi.Models;

public class MonitoringEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string SessionId { get; set; } = string.Empty;
    public EventType Type { get; set; }
    public string Message { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string Severity { get; set; } = "warning";
}

public class SessionInfo
{
    public string SessionId { get; set; } = string.Empty;
    public string? CandidateName { get; set; }
    public string? CandidateEmail { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
    public string FaceStatus { get; set; } = "unknown"; // "ok" | "alert" | "unknown"
    public string TabStatus { get; set; } = "active";   // "active" | "switched"
    public int EventCount { get; set; }
    public int? QuizScore { get; set; }
    public int? QuizTotal { get; set; }
    public double RiskScore { get; set; } = 100;
}

public enum EventType
{
    TabSwitch       = 0,
    FaceNotDetected = 1,
    FaceReturned    = 2,
    SessionStart    = 3,
    SessionEnd      = 4,
    TabReturned     = 5,
    QuizCompleted   = 6,
    MultipleFaces   = 7,
    AudioAlert      = 8,
    InactivityAlert = 9,
    TimerExpired    = 10,
}
