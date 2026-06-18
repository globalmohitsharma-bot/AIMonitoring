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
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
    public string FaceStatus { get; set; } = "unknown"; // "ok" | "alert" | "unknown"
    public string TabStatus { get; set; } = "active";   // "active" | "switched"
    public int EventCount { get; set; }
}

public enum EventType
{
    TabSwitch       = 0,
    FaceNotDetected = 1,
    FaceReturned    = 2,
    SessionStart    = 3,
    SessionEnd      = 4,
    TabReturned     = 5,
}
