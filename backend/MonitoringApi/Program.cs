using MonitoringApi.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<EventStore>();
builder.Services.AddHttpClient();
builder.Services.AddSignalR(options =>
{
    // Allow larger messages for JPEG frame snapshots (~20–50 KB each)
    options.MaximumReceiveMessageSize = 131072; // 128 KB
});
builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactApp", policy =>
    {
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors("ReactApp");

// Route shriavadhbiharicharitabletrust.org → NGO subdirectory
app.Use(async (context, next) =>
{
    var host = context.Request.Host.Host;
    if (host.Contains("shriavadhbiharicharitabletrust", StringComparison.OrdinalIgnoreCase))
    {
        var path = context.Request.Path.Value?.TrimEnd('/') ?? "";
        if (string.IsNullOrEmpty(path) || path == "/")
            context.Request.Path = "/ngo/index.html";
        else if (path == "/register")
            context.Request.Path = "/ngo/register.html";
        else if (path == "/admin")
            context.Request.Path = "/ngo/admin.html";
        else if (!path.Contains('.'))
            context.Request.Path = "/ngo" + path + "/index.html";
        else
            context.Request.Path = "/ngo" + path;
    }
    await next();
});

app.UseDefaultFiles();

// Serve assets with long-term cache (filenames are hash-busted by Vite)
app.UseStaticFiles(new StaticFileOptions
{
    ServeUnknownFileTypes = true,
    DefaultContentType = "application/octet-stream",
    OnPrepareResponse = ctx =>
    {
        var path = ctx.File.Name;
        if (path == "index.html")
        {
            // Never cache index.html — it references hashed asset filenames
            ctx.Context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
            ctx.Context.Response.Headers["Pragma"] = "no-cache";
        }
        else if (path.EndsWith(".js") || path.EndsWith(".css"))
        {
            // Hash-named assets can be cached forever
            ctx.Context.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
    }
});

app.MapControllers();
app.MapHub<MonitoringHub>("/hub/monitoring");

// Serve SEO-optimised static page for /resume (before SPA fallback)
app.MapGet("/resume", async ctx =>
{
    ctx.Response.ContentType = "text/html; charset=utf-8";
    ctx.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
    await ctx.Response.SendFileAsync(
        Path.Combine(app.Environment.WebRootPath, "resume.html"));
});

app.MapFallbackToFile("index.html");

app.Run();
