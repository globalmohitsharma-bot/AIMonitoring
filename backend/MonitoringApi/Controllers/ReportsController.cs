using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using MonitoringApi.Hubs;
using MonitoringApi.Models;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ReportsController : ControllerBase
{
    private readonly EventStore _store;

    private static readonly Dictionary<EventType, string> EventLabels = new()
    {
        { EventType.TabSwitch,       "Tab Switch"       },
        { EventType.FaceNotDetected, "Face Lost"        },
        { EventType.FaceReturned,    "Face Returned"    },
        { EventType.SessionStart,    "Session Start"    },
        { EventType.SessionEnd,      "Session End"      },
        { EventType.TabReturned,     "Tab Returned"     },
        { EventType.QuizCompleted,   "Quiz Completed"   },
        { EventType.MultipleFaces,   "Multiple Faces"   },
        { EventType.AudioAlert,      "Audio Alert"      },
        { EventType.InactivityAlert, "Inactivity Alert" },
        { EventType.TimerExpired,    "Timer Expired"    },
    };

    public ReportsController(EventStore store) => _store = store;

    // GET /api/reports/excel
    [HttpGet("excel")]
    public IActionResult DownloadExcel()
    {
        var sessions = _store.GetSessions();
        var allEvents = _store.GetAll();
        var sessionMap = sessions.ToDictionary(s => s.SessionId);

        using var wb = new XLWorkbook();

        BuildCandidatesSheet(wb, sessions, allEvents);
        BuildEventsSheet(wb, allEvents, sessionMap);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        ms.Position = 0;

        var fileName = $"proctoring-report-{DateTime.UtcNow:yyyyMMdd-HHmm}.xlsx";
        return File(ms.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileName);
    }

    // ── Sheet 1: Candidates ───────────────────────────────────────────────────
    private static void BuildCandidatesSheet(XLWorkbook wb, List<SessionInfo> sessions, List<MonitoringEvent> allEvents)
    {
        var ws = wb.Worksheets.Add("Candidates");

        // Header row
        var headers = new[]
        {
            "#", "Name", "Email", "Session ID",
            "Started At", "Duration (min)",
            "Resume Match %",
            "Tab Switches", "Face Alerts", "Multiple Faces", "Audio Alerts", "Inactivity Alerts",
            "Quiz Score", "Quiz Total", "Quiz %",
            "Risk Score", "Result"
        };

        for (var c = 0; c < headers.Length; c++)
        {
            var cell = ws.Cell(1, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold        = true;
            cell.Style.Font.FontColor   = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#1e3a5f");
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }

        ws.Row(1).Height = 24;
        ws.SheetView.FreezeRows(1);

        // Data rows
        for (var i = 0; i < sessions.Count; i++)
        {
            var s    = sessions[i];
            var row  = i + 2;
            var evts = allEvents.Where(e => e.SessionId == s.SessionId).ToList();

            var tabSwitches    = evts.Count(e => e.Type == EventType.TabSwitch);
            var faceAlerts     = evts.Count(e => e.Type == EventType.FaceNotDetected);
            var multiFaces     = evts.Count(e => e.Type == EventType.MultipleFaces);
            var audioAlerts    = evts.Count(e => e.Type == EventType.AudioAlert);
            var inactiveAlerts = evts.Count(e => e.Type == EventType.InactivityAlert);
            var durationMin    = Math.Round((s.LastSeen - s.StartedAt).TotalMinutes, 1);
            var quizPct        = s.QuizTotal > 0 ? Math.Round((double)s.QuizScore! / s.QuizTotal!.Value * 100) : (double?)null;

            ws.Cell(row, 1).Value  = i + 1;
            ws.Cell(row, 2).Value  = s.CandidateName  ?? "—";
            ws.Cell(row, 3).Value  = s.CandidateEmail ?? "—";
            ws.Cell(row, 4).Value  = s.SessionId;
            ws.Cell(row, 5).Value  = s.StartedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
            ws.Cell(row, 6).Value  = durationMin;
            ws.Cell(row, 7).Value  = s.ResumeScore.HasValue  ? (XLCellValue)s.ResumeScore.Value  : "—";
            ws.Cell(row, 8).Value  = tabSwitches;
            ws.Cell(row, 9).Value  = faceAlerts;
            ws.Cell(row, 10).Value = multiFaces;
            ws.Cell(row, 11).Value = audioAlerts;
            ws.Cell(row, 12).Value = inactiveAlerts;
            ws.Cell(row, 13).Value = s.QuizScore.HasValue ? (XLCellValue)s.QuizScore.Value : "—";
            ws.Cell(row, 14).Value = s.QuizTotal.HasValue ? (XLCellValue)s.QuizTotal.Value : "—";
            ws.Cell(row, 15).Value = quizPct.HasValue      ? (XLCellValue)quizPct.Value     : "—";
            ws.Cell(row, 16).Value = s.RiskScore;

            // Result cell with colour
            var result      = s.RiskScore >= 80 ? "Pass" : s.RiskScore >= 50 ? "Review" : "Fail";
            var resultCell  = ws.Cell(row, 17);
            resultCell.Value = result;
            resultCell.Style.Font.Bold = true;
            resultCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            resultCell.Style.Fill.BackgroundColor = result switch
            {
                "Pass"   => XLColor.FromHtml("#dcfce7"),
                "Review" => XLColor.FromHtml("#fef9c3"),
                _        => XLColor.FromHtml("#fee2e2"),
            };
            resultCell.Style.Font.FontColor = result switch
            {
                "Pass"   => XLColor.FromHtml("#166534"),
                "Review" => XLColor.FromHtml("#854d0e"),
                _        => XLColor.FromHtml("#991b1b"),
            };

            // Zebra stripe
            if (i % 2 == 1)
            {
                for (var c = 1; c <= 16; c++)
                    ws.Cell(row, c).Style.Fill.BackgroundColor = XLColor.FromHtml("#f8fafc");
            }
        }

        // Alert-count cells: red if > 0
        for (var i = 0; i < sessions.Count; i++)
        {
            var row = i + 2;
            foreach (var col in new[] { 8, 9, 10, 11, 12 })
            {
                var cell = ws.Cell(row, col);
                if (cell.Value.IsNumber && cell.GetValue<int>() > 0)
                {
                    cell.Style.Font.FontColor = XLColor.FromHtml("#b91c1c");
                    cell.Style.Font.Bold      = true;
                }
            }
        }

        ws.Columns().AdjustToContents(1, sessions.Count + 1);
        ws.Column(4).Width = 22; // session ID column — cap width
        ws.Column(4).Style.Font.FontName = "Consolas";

        var tableRange = ws.Range(1, 1, Math.Max(sessions.Count + 1, 2), headers.Length);
        tableRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        tableRange.Style.Border.OutsideBorderColor = XLColor.FromHtml("#cbd5e1");
        tableRange.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        tableRange.Style.Border.InsideBorderColor = XLColor.FromHtml("#e2e8f0");
    }

    // ── Sheet 2: Event Log ────────────────────────────────────────────────────
    private static void BuildEventsSheet(XLWorkbook wb, List<MonitoringEvent> allEvents, Dictionary<string, SessionInfo> sessionMap)
    {
        var ws = wb.Worksheets.Add("Event Log");

        var headers = new[] { "Timestamp", "Candidate Name", "Email", "Session ID", "Event Type", "Message", "Severity" };
        for (var c = 0; c < headers.Length; c++)
        {
            var cell = ws.Cell(1, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold        = true;
            cell.Style.Font.FontColor   = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#374151");
        }

        ws.Row(1).Height = 22;
        ws.SheetView.FreezeRows(1);

        var sorted = allEvents.OrderByDescending(e => e.Timestamp).ToList();
        for (var i = 0; i < sorted.Count; i++)
        {
            var evt  = sorted[i];
            var row  = i + 2;
            var sess = sessionMap.TryGetValue(evt.SessionId, out var s) ? s : null;

            ws.Cell(row, 1).Value = evt.Timestamp.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
            ws.Cell(row, 2).Value = sess?.CandidateName  ?? "—";
            ws.Cell(row, 3).Value = sess?.CandidateEmail ?? "—";
            ws.Cell(row, 4).Value = evt.SessionId;
            ws.Cell(row, 5).Value = EventLabels.TryGetValue(evt.Type, out var label) ? label : evt.Type.ToString();
            ws.Cell(row, 6).Value = evt.Message;
            ws.Cell(row, 7).Value = evt.Severity;

            var sevCell = ws.Cell(row, 7);
            sevCell.Style.Font.FontColor = evt.Severity switch
            {
                "error"   => XLColor.FromHtml("#dc2626"),
                "warning" => XLColor.FromHtml("#d97706"),
                _         => XLColor.FromHtml("#16a34a"),
            };
        }

        ws.Columns().AdjustToContents(1, sorted.Count + 1);
        ws.Column(4).Width    = 22;
        ws.Column(4).Style.Font.FontName = "Consolas";

        var tableRange = ws.Range(1, 1, Math.Max(sorted.Count + 1, 2), headers.Length);
        tableRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        tableRange.Style.Border.OutsideBorderColor = XLColor.FromHtml("#cbd5e1");
        tableRange.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        tableRange.Style.Border.InsideBorderColor = XLColor.FromHtml("#e2e8f0");
    }
}
