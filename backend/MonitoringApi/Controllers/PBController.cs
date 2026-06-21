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
        var url    = $"https://docs.google.com/spreadsheets/d/{SheetId}/export?format=csv&gid={Gid}";
        var client = httpFactory.CreateClient();
        try
        {
            var res  = await client.GetAsync(url);
            var body = await res.Content.ReadAsStringAsync();

            // Google redirects to login page if sheet is private
            if (body.TrimStart().StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase))
                return StatusCode(403, "Sheet is not publicly accessible. Share it as 'Anyone with link can view'.");

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
