#requires -Version 7.0
param(
    [ValidatePattern('^[a-zA-Z0-9_-]{1,64}$')][string]$RunName = ('demo-' + [guid]::NewGuid().ToString('N').Substring(0, 8)),
    [ValidateRange(0,65535)][int]$Port = 0
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$runDir = Join-Path $projectRoot "data/demo-flow/$RunName"
$uploadDir = Join-Path $projectRoot "uploads/demo-flow/$RunName"
if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'dist/server.js'))) { throw 'Run npm run build first.' }
New-Item -ItemType Directory -Force -Path $runDir,$uploadDir | Out-Null
if ($Port -eq 0) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
    $listener.Start()
    $Port = $listener.LocalEndpoint.Port
    $listener.Stop()
}
$baseUrl = "http://127.0.0.1:$Port"
$demoCoordinator = 'demo-coordinator-1'
$demoWorker = 'demo-worker-1'
$backendProcess = $null
$savedEnvironment = @{}
foreach ($name in @('PORT','DB_PATH','UPLOADS_PATH','NODE_ENV','FRONTEND_ORIGINS')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
}
function Assert-Demo([bool]$Condition,[string]$Message) {
    if (!$Condition) { throw "DEMO check failed: $Message" }
}
function Send-Json([string]$Path,[string]$Method = 'GET',[string]$User = $demoCoordinator,$Body = $null,[string]$Key = '') {
    $headers = @{ 'X-Demo-User' = $User }
    if ($Key) { $headers['Idempotency-Key'] = $Key }
    $requestArgs = @{ Uri = "$baseUrl$Path"; Method = $Method; Headers = $headers; TimeoutSec = 10 }
    if ($null -ne $Body) { $requestArgs.ContentType = 'application/json'; $requestArgs.Body = ($Body | ConvertTo-Json -Depth 20 -Compress) }
    Invoke-RestMethod @requestArgs
}
function Start-DemoBackend {
    $launchId = [guid]::NewGuid().ToString('N')
    $stdout = Join-Path $runDir "server-$launchId.log"
    $stderr = Join-Path $runDir "server-$launchId.err.log"
    $script:backendProcess = Start-Process -FilePath $nodePath -ArgumentList @('--import','./scripts/local-network-guard.mjs','dist/server.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    for ($i=0; $i -lt 100; $i++) {
        if ($script:backendProcess.HasExited) { throw "Demo backend exited. See $stderr" }
        $ready = (Test-Path -LiteralPath $stdout) -and ((Get-Content -LiteralPath $stdout -Raw) -like '*Green Pavlodar DEMO*')
        if ($ready) {
            $health = Invoke-RestMethod "$baseUrl/health" -TimeoutSec 2
            Assert-Demo ($health.database -eq 'ok') 'health database'
            return
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Local backend readiness timeout.'
}
function Stop-DemoBackend {
    if ($script:backendProcess -and !$script:backendProcess.HasExited) {
        Stop-Process -Id $script:backendProcess.Id -ErrorAction Stop
        $script:backendProcess.WaitForExit()
    }
    $script:backendProcess = $null
}
function Send-Photo([string]$ReportId,[int]$Version,[string]$Key) {
    Invoke-RestMethod "$baseUrl/experimental/reports/$ReportId/photos" -Method Post -Headers @{
        'X-Demo-User'=$demoWorker; 'Idempotency-Key'=$Key
    } -Form @{ file=(Get-Item -LiteralPath (Join-Path $runDir 'synthetic.png')); version=[string]$Version } -TimeoutSec 15
}
Push-Location $projectRoot
try {
    $env:PORT = [string]$Port
    $env:DB_PATH = Join-Path $runDir 'demo.sqlite'
    $env:UPLOADS_PATH = $uploadDir
    $env:NODE_ENV = 'test'
    $env:FRONTEND_ORIGINS = ''
    & $nodePath dist/seed-cli.js
    if ($LASTEXITCODE -ne 0) { throw 'Seed failed.' }
    & $nodePath scripts/make-demo-image.mjs (Join-Path $runDir 'synthetic.png')
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture creation failed.' }
    Start-DemoBackend
    $plants = Send-Json '/plants'
    $sites = Send-Json '/candidate-sites'
    Assert-Demo ($plants.data.Count -eq 30 -and $sites.data.Count -eq 6) 'synthetic maps data'
    $created = Send-Json '/experimental/tasks' 'POST' $demoCoordinator @{title='DEMO integration flow';plantId='demo-plant-1'} 'flow-create'
    $taskId = $created.data.id
    $transitionPath = "/experimental/tasks/$taskId/transitions"
    $null = Send-Json $transitionPath 'POST' $demoCoordinator @{action='assign';version=1;assignedToId=$demoWorker} 'flow-assign'
    $null = Send-Json $transitionPath 'POST' $demoWorker @{action='start';version=2} 'flow-start'
    $first = Send-Json '/experimental/reports' 'POST' $demoWorker @{taskId=$taskId;version=3;notes='DEMO first report'} 'flow-report1'
    $photo1 = Send-Photo $first.data.id 4 'flow-photo1'
    Assert-Demo ($photo1.task.version -eq 5) 'photo increments review version'
    $null = Send-Json $transitionPath 'POST' $demoCoordinator @{action='return';version=5;comment='DEMO add a clearer observation'} 'flow-return'
    $null = Send-Json $transitionPath 'POST' $demoWorker @{action='start';version=6} 'flow-restart'
    $second = Send-Json '/experimental/reports' 'POST' $demoWorker @{taskId=$taskId;version=7;notes='DEMO revised report'} 'flow-report2'
    $photo2 = Send-Photo $second.data.id 8 'flow-photo2'
    $verified = Send-Json $transitionPath 'POST' $demoCoordinator @{action='verify';version=9;comment='DEMO result accepted'} 'flow-verify'
    Assert-Demo ($verified.data.status -eq 'verified' -and $verified.data.version -eq 10) 'coordinator verification'
    $history = Send-Json "/experimental/tasks/$taskId/history"
    Assert-Demo ($history.data.Count -eq 10) 'all transitions and photo events recorded'
    $forbidden = Invoke-WebRequest "$baseUrl$($photo2.data.contentUrl)" -Headers @{'X-Demo-User'='demo-worker-2'} -SkipHttpErrorCheck
    Assert-Demo ($forbidden.StatusCode -eq 404) 'other worker cannot read photo'
    Stop-DemoBackend
    Start-DemoBackend
    $persisted = Send-Json "/experimental/tasks/$taskId"
    Assert-Demo ($persisted.data.status -eq 'verified' -and $persisted.data.version -eq 10) 'task survives process restart'
    $afterRestart = Send-Json "/experimental/tasks/$taskId/history"
    Assert-Demo ($afterRestart.data.Count -eq 10) 'history survives restart'
    $persistedReport = Send-Json "/experimental/reports/$($second.data.id)"
    Assert-Demo ($persistedReport.data.status -eq 'verified' -and $persistedReport.photos.Count -eq 1) 'report and photo metadata survive restart'
    $downloaded = Join-Path $runDir 'verified-photo.webp'
    Invoke-WebRequest "$baseUrl$($photo2.data.contentUrl)" -Headers @{'X-Demo-User'=$demoCoordinator} -OutFile $downloaded
    Assert-Demo ((Get-FileHash -LiteralPath $downloaded -Algorithm SHA256).Hash.ToLowerInvariant() -eq $photo2.data.sha256) 'photo bytes survive restart'
    $repeatPhoto = Send-Photo $second.data.id 8 'flow-photo2'
    Assert-Demo ($repeatPhoto.data.id -eq $photo2.data.id) 'photo idempotency survives restart and verification'
    $legacyTasks = Send-Json '/tasks'
    Assert-Demo ($legacyTasks.data.Count -eq 15) 'legacy task workflow remains isolated'
    & $nodePath dist/seed-cli.js
    if ($LASTEXITCODE -ne 0) { throw 'Repeat seed failed.' }
    Assert-Demo ((Send-Json "/experimental/tasks/$taskId/history").data.Count -eq 10) 'repeat seed preserves experiment'
    $result = [ordered]@{ mode='DEMO'; contract='PROPOSED'; taskId=$taskId; status='verified'; version=10;
        historyEntries=10; reportRevisions=2; privatePhotos=2; legacyTasks=15; restart='PASS'; repeatSeed='PASS'; photoReplay='PASS';
        database=$env:DB_PATH; uploads=$uploadDir }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runDir 'result.json') -Encoding utf8
    $result | ConvertTo-Json -Depth 6
    Write-Output "PASS: integration demo. Files preserved in $runDir. Backend will now stop."
} finally {
    Stop-DemoBackend
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name],'Process') }
    Pop-Location
}
