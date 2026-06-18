using Microsoft.AspNetCore.Mvc;
using MonitoringApi.Hubs;

namespace MonitoringApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class QuizController(EventStore store) : ControllerBase
{
    [HttpGet("questions")]
    public IActionResult GetQuestions() => Ok(EventStore.GetQuestions());

    [HttpGet("results")]
    public IActionResult GetResults() => Ok(store.GetQuizResults());
}
