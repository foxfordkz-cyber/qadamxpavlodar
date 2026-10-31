param(
  [Parameter(Mandatory=$true)][string]$SourceDist,
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$SourceSha = 'a66d542c63c527d608400c84b34d49f982855369'
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $SourceDist).Path
$runtimePath = (Resolve-Path -LiteralPath $NodeExecutable).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'index.html') -PathType Leaf)) { throw 'Vite dist/index.html is missing.' }
$version = & $runtimePath --version
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne 'v24.22.1') { throw 'Expected Node v24.22.1.' }
if (Test-Path -LiteralPath $outputPath) {
  if ((Get-ChildItem -LiteralPath $outputPath -Force | Measure-Object).Count -gt 0) { throw 'Output must be a new or empty folder. Existing files are not overwritten.' }
}
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$runtimeOut = Join-Path $outputPath 'runtime'
New-Item -ItemType Directory -Path $runtimeOut | Out-Null
Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $outputPath 'site') -Recurse
Copy-Item -LiteralPath $runtimePath -Destination (Join-Path $runtimeOut 'node.exe')
$licenseUrl = 'https://raw.githubusercontent.com/nodejs/node/v24.22.1/LICENSE'
$licensePath = Join-Path $runtimeOut 'LICENSE.node.txt'
Invoke-WebRequest -Uri $licenseUrl -OutFile $licensePath
if (-not ((Get-Content -LiteralPath $licensePath -TotalCount 1) -match 'Node.js is licensed')) { throw 'Unexpected official license content.' }
foreach ($name in @('server.mjs','start-mock.cmd','README.md')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $outputPath $name)
}
$siteOut = Join-Path $outputPath 'site'
$files = @(Get-ChildItem -LiteralPath $siteOut -Recurse -File | Sort-Object FullName | ForEach-Object {
  @{path=[System.IO.Path]::GetRelativePath($outputPath,$_.FullName).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$manifest = @{
  sourceSha=$SourceSha; sourceDist=$sourcePath; builtUtc=(Get-Date).ToUniversalTime().ToString('o');
  runtime=@{version=$version.Trim();file='runtime/node.exe';sha256=(Get-FileHash -LiteralPath (Join-Path $runtimeOut 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant();license='runtime/LICENSE.node.txt';licenseUrl=$licenseUrl;licenseSha256=(Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash.ToLowerInvariant()};
  host='127.0.0.1';port=5194;mode='mock';apiEmulated=$false;externalMapOffline=$false;files=$files;
  launcherFiles=@(@('server.mjs','start-mock.cmd','README.md') | ForEach-Object { @{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $outputPath $_) -Algorithm SHA256).Hash.ToLowerInvariant()} })
}
[System.IO.File]::WriteAllText((Join-Path $outputPath 'package-manifest.json'),($manifest | ConvertTo-Json -Depth 8),[System.Text.UTF8Encoding]::new($false))
Write-Output "Portable mock built: $outputPath"
