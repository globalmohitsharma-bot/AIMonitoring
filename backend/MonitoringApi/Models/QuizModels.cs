namespace MonitoringApi.Models;

public class Question
{
    public int Id { get; set; }
    public string Text { get; set; } = string.Empty;
    public string Type { get; set; } = "yesno"; // "yesno" | "mcq"
    public List<string> Options { get; set; } = [];
    // yesno: "yes" | "no" | null (ungraded)
    // mcq:   exact option text that is correct | null (ungraded)
    public string? CorrectAnswer { get; set; }
}

public class QuizAnswer
{
    public int QuestionId { get; set; }
    public string QuestionText { get; set; } = string.Empty;
    public string Answer { get; set; } = ""; // "yes"/"no" or selected option text
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
