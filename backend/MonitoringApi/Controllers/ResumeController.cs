using Microsoft.AspNetCore.Mvc;
using UglyToad.PdfPig;
using DocumentFormat.OpenXml.Packaging;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ResumeController : ControllerBase
{
    // ── Job Description ────────────────────────────────────────────────────────
    private static readonly string JdTitle       = ".NET Full Stack Developer";
    private static readonly string JdDescription =
        "We are looking for a Senior .NET Full Stack Developer to join our team " +
        "building AI-powered proctoring and assessment platforms. You will design " +
        "and build scalable real-time web applications using modern .NET and React.";

    // Each entry: display name → keyword patterns to look for in the resume
    private static readonly Dictionary<string, string[]> JdSkills = new()
    {
        { ".NET / ASP.NET Core",   [".net", "asp.net", "dotnet", "net core", "net 8", "net 9", "net 10"] },
        { "C#",                    ["c#", "csharp", "c sharp"] },
        { "React / JavaScript",    ["react", "reactjs", "javascript", "typescript", "es6"] },
        { "SignalR / WebSockets",  ["signalr", "websocket", "real-time", "realtime"] },
        { "REST API Design",       ["rest", "restful", "web api", "http api"] },
        { "SQL Server / Database", ["sql", "sql server", "mssql", "database", "postgres", "mongodb"] },
        { "Azure / Cloud",         ["azure", "aws", "gcp", "cloud", "app service"] },
        { "Git / Version Control", ["git", "github", "gitlab", "bitbucket", "version control"] },
        { "HTML / CSS",            ["html", "css", "frontend", "front-end", "ui"] },
        { "Agile / Scrum",         ["agile", "scrum", "kanban", "sprint", "jira"] },
    };

    // ── GET /api/resume/jd ─────────────────────────────────────────────────────
    [HttpGet("jd")]
    public IActionResult GetJd() => Ok(new
    {
        title       = JdTitle,
        description = JdDescription,
        skills      = JdSkills.Keys.ToList(),
        minMatch    = 50
    });

    // ── POST /api/resume/analyze ───────────────────────────────────────────────
    [HttpPost("analyze")]
    [RequestSizeLimit(10 * 1024 * 1024)] // 10 MB
    public async Task<IActionResult> Analyze(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "Please upload a resume file." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not (".pdf" or ".docx" or ".doc" or ".txt"))
            return BadRequest(new { error = "Supported formats: PDF, DOCX, TXT" });

        string resumeText;
        try
        {
            resumeText = await ExtractText(file, ext);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = $"Could not read file: {ex.Message}" });
        }

        if (string.IsNullOrWhiteSpace(resumeText))
            return BadRequest(new { error = "Could not extract text from the file. Try a different format." });

        // ── Match skills ──────────────────────────────────────────────────────
        var lower   = resumeText.ToLowerInvariant();
        var matched = new List<string>();
        var missing = new List<string>();

        foreach (var (skill, patterns) in JdSkills)
        {
            if (patterns.Any(p => lower.Contains(p)))
                matched.Add(skill);
            else
                missing.Add(skill);
        }

        var pct    = Math.Round((double)matched.Count / JdSkills.Count * 100);
        var passed = pct >= 50;

        return Ok(new
        {
            matchPercentage = pct,
            matchedSkills   = matched,
            missingSkills   = missing,
            totalSkills     = JdSkills.Count,
            passed,
            message = passed
                ? $"Great match! You scored {pct}% — proceeding to the assessment."
                : $"Your profile scored {pct}%. A minimum of 50% is required for this role."
        });
    }

    // ── Text extraction helpers ────────────────────────────────────────────────
    private static async Task<string> ExtractText(IFormFile file, string ext)
    {
        await using var stream = file.OpenReadStream();

        if (ext == ".pdf")
        {
            using var pdf = PdfDocument.Open(stream);
            return string.Join(" ", pdf.GetPages().Select(p => p.Text));
        }

        if (ext is ".docx" or ".doc")
        {
            using var ms = new MemoryStream();
            await stream.CopyToAsync(ms);
            ms.Position = 0;
            using var doc = WordprocessingDocument.Open(ms, false);
            return doc.MainDocumentPart?.Document?.Body?.InnerText ?? string.Empty;
        }

        // Plain text
        using var reader = new StreamReader(stream);
        return await reader.ReadToEndAsync();
    }
}
