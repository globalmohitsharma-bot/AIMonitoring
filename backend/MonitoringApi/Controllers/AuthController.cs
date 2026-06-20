using Microsoft.AspNetCore.Mvc;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _config;

    public AuthController(IConfiguration config) => _config = config;

    [HttpPost("monitor")]
    public IActionResult ValidateMonitorPassword([FromBody] PasswordRequest req)
    {
        var expected = _config["MonitorPassword"] ?? "Qazwsx"; // fallback for dev
        if (req.Password == expected)
            return Ok(new { success = true });
        return Unauthorized(new { success = false });
    }
}

public record PasswordRequest(string Password);
