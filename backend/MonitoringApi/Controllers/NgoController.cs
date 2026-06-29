using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/ngo")]
public class NgoController : ControllerBase
{
    private static readonly string DataDir = Path.Combine(
        Environment.GetEnvironmentVariable("HOME") ?? AppContext.BaseDirectory, "data");

    private static readonly string EventsFile = Path.Combine(DataDir, "ngo_events.json");
    private static readonly string RegsFile   = Path.Combine(DataDir, "ngo_registrations.json");
    private static readonly object FileLock   = new();

    private const string AdminPassword = "NGO123";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy        = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition      = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented               = true,
    };

    static NgoController()
    {
        Directory.CreateDirectory(DataDir);
        if (!System.IO.File.Exists(EventsFile)) System.IO.File.WriteAllText(EventsFile, "[]");
        if (!System.IO.File.Exists(RegsFile))   System.IO.File.WriteAllText(RegsFile,   "[]");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static List<NgoEvent> ReadEvents()
    {
        lock (FileLock)
        {
            var json = System.IO.File.ReadAllText(EventsFile);
            return JsonSerializer.Deserialize<List<NgoEvent>>(json, JsonOpts) ?? [];
        }
    }

    private static void WriteEvents(List<NgoEvent> events)
    {
        lock (FileLock)
        {
            System.IO.File.WriteAllText(EventsFile, JsonSerializer.Serialize(events, JsonOpts));
        }
    }

    private static List<NgoRegistration> ReadRegistrations()
    {
        lock (FileLock)
        {
            var json = System.IO.File.ReadAllText(RegsFile);
            return JsonSerializer.Deserialize<List<NgoRegistration>>(json, JsonOpts) ?? [];
        }
    }

    private static void AppendRegistration(NgoRegistration reg)
    {
        lock (FileLock)
        {
            var list = JsonSerializer.Deserialize<List<NgoRegistration>>(
                System.IO.File.ReadAllText(RegsFile), JsonOpts) ?? [];
            list.Add(reg);
            System.IO.File.WriteAllText(RegsFile, JsonSerializer.Serialize(list, JsonOpts));
        }
    }

    private static string GenerateRegNumber(string campType)
    {
        var prefix = campType?.ToUpperInvariant() switch
        {
            "EYE" => "EYE",
            "MED" => "MED",
            "FD"  => "FD",
            "EDU" => "EDU",
            _     => "GEN",
        };
        var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var rand  = new Random();
        var code  = new string(Enumerable.Range(0, 6).Select(_ => chars[rand.Next(chars.Length)]).ToArray());
        return $"SABT-{prefix}-{DateTime.Now.Year}-{code}";
    }

    private bool IsAdmin() =>
        Request.Query.TryGetValue("password", out var pw) && pw == AdminPassword;

    // ── Events — public read ─────────────────────────────────────────────────

    [HttpGet("events")]
    public IActionResult GetEvents()
    {
        var events = ReadEvents();
        // Non-admin: only return active events, strip field config
        if (!IsAdmin())
            events = events.Where(e => e.IsActive).ToList();
        return Ok(events);
    }

    [HttpGet("events/{id}")]
    public IActionResult GetEvent(string id)
    {
        var ev = ReadEvents().FirstOrDefault(e => e.Id == id);
        if (ev == null) return NotFound(new { error = "Event not found" });
        if (!ev.IsActive && !IsAdmin()) return NotFound(new { error = "Event not found" });
        return Ok(ev);
    }

    // ── Events — admin write ─────────────────────────────────────────────────

    [HttpPost("events")]
    public IActionResult CreateEvent([FromBody] NgoEventInput input)
    {
        if (!IsAdmin()) return Unauthorized(new { error = "Unauthorized" });
        var events = ReadEvents();
        var ev = new NgoEvent
        {
            Id          = Guid.NewGuid().ToString("N")[..12],
            Name        = input.Name,
            CampType    = input.CampType?.ToUpperInvariant(),
            Date        = input.Date,
            Location    = input.Location,
            Description = input.Description,
            IsActive    = input.IsActive,
            Fields      = input.Fields ?? [],
            CreatedAt   = DateTime.UtcNow,
        };
        events.Add(ev);
        WriteEvents(events);
        return Ok(ev);
    }

    [HttpPut("events/{id}")]
    public IActionResult UpdateEvent(string id, [FromBody] NgoEventInput input)
    {
        if (!IsAdmin()) return Unauthorized(new { error = "Unauthorized" });
        var events = ReadEvents();
        var ev = events.FirstOrDefault(e => e.Id == id);
        if (ev == null) return NotFound(new { error = "Event not found" });
        ev.Name        = input.Name;
        ev.CampType    = input.CampType?.ToUpperInvariant();
        ev.Date        = input.Date;
        ev.Location    = input.Location;
        ev.Description = input.Description;
        ev.IsActive    = input.IsActive;
        ev.Fields      = input.Fields ?? [];
        WriteEvents(events);
        return Ok(ev);
    }

    [HttpDelete("events/{id}")]
    public IActionResult DeleteEvent(string id)
    {
        if (!IsAdmin()) return Unauthorized(new { error = "Unauthorized" });
        var events = ReadEvents();
        var count  = events.RemoveAll(e => e.Id == id);
        if (count == 0) return NotFound(new { error = "Event not found" });
        WriteEvents(events);
        return Ok(new { success = true });
    }

    // ── Registration ─────────────────────────────────────────────────────────

    [HttpPost("register")]
    public IActionResult Register([FromBody] RegistrationInput input)
    {
        var ev = ReadEvents().FirstOrDefault(e => e.Id == input.EventId && e.IsActive);
        if (ev == null) return BadRequest(new { error = "Event not found or no longer active." });

        // Validate required fields
        if (string.IsNullOrWhiteSpace(input.Data?.GetValueOrDefault("name")))
            return BadRequest(new { error = "Name is required." });
        if (string.IsNullOrWhiteSpace(input.Data?.GetValueOrDefault("phone")))
            return BadRequest(new { error = "Phone number is required." });

        foreach (var field in ev.Fields.Where(f => f.Enabled && f.Mandatory))
        {
            if (!input.Data!.TryGetValue(field.Key, out var val) || string.IsNullOrWhiteSpace(val))
                return BadRequest(new { error = $"{field.Key} is required." });
        }

        var regNum = GenerateRegNumber(ev.CampType);
        var reg = new NgoRegistration
        {
            RegistrationNumber = regNum,
            EventId            = ev.Id,
            EventName          = ev.Name,
            CampType           = ev.CampType,
            EventDate          = ev.Date,
            RegisteredAt       = DateTime.UtcNow,
            Data               = input.Data ?? [],
        };
        AppendRegistration(reg);
        return Ok(new { success = true, registrationNumber = regNum });
    }

    // ── Registrations — admin ────────────────────────────────────────────────

    [HttpGet("registrations")]
    public IActionResult GetRegistrations(
        [FromQuery] string? eventId   = null,
        [FromQuery] string? campType  = null,
        [FromQuery] string? name      = null,
        [FromQuery] string? from      = null,
        [FromQuery] string? to        = null)
    {
        if (!IsAdmin()) return Unauthorized(new { error = "Unauthorized" });

        var regs = ReadRegistrations().AsEnumerable();
        if (!string.IsNullOrEmpty(eventId))  regs = regs.Where(r => r.EventId == eventId);
        if (!string.IsNullOrEmpty(campType)) regs = regs.Where(r => r.CampType == campType);
        if (!string.IsNullOrEmpty(name))     regs = regs.Where(r => r.Data.GetValueOrDefault("name","").Contains(name, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(from))     regs = regs.Where(r => string.Compare(r.RegisteredAt.ToString("yyyy-MM-dd"), from) >= 0);
        if (!string.IsNullOrEmpty(to))       regs = regs.Where(r => string.Compare(r.RegisteredAt.ToString("yyyy-MM-dd"), to) <= 0);

        return Ok(regs.OrderByDescending(r => r.RegisteredAt).ToList());
    }

    [HttpGet("registrations/export")]
    public IActionResult ExportRegistrations(
        [FromQuery] string? eventId   = null,
        [FromQuery] string? campType  = null,
        [FromQuery] string? name      = null,
        [FromQuery] string? from      = null,
        [FromQuery] string? to        = null)
    {
        if (!IsAdmin()) return Unauthorized(new { error = "Unauthorized" });

        var regs = ReadRegistrations().AsEnumerable();
        if (!string.IsNullOrEmpty(eventId))  regs = regs.Where(r => r.EventId == eventId);
        if (!string.IsNullOrEmpty(campType)) regs = regs.Where(r => r.CampType == campType);
        if (!string.IsNullOrEmpty(name))     regs = regs.Where(r => r.Data.GetValueOrDefault("name","").Contains(name, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(from))     regs = regs.Where(r => string.Compare(r.RegisteredAt.ToString("yyyy-MM-dd"), from) >= 0);
        if (!string.IsNullOrEmpty(to))       regs = regs.Where(r => string.Compare(r.RegisteredAt.ToString("yyyy-MM-dd"), to) <= 0);

        var list = regs.OrderByDescending(r => r.RegisteredAt).ToList();

        // Collect all dynamic field keys in order
        var allKeys = list.SelectMany(r => r.Data.Keys).Distinct()
            .Where(k => k != "name" && k != "phone").ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Registrations");

        var fixedHeaders = new[] { "#", "Registration Number", "Name", "Phone", "Event", "Camp Type", "Camp Date", "Registered At" };
        var headers = fixedHeaders.Concat(allKeys.Select(k => CamelToTitle(k))).ToArray();

        for (var c = 0; c < headers.Length; c++)
        {
            var cell = ws.Cell(1, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#0D1B2A");
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }
        ws.Row(1).Height = 24;
        ws.SheetView.FreezeRows(1);

        for (var i = 0; i < list.Count; i++)
        {
            var r   = list[i];
            var row = i + 2;
            ws.Cell(row, 1).Value = i + 1;
            ws.Cell(row, 2).Value = r.RegistrationNumber;
            ws.Cell(row, 2).Style.Font.FontName = "Courier New";
            ws.Cell(row, 2).Style.Font.FontColor = XLColor.FromHtml("#C8860A");
            ws.Cell(row, 3).Value = r.Data.GetValueOrDefault("name", "—");
            ws.Cell(row, 4).Value = r.Data.GetValueOrDefault("phone", "—");
            ws.Cell(row, 5).Value = r.EventName ?? "—";
            ws.Cell(row, 6).Value = r.CampType ?? "—";
            ws.Cell(row, 7).Value = r.EventDate ?? "—";
            ws.Cell(row, 8).Value = r.RegisteredAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");

            for (var j = 0; j < allKeys.Count; j++)
                ws.Cell(row, fixedHeaders.Length + 1 + j).Value = r.Data.GetValueOrDefault(allKeys[j], "—");

            if (i % 2 == 1)
                for (var c = 1; c <= headers.Length; c++)
                    ws.Cell(row, c).Style.Fill.BackgroundColor = XLColor.FromHtml("#FFFDF7");
        }

        ws.Columns().AdjustToContents(1, list.Count + 1);
        var range = ws.Range(1, 1, Math.Max(list.Count + 1, 2), headers.Length);
        range.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        range.Style.Border.OutsideBorderColor = XLColor.FromHtml("#E8E2D8");
        range.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        range.Style.Border.InsideBorderColor = XLColor.FromHtml("#E8E2D8");

        using var ms = new MemoryStream();
        wb.SaveAs(ms); ms.Position = 0;
        var fileName = $"SABT-Registrations-{DateTime.Now:yyyyMMdd-HHmm}.xlsx";
        return File(ms.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    private static string CamelToTitle(string key)
    {
        if (string.IsNullOrEmpty(key)) return key;
        var result = System.Text.RegularExpressions.Regex.Replace(key, "(\\B[A-Z])", " $1");
        return char.ToUpper(result[0]) + result[1..];
    }
}

// ── Models ────────────────────────────────────────────────────────────────────

public class NgoEvent
{
    public string   Id          { get; set; } = "";
    public string   Name        { get; set; } = "";
    public string?  CampType    { get; set; }
    public string?  Date        { get; set; }
    public string?  Location    { get; set; }
    public string?  Description { get; set; }
    public bool     IsActive    { get; set; } = true;
    public List<FieldConfig> Fields { get; set; } = [];
    public DateTime CreatedAt   { get; set; } = DateTime.UtcNow;
}

public class FieldConfig
{
    public string Key       { get; set; } = "";
    public bool   Enabled   { get; set; }
    public bool   Mandatory { get; set; }
}

public class NgoEventInput
{
    public string   Name        { get; set; } = "";
    public string?  CampType    { get; set; }
    public string?  Date        { get; set; }
    public string?  Location    { get; set; }
    public string?  Description { get; set; }
    public bool     IsActive    { get; set; } = true;
    public List<FieldConfig>? Fields { get; set; }
}

public class NgoRegistration
{
    public string   RegistrationNumber { get; set; } = "";
    public string   EventId            { get; set; } = "";
    public string?  EventName          { get; set; }
    public string?  CampType           { get; set; }
    public string?  EventDate          { get; set; }
    public DateTime RegisteredAt       { get; set; } = DateTime.UtcNow;
    public Dictionary<string, string> Data { get; set; } = [];
}

public class RegistrationInput
{
    public string EventId { get; set; } = "";
    public Dictionary<string, string>? Data { get; set; }
}
