[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$SqlPath = '',

  [switch]$SelfTest,

  [switch]$LiveTableEvidence,

  [switch]$LiveRoutineEvidence
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SqlPath)) {
  $SqlPath = Join-Path -Path $PSScriptRoot -ChildPath 'catalog-snapshot.sql'
}

function Get-SqlSafetyErrors {
  param(
    [Parameter(Mandatory)]
    [string]$SqlText,

    [bool]$RequireSnapshotContract = $true
  )

  $errors = [System.Collections.Generic.List[string]]::new()

  if ([string]::IsNullOrWhiteSpace($SqlText)) {
    $errors.Add('SQL file is empty.')
    return $errors.ToArray()
  }

  if ([regex]::IsMatch($SqlText, '(?m)^\s*\\')) {
    $errors.Add('psql meta-commands are not allowed in the snapshot SQL.')
  }

  $normalized = [regex]::Replace(
    $SqlText,
    '/\*.*?\*/',
    ' ',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  $normalized = [regex]::Replace($normalized, '(?m)--[^\r\n]*', ' ')
  $normalized = [regex]::Replace($normalized, "'(?:''|[^'])*'", ' ')

  $forbiddenPatterns = [ordered]@{
    'data mutation' = '\b(insert|update|delete|merge)\b'
    'schema mutation' = '\b(alter|drop|create|truncate)\b'
    'privilege mutation' = '\b(grant|revoke)\b'
    'procedural execution' = '\b(copy|call|do|execute)\b'
    'catalog annotation' = '\bcomment\b|\bsecurity\s+label\b'
    'maintenance mutation' = '\b(refresh|vacuum|analyze|reindex|cluster)\b'
    'session mutation' = '\b(set|reset)\b'
    'select-into mutation' = '\binto\b'
    'known mutating function' = '\b(nextval|setval|pg_advisory_lock|pg_advisory_xact_lock|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|pg_reload_conf|dblink_exec)\s*\('
  }

  foreach ($entry in $forbiddenPatterns.GetEnumerator()) {
    if ([regex]::IsMatch($normalized, $entry.Value, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
      $errors.Add("Forbidden $($entry.Key) token detected.")
    }
  }

  if ([regex]::IsMatch($normalized, '\b(public|auth|storage)\s*\.', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    $errors.Add('Direct business-schema relation access is not allowed.')
  }

  $qualifiedSources = [regex]::Matches(
    $normalized,
    '\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  foreach ($sourceMatch in $qualifiedSources) {
    $source = $sourceMatch.Groups[1].Value
    if ($source -notmatch '^(pg_catalog|information_schema|supabase_migrations)\.') {
      $errors.Add("Unapproved qualified source detected: $source")
    }
  }

  $statements = @(
    $normalized -split ';' |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
  foreach ($statement in $statements) {
    if ($statement -notmatch '^(?i:select|with)\b') {
      $preview = $statement.Substring(0, [Math]::Min(40, $statement.Length))
      $errors.Add("Statement is not SELECT/WITH: $preview")
    }
  }

  if ($RequireSnapshotContract) {
    $requiredMarkers = @(
      'summary_counts',
      'relations',
      'relation_acl',
      'routines',
      'routine_acl',
      'policies',
      'trigger_objects',
      'trigger_event_rows',
      'indexes',
      'foreign_key_dependencies',
      'view_dependencies',
      'routine_relation_dependencies',
      'trigger_function_dependencies',
      'migration_versions'
    )
    foreach ($marker in $requiredMarkers) {
      if ($SqlText -notmatch "'$([regex]::Escape($marker))'") {
        $errors.Add("Required snapshot section is missing: $marker")
      }
    }

    $requiredCatalogSources = @(
      'pg_catalog.pg_class',
      'pg_catalog.pg_proc',
      'pg_catalog.pg_policy',
      'pg_catalog.pg_trigger',
      'pg_catalog.pg_index',
      'information_schema.triggers',
      'supabase_migrations.schema_migrations',
      'reltuples'
    )
    foreach ($source in $requiredCatalogSources) {
      if ($SqlText -notmatch [regex]::Escape($source)) {
        $errors.Add("Required catalog evidence is missing: $source")
      }
    }
  }

  return $errors.ToArray()
}

if ($SelfTest) {
  $cases = @(
    @{ Name = 'catalog select'; Valid = $true; Sql = "select count(*) from pg_catalog.pg_class;" },
    @{ Name = 'business relation'; Valid = $false; Sql = "select id from public.profiles;" },
    @{ Name = 'data mutation'; Valid = $false; Sql = "insert into x values (1);" },
    @{ Name = 'mutating cte'; Valid = $false; Sql = "with changed as (delete from x returning *) select * from changed;" },
    @{ Name = 'schema mutation'; Valid = $false; Sql = "alter table x add column y int;" },
    @{ Name = 'privilege mutation'; Valid = $false; Sql = "grant select on x to y;" },
    @{ Name = 'select into'; Valid = $false; Sql = "select 1 into new_table;" },
    @{ Name = 'mutating function'; Valid = $false; Sql = "select nextval('x');" },
    @{ Name = 'meta command'; Valid = $false; Sql = "\copy x to 'x.csv'" }
  )

  foreach ($case in $cases) {
    $caseErrors = @(Get-SqlSafetyErrors -SqlText $case.Sql -RequireSnapshotContract $false)
    $actualValid = $caseErrors.Count -eq 0
    if ($actualValid -ne $case.Valid) {
      throw "Static validator self-test failed: $($case.Name)"
    }
  }

  Write-Output "P0_CATALOG_SNAPSHOT_STATIC_SELFTEST_OK cases=$($cases.Count)"
}

$resolvedSqlPath = (Resolve-Path -LiteralPath $SqlPath).Path
$sqlText = Get-Content -Raw -LiteralPath $resolvedSqlPath -Encoding UTF8
if ($LiveTableEvidence -and $LiveRoutineEvidence) {
  Write-Error 'Choose only one live-evidence mode.'
  exit 1
}

$safetyErrors = @(
  Get-SqlSafetyErrors -SqlText $sqlText -RequireSnapshotContract (-not ($LiveTableEvidence -or $LiveRoutineEvidence))
)

if ($LiveTableEvidence) {
  $requiredLiveEvidenceMarkers = @(
    "'production-readonly-public-table-catalog'",
    "'businessRowsRead', false",
    "'writePerformed', false",
    "'effectiveClientGrants'",
    "'policies'",
    "'triggers'",
    "'indexes'",
    "'outgoingForeignKeys'",
    "'incomingForeignKeys'",
    "'dependentViews'",
    "'catalogRoutineDependencies'"
  )
  foreach ($marker in $requiredLiveEvidenceMarkers) {
    if (-not $sqlText.Contains($marker)) {
      $safetyErrors += "Required live-table evidence marker is missing: $marker"
    }
  }
}

if ($LiveRoutineEvidence) {
  $requiredLiveRoutineMarkers = @(
    "'production-readonly-public-routine-catalog'",
    "'businessRowsRead', false",
    "'writePerformed', false",
    "'functionBodiesReturned', false",
    "'effectiveExecuteRoles'",
    "'triggerUses'",
    "'catalogRelationDependencies'",
    "'definitionEvidence'",
    "'candidateClassification'"
  )
  foreach ($marker in $requiredLiveRoutineMarkers) {
    if (-not $sqlText.Contains($marker)) {
      $safetyErrors += "Required live-routine evidence marker is missing: $marker"
    }
  }
}

if ($safetyErrors.Count -gt 0) {
  foreach ($safetyError in $safetyErrors) {
    Write-Error $safetyError
  }
  exit 1
}

$normalizedForCount = [regex]::Replace($sqlText, '(?m)--[^\r\n]*', ' ')
$statementCount = @($normalizedForCount -split ';' | Where-Object { $_.Trim() }).Count
Write-Output "P0_CATALOG_SNAPSHOT_READONLY_OK statements=$statementCount path=$resolvedSqlPath"
