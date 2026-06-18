# Start backend and frontend in separate terminal windows
Write-Host "Starting .NET backend on http://localhost:5165 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'f:\Projects\AIMonitoring\backend\MonitoringApi'; dotnet run --launch-profile http"

Start-Sleep -Seconds 2

Write-Host "Starting React frontend on http://localhost:5173 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'f:\Projects\AIMonitoring\frontend'; npm run dev"

Write-Host ""
Write-Host "Backend:  http://localhost:5165"
Write-Host "Frontend: http://localhost:5173"
Write-Host "API logs: http://localhost:5165/api/events"
