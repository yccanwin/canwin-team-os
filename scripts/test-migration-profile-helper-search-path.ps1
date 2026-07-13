$ErrorActionPreference = 'Stop'

$migrationPath = Join-Path $PSScriptRoot '..\supabase\migrations\20260714030000_restore_legacy_profile_security_functions.sql'
$source = Get-Content -LiteralPath $migrationPath -Raw -Encoding utf8

$definitions = [regex]::Matches(
  $source,
  'create\s+or\s+replace\s+function\s+public\.(current_profile_role|is_team_member)\s*\(',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
).Count
$qualifiedProfiles = [regex]::Matches(
  $source,
  'from\s+public\.profiles\s+p',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
).Count
$emptySearchPaths = [regex]::Matches(
  $source,
  "set\s+search_path\s*=\s*''",
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
).Count
$unqualifiedProfiles = [regex]::Matches(
  $source,
  '(?<!\.)\bfrom\s+profiles\b',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
).Count

if ($definitions -ne 2) { throw "expected 2 profile helper definitions, found $definitions" }
if ($qualifiedProfiles -ne 2) { throw "expected 2 qualified public.profiles references, found $qualifiedProfiles" }
if ($emptySearchPaths -ne 2) { throw "expected 2 empty search_path declarations, found $emptySearchPaths" }
if ($unqualifiedProfiles -ne 0) { throw 'unqualified profiles reference remains in profile helper hotfix' }

Write-Output 'PASS profile helper empty-search-path qualification'
