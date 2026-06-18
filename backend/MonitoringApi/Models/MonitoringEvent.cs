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

public enum EventType
{
    TabSwitch,
    FaceNotDetected,
    FaceReturned,
    SessionStart,
    SessionEnd
}
