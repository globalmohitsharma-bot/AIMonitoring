using Microsoft.AspNetCore.Mvc;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/pb")]
public class PBController(IHttpClientFactory httpFactory) : ControllerBase
{
    // Published-to-web CSV URL (File → Share → Publish to the web → PB tab → CSV)
    private const string PublishedCsvUrl =
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vSRHqp1TWLyAEgydJ19b6vCJcTGCCxGrLcB1Mccw95xndfc9mbC1y5y3ev5T1njzE0evlvGIHA6OGH1/pub?gid=1417050744&single=true&output=csv";

    [HttpGet("sheet")]
    public async Task<IActionResult> GetSheet()
    {
        var url = PublishedCsvUrl;
        var client = httpFactory.CreateClient();
        try
        {
            var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("User-Agent", "Mozilla/5.0 (compatible; SheetsProxy/1.0)");
            req.Headers.Add("Accept", "text/csv,text/plain,*/*");

            var res  = await client.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();

            if (body.TrimStart().StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) ||
                body.TrimStart().StartsWith("<html", StringComparison.OrdinalIgnoreCase))
            {
                return StatusCode(403,
                    "Publish the sheet first: File → Share → Publish to the web → select 'PB' tab → CSV → Publish.");
            }

            if (!res.IsSuccessStatusCode)
                return StatusCode((int)res.StatusCode, "Google returned an error.");

            return Content(body, "text/csv");
        }
        catch (Exception ex)
        {
            return StatusCode(500, ex.Message);
        }
    }
}
