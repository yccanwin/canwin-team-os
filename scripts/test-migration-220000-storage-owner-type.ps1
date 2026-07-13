$ErrorActionPreference = 'Stop'

$migrationPath = Join-Path $PSScriptRoot '..\supabase\migrations\20260713220000_security_integration_hardening.sql'
$source = Get-Content -LiteralPath $migrationPath -Raw -Encoding utf8

$unsafeOwnerComparison = [regex]::Matches(
  $source,
  'owner_id\s*=\s*auth\.uid\(\)(?!\s*::text)',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
).Count
$safeOwnerComparison = [regex]::Matches(
  $source,
  'owner_id\s*=\s*auth\.uid\(\)\s*::text',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
).Count

if ($unsafeOwnerComparison -ne 0) {
  throw "storage.objects owner_id still compares text directly with auth.uid() uuid"
}

if ($safeOwnerComparison -ne 3) {
  throw "expected 3 type-safe storage owner comparisons, found $safeOwnerComparison"
}

Write-Output 'PASS migration 220000 storage owner_id text comparisons'
