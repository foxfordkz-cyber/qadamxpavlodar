$ErrorActionPreference = 'Stop'
$qaPassword = $null
$qaPasswordPointer = [IntPtr]::Zero
$qaStart = $null
try {
  $qaNode = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..\..\qadamxpavlodar-e2e\tools\e2e\test-results\runtime\node_modules\node\bin\node.exe'))
  if (-not (Test-Path -LiteralPath $qaNode -PathType Leaf)) { throw 'The prepared Node 24 runtime was not found.' }
  $qaRunner = Join-Path $PSScriptRoot 'run.mjs'
  if (-not (Test-Path -LiteralPath $qaRunner -PathType Leaf)) { throw 'The QA preflight runner was not found.' }
  Write-Host 'Green Pavlodar: continue existing report review and viewer checks.'
  Write-Host 'Existing report only: no repeated task start, photo upload or report creation. No restart.'
  $qaPassword = Read-Host 'Enter the CLOUD ACCEPTANCE password provided privately by Bekzat' -AsSecureString
  if ($qaPassword.Length -lt 12) { throw 'Password is missing or too short. Nothing was sent.' }
  $qaStart = New-Object System.Diagnostics.ProcessStartInfo
  $qaStart.FileName = $qaNode
  $qaStart.Arguments = '"' + $qaRunner + '" --resume-review'
  $qaStart.WorkingDirectory = $PSScriptRoot
  $qaStart.UseShellExecute = $false
  $qaStart.CreateNoWindow = $true
  $qaStart.RedirectStandardOutput = $true
  $qaStart.RedirectStandardError = $true
  $qaStart.EnvironmentVariables.Clear()
  foreach ($qaName in @('SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA')) {
    $qaValue = [Environment]::GetEnvironmentVariable($qaName, 'Process')
    if ($null -ne $qaValue) { $qaStart.EnvironmentVariables[$qaName] = $qaValue }
  }
  $qaStart.EnvironmentVariables['CLOUD_ACCEPTANCE_DEMO'] = '1'
  $qaStart.EnvironmentVariables['CLOUD_ACCEPTANCE_ORIGIN'] = 'https://green-pavlodar-api.pages.dev'
  $qaStart.EnvironmentVariables['CLOUD_ACCEPTANCE_BROWSER_ORIGIN'] = 'https://green-pavlodar-api.pages.dev'
  $qaPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($qaPassword)
  $qaStart.EnvironmentVariables['CLOUD_ACCEPTANCE_PASSWORD'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($qaPasswordPointer)
  $qaChild = New-Object System.Diagnostics.Process
  $qaChild.StartInfo = $qaStart
  [void] $qaChild.Start()
  $qaStart.EnvironmentVariables.Remove('CLOUD_ACCEPTANCE_PASSWORD')
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($qaPasswordPointer)
  $qaPasswordPointer = [IntPtr]::Zero
  $qaPassword.Dispose()
  $qaPassword = $null
  $qaOutputTask = $qaChild.StandardOutput.ReadToEndAsync()
  $qaErrorTask = $qaChild.StandardError.ReadToEndAsync()
  $qaChild.WaitForExit()
  $qaOutput = $qaOutputTask.GetAwaiter().GetResult()
  [void] $qaErrorTask.GetAwaiter().GetResult()
  $qaSafeResult = $qaOutput | ConvertFrom-Json
  if (@('PASS','FAIL','BLOCKED_ACCESS','BLOCKED_CONFIGURATION') -contains $qaSafeResult.result) {
    Write-Host ('QA result: ' + $qaSafeResult.result)
  } else { throw 'No safe QA result received.' }
  Write-Host ('QA process exit code: ' + $qaChild.ExitCode)
  if ($qaSafeResult.artifact -match '^run-[0-9TZ.\-]+-[a-f0-9]{6}/result\.json$') {
    Write-Host 'A sanitized result file was saved. Tell Aidana the check finished.'
  }
} catch {
  Write-Host 'QA could not start or finish. No password or raw error is displayed.'
} finally {
  if ($null -ne $qaStart) { $qaStart.EnvironmentVariables.Remove('CLOUD_ACCEPTANCE_PASSWORD') }
  if ($qaPasswordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($qaPasswordPointer) }
  if ($null -ne $qaPassword) { $qaPassword.Dispose() }
  [void] (Read-Host 'Press Enter to close')
}
