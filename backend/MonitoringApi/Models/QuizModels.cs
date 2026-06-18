namespace MonitoringApi.Models;

public class Question
{
    public int Id { get; set; }
    public string Text { get; set; } = string.Empty;
    public bool? CorrectAnswer { get; set; } // null = no right/wrong, just recording
}

public class QuizAnswer
{
    public int QuestionId { get; set; }
    public string QuestionText { get; set; } = string.Empty;
    public bool Answer { get; set; }
    public bool? IsCorrect { get; set; }
}

public class QuizResult
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string SessionId { get; set; } = string.Empty;
    public List<QuizAnswer> Answers { get; set; } = [];
    public int Score { get; set; }
    public int Total { get; set; }
    public DateTime CompletedAt { get; set; } = DateTime.UtcNow;
}
