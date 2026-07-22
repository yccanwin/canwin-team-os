param(
  [switch]$SelfTest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$AgentName = 'team-os-4-api-key-availability'
$TargetProjectRef = 'jgcrhoabvaowxnqksvkq'
$NodeExecutable = 'C:\Program Files\nodejs\node.exe'
$NpxCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js'
$SourceFile = 'platform/team-os-4/tools/acceptance-accounts/scripts/verify-api-key-availability.ps1'
$TeamOs4Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..\..'))
$AuditRoot = Join-Path $RepoRoot '.codex-audit\team-os-4-g1'

function Protect-AuditText {
  param([AllowNull()][object]$Value)

  $safe = [string]$Value
  $safe = $safe -replace '(?i)\bBearer\s+[A-Za-z0-9._-]+', 'Bearer [REDACTED]'
  $safe = $safe -replace '\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}\b', '[REDACTED_JWT]'
  $safe = $safe -replace '\bsb_(?:secret|publishable)_[A-Za-z0-9._-]+\b', '[REDACTED_SUPABASE_KEY]'
  $safe = $safe -replace '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', '[REDACTED_EMAIL]'
  $safe = $safe -replace '(?i)\b(password|passwd|authorization|access[_-]?token|refresh[_-]?token|service[_-]?role|api[_-]?key|secret)\s*[:=]\s*[^,}\s]+', '$1=[REDACTED]'
  return $safe
}

function Expand-ApiKeyItems {
  param([AllowNull()][object]$InputObject)

  if ($null -eq $InputObject) { return }
  if ($InputObject -is [System.Array]) {
    foreach ($child in $InputObject) {
      Expand-ApiKeyItems -InputObject $child
    }
    return
  }
  Write-Output -NoEnumerate $InputObject
}

function Get-PropertyText {
  param(
    [Parameter(Mandatory = $true)][object]$InputObject,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return '' }
  return ([string]$property.Value).Trim()
}

function Get-ApiKeyAvailability {
  param([Parameter(Mandatory = $true)][object[]]$Items)

  $publishable = $false
  $secret = $false
  $serviceRole = $false
  $legacyAnonFallback = $false

  foreach ($item in $Items) {
    if ($null -eq $item) { continue }
    $name = (Get-PropertyText -InputObject $item -Name 'name').ToLowerInvariant()
    $type = (Get-PropertyText -InputObject $item -Name 'type').ToLowerInvariant()
    $apiKey = Get-PropertyText -InputObject $item -Name 'api_key'
    if ([string]::IsNullOrWhiteSpace($apiKey)) { continue }

    $publishablePrefix = $apiKey.StartsWith('sb_publishable_', [System.StringComparison]::Ordinal)
    $secretPrefix = $apiKey.StartsWith('sb_secret_', [System.StringComparison]::Ordinal)
    $legacyPrefix = $apiKey.StartsWith('eyJ', [System.StringComparison]::Ordinal)

    if ($publishablePrefix -or $name -eq 'publishable' -or $type -eq 'publishable') {
      $publishable = $true
    }
    if ($secretPrefix -or $name -eq 'secret' -or $type -eq 'secret') {
      $secret = $true
    }
    if ($name -eq 'service_role' -or $type -eq 'service_role') {
      $serviceRole = $true
    }
    if ($legacyPrefix -and ($name -eq 'anon' -or $type -eq 'anon')) {
      $legacyAnonFallback = $true
    }
  }

  return [ordered]@{
    publishable = [bool]$publishable
    secret = [bool]$secret
    service_role = [bool]$serviceRole
    'legacy-anon-fallback' = [bool]$legacyAnonFallback
    clientUsable = [bool]($publishable -or $legacyAnonFallback)
    serverUsable = [bool]($secret -or $serviceRole)
  }
}

function Write-FailureAudit {
  param(
    [Parameter(Mandatory = $true)][datetime]$Timestamp,
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [AllowNull()][string]$StandardError
  )

  if (-not (Test-Path -LiteralPath $AuditRoot)) {
    New-Item -ItemType Directory -Path $AuditRoot -Force | Out-Null
  }
  $auditPath = Join-Path $AuditRoot ($Timestamp.ToString('yyyyMMdd-HHmmss') + '-api-key-availability-failed.json')
  $record = [ordered]@{
    timestamp = $Timestamp.ToUniversalTime().ToString('o')
    agent = $AgentName
    commandKey = 'supabase-projects-api-keys'
    targetProjectRef = $TargetProjectRef
    inputParameters = [ordered]@{
      reveal = $true
      output = 'json'
      projectRef = $TargetProjectRef
      remoteWrite = $false
    }
    stderr = Protect-AuditText -Value $StandardError
    exitCode = $ExitCode
    sourceFile = $SourceFile
  }
  $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $auditPath -Encoding UTF8
  return $auditPath
}

$rawStdout = $null
$rawStderr = $null
$parsed = $null
$items = $null
$process = $null
$exitCode = 1
$startedAt = [datetime]::UtcNow

try {
  if ($SelfTest) {
    $fixtureJson = @'
[
  [{"name":"publishable","type":"publishable","api_key":"sb_publishable_fixture"}],
  [
    [{"name":"secret","type":"secret","api_key":"sb_secret_fixture"}],
    {"name":"service_role","type":"legacy","api_key":"eyJservicefixture.payload.signature"},
    [{"name":"anon","type":"legacy","api_key":"eyJanonfixture.payload.signature"}]
  ]
]
'@
    $parsed = ConvertFrom-Json -InputObject $fixtureJson
    $items = @(Expand-ApiKeyItems -InputObject $parsed)
    if ($items.Count -ne 4) { throw 'Self-test nested array expansion failed' }
    $availability = Get-ApiKeyAvailability -Items $items
    foreach ($field in @('publishable', 'secret', 'service_role', 'legacy-anon-fallback', 'clientUsable', 'serverUsable')) {
      if (-not [bool]$availability[$field]) { throw ('Self-test availability field failed: ' + $field) }
    }
    Write-Output 'TEAM_OS_4_API_KEY_AVAILABILITY_SELFTEST_OK items=4 nestedArrays=1 booleans=6 remoteCalls=0'
    return
  }

  if (-not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) {
    throw 'Fixed Node executable is unavailable'
  }
  if (-not (Test-Path -LiteralPath $NpxCli -PathType Leaf)) {
    throw 'Fixed npx-cli.js is unavailable'
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $NodeExecutable
  $startInfo.Arguments = ('"{0}" supabase projects api-keys --project-ref {1} --reveal --output json' -f $NpxCli, $TargetProjectRef)
  $startInfo.WorkingDirectory = $TeamOs4Root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Supabase CLI process did not start' }
  $rawStdout = $process.StandardOutput.ReadToEnd()
  $rawStderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  if ($exitCode -ne 0) { throw ('Supabase CLI exited with code ' + $exitCode) }

  $parsed = ConvertFrom-Json -InputObject $rawStdout
  $items = @(Expand-ApiKeyItems -InputObject $parsed)
  if ($items.Count -eq 0) { throw 'Supabase API key response contained no items' }
  $availability = Get-ApiKeyAvailability -Items $items
  Write-Output ($availability | ConvertTo-Json -Compress)
}
catch {
  $safeExitCode = if ($exitCode -ne 0) { $exitCode } else { 65 }
  $errorText = (($rawStderr, $_.Exception.Message) -join [Environment]::NewLine).Trim()
  $auditPath = Write-FailureAudit -Timestamp $startedAt -ExitCode $safeExitCode -StandardError $errorText
  Write-Error ('TEAM_OS_4_API_KEY_AVAILABILITY_FAILED audit=' + $auditPath)
  exit $safeExitCode
}
finally {
  if ($null -ne $process) { $process.Dispose() }
  $rawStdout = $null
  $rawStderr = $null
  $parsed = $null
  $items = $null
}
