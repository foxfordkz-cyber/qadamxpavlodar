param([string]$BaseUrl = 'http://127.0.0.1:3100')
$ErrorActionPreference = 'Stop'
if ($BaseUrl -notmatch '^http://127\.0\.0\.1:\d+$') { throw 'Only a local loopback URL is allowed.' }

Invoke-RestMethod "$BaseUrl/health"
$coordinator = @{ 'X-Demo-User' = 'demo-coordinator-1' }
Invoke-RestMethod "$BaseUrl/plants?limit=2" -Headers $coordinator | ConvertTo-Json -Depth 8
Invoke-RestMethod "$BaseUrl/candidate-sites" -Headers $coordinator | ConvertTo-Json -Depth 8
Invoke-RestMethod "$BaseUrl/workers" -Headers $coordinator | ConvertTo-Json -Depth 8
$createHeaders = @{ 'X-Demo-User' = 'demo-coordinator-1'; 'Idempotency-Key' = 'demo-example-create-v1' }
$created = Invoke-RestMethod "$BaseUrl/tasks" -Method Post -Headers $createHeaders -ContentType 'application/json' -Body (@{
    title = 'DEMO API example'; assignedToId = 'demo-worker-1'; plantId = 'demo-plant-1'
} | ConvertTo-Json)
$taskId = $created.data.id
$startHeaders = @{ 'X-Demo-User' = 'demo-worker-1'; 'Idempotency-Key' = 'demo-example-start-v1' }
Invoke-RestMethod "$BaseUrl/tasks/$taskId" -Method Patch -Headers $startHeaders -ContentType 'application/json' -Body (@{
    version = 1; status = 'in_progress'
} | ConvertTo-Json) | ConvertTo-Json -Depth 8
$reportHeaders = @{ 'X-Demo-User' = 'demo-worker-1'; 'Idempotency-Key' = 'demo-example-report-v1' }
Invoke-RestMethod "$BaseUrl/reports" -Method Post -Headers $reportHeaders -ContentType 'application/json' -Body (@{
    taskId = $taskId; version = 2; notes = 'DEMO inspection complete'
} | ConvertTo-Json) | ConvertTo-Json -Depth 8
Invoke-RestMethod "$BaseUrl/tasks" -Headers $coordinator | ConvertTo-Json -Depth 8
