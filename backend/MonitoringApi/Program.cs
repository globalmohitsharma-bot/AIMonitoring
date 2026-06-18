using MonitoringApi.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<EventStore>();
builder.Services.AddSignalR();
builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactApp", policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors("ReactApp");
app.UseHttpsRedirection();
app.MapControllers();
app.MapHub<MonitoringHub>("/hub/monitoring");

app.Run();
