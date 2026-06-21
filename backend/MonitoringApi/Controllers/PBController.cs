using Microsoft.AspNetCore.Mvc;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/pb")]
public class PBController(IHttpClientFactory httpFactory) : ControllerBase
{
    private const string SheetId = "1e729W4MXvlGXGLpmIrQugkCuCIVWWm9QqJtxONxFGo8";
    private const string Gid     = "1417050744";

    [HttpGet("sheet")]
    public async Task<IActionResult> GetSheet()
    {
        // /pub URL requires "Published to the web" (File → Share → Publish to the web → CSV)
        // This is more reliable than /export for server-side fetching
        var url    = $"https://docs.google.com/spreadsheets/d/{SheetId}/pub?gid={Gid}&single=true&output=csv";
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
