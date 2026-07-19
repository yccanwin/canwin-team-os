[CmdletBinding()]
param(
  [string]$CandidatePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
  $CandidatePath = Join-Path $repoRoot 'docs\team-os-4.0\p0\candidates\security-invoker-views.sql'
}
$candidateFullPath = (Resolve-Path -LiteralPath $CandidatePath).Path

$allowedViews = @(
  'finance_public_summary',
  'inventory_public_items',
  'assets_public'
)

function Remove-SqlComments {
  param([Parameter(Mandatory)][string]$Sql)

  $withoutBlock = [regex]::Replace(
    $Sql,
    '/\*.*?\*/',
    '',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  return [regex]::Replace(
    $withoutBlock,
    '(?m)--[^\r\n]*(?=\r?$)',
    ''
  )
}

function Assert-Matches {
  param(
    [Parameter(Mandatory)][string]$Text,
    [Parameter(Mandatory)][string]$Pattern,
    [Parameter(Mandatory)][string]$Message
  )

  if (-not [regex]::IsMatch($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Singleline)) {
    throw $Message
  }
}

function Test-CandidateSql {
  param([Parameter(Mandatory)][string]$Sql)

  $code = Remove-SqlComments -Sql $Sql
  $statements = @(
    $code -split ';' |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -ne '' }
  )

  if ($statements.Count -ne 13) {
    throw "Candidate must contain exactly 13 statements (4 policy alters, 3 views, 3 revokes, 3 grants); found $($statements.Count)."
  }

  $alterStatements = @($statements | Where-Object { $_ -match '(?is)^alter\s+policy\s+' })
  $createStatements = @($statements | Where-Object { $_ -match '(?is)^create\s+or\s+replace\s+view\s+' })
  $revokeStatements = @($statements | Where-Object { $_ -match '(?is)^revoke\s+' })
  $grantStatements = @($statements | Where-Object { $_ -match '(?is)^grant\s+' })
  if ($alterStatements.Count -ne 4 -or $createStatements.Count -ne 3 -or $revokeStatements.Count -ne 3 -or $grantStatements.Count -ne 3) {
    throw 'Candidate statement kinds are not exactly 4 ALTER POLICY, 3 CREATE VIEW, 3 REVOKE, and 3 GRANT.'
  }

  $requiredPolicyContracts = @(
    '(?is)^alter\s+policy\s+"finance roles read finance records"\s+on\s+public\.finance_records\s+using\s*\(\s*public\.has_access_role\(team_id\s*,\s*array\[''finance''\s*,\s*''admin''\]\)\s*\)$',
    '(?is)^alter\s+policy\s+"finance roles manage finance records"\s+on\s+public\.finance_records\s+using\s*\(\s*public\.has_access_role\(team_id\s*,\s*array\[''finance''\s*,\s*''admin''\]\)\s*\)\s+with\s+check\s*\(\s*public\.has_access_role\(team_id\s*,\s*array\[''finance''\s*,\s*''admin''\]\)\s*\)$',
    '(?is)^alter\s+policy\s+"inventory roles read inventory items"\s+on\s+public\.inventory_items\s+using\s*\(\s*public\.is_team_member\(team_id\)\s*\)$',
    '(?is)^alter\s+policy\s+"asset roles read assets"\s+on\s+public\.assets\s+using\s*\(\s*public\.is_team_member\(team_id\)\s*\)$'
  )
  foreach ($policyContract in $requiredPolicyContracts) {
    if (@($alterStatements | Where-Object { $_ -match $policyContract }).Count -ne 1) {
      throw "Candidate is missing or changed a frozen 4.0 policy contract: $policyContract"
    }
  }

  $declaredViews = @()
  foreach ($statement in $createStatements) {
    $viewMatch = [regex]::Match(
      $statement,
      '(?is)^create\s+or\s+replace\s+view\s+public\.(?<name>[a-z_][a-z0-9_]*)\s+'
    )
    if (-not $viewMatch.Success) {
      throw 'Every CREATE statement must be CREATE OR REPLACE VIEW public.<allowed_name>.'
    }
    $viewName = $viewMatch.Groups['name'].Value.ToLowerInvariant()
    if ($allowedViews -notcontains $viewName) {
      throw "Candidate declares an out-of-scope view: $viewName"
    }
    if ($declaredViews -contains $viewName) {
      throw "Candidate declares view more than once: $viewName"
    }
    $declaredViews += $viewName
    Assert-Matches -Text $statement -Pattern '\bwith\s*\(\s*security_invoker\s*=\s*true\s*\)\s*as\b' -Message "$viewName must set security_invoker = true."
    if ([regex]::IsMatch($statement, '(?is)\bselect\s+\*|,\s*\*|\w+\.\*')) {
      throw "$viewName must use an explicit projection; SELECT * is forbidden."
    }
  }

  foreach ($viewName in $allowedViews) {
    if ($declaredViews -notcontains $viewName) {
      throw "Candidate is missing required view: $viewName"
    }

    $expectedRevoke = "(?is)^revoke\s+all\s+privileges\s+on\s+public\.$([regex]::Escape($viewName))\s+from\s+public\s*,\s*anon\s*,\s*authenticated$"
    $expectedGrant = "(?is)^grant\s+select\s+on\s+public\.$([regex]::Escape($viewName))\s+to\s+authenticated$"
    if (@($revokeStatements | Where-Object { $_ -match $expectedRevoke }).Count -ne 1) {
      throw "$viewName must have exactly one explicit REVOKE from PUBLIC and anon."
    }
    if (@($grantStatements | Where-Object { $_ -match $expectedGrant }).Count -ne 1) {
      throw "$viewName must grant only SELECT to authenticated."
    }
  }

  $finance = @($createStatements | Where-Object { $_ -match '(?is)^create\s+or\s+replace\s+view\s+public\.finance_public_summary\b' })[0]
  Assert-Matches -Text $finance -Pattern "(?is)select\s+fr\.team_id\s*,\s*date_trunc\(\s*'month'\s*,\s*fr\.date\s*\)::date\s+as\s+month\s*,\s*fr\.record_type\s*,\s*fr\.category\s*,\s*sum\(\s*fr\.amount\s*\)\s+as\s+total_amount\s*,\s*count\(\s*\*\s*\)\s+as\s+record_count\s+from\s+public\.finance_records\s+as\s+fr\s+where\s+public\.has_access_role\(fr\.team_id\s*,\s*array\['finance'\s*,\s*'admin'\]\)\s+group\s+by\s+fr\.team_id\s*,\s*date_trunc\(\s*'month'\s*,\s*fr\.date\s*\)::date\s*,\s*fr\.record_type\s*,\s*fr\.category\s*$" -Message 'finance_public_summary source, projection, authorization, order, or aggregation contract changed.'

  $inventory = @($createStatements | Where-Object { $_ -match '(?is)^create\s+or\s+replace\s+view\s+public\.inventory_public_items\b' })[0]
  Assert-Matches -Text $inventory -Pattern '(?is)select\s+ii\.id\s*,\s*ii\.team_id\s*,\s*ii\.name\s*,\s*ii\.sku\s*,\s*ii\.quantity\s*,\s*ii\.unit\s*,\s*ii\.public_status\s*,\s*ii\.low_stock_threshold\s*,\s*ii\.updated_at\s+from\s+public\.inventory_items\s+as\s+ii\s*$' -Message 'inventory_public_items source, projection, or column order contract changed.'

  $assets = @($createStatements | Where-Object { $_ -match '(?is)^create\s+or\s+replace\s+view\s+public\.assets_public\b' })[0]
  Assert-Matches -Text $assets -Pattern '(?is)select\s+a\.id\s*,\s*a\.team_id\s*,\s*a\.name\s*,\s*a\.category\s*,\s*a\.description\s*,\s*a\.purchase_date\s*,\s*a\.status\s*,\s*a\.image_url\s*,\s*a\.created_by\s*,\s*a\.created_at\s*,\s*a\.updated_at\s+from\s+public\.assets\s+as\s+a\s*$' -Message 'assets_public source, projection, or column order contract changed.'

  foreach ($statement in $statements) {
    $isAllowed =
      $requiredPolicyContracts | Where-Object { $statement -match $_ } | Select-Object -First 1
    $isAllowed = [bool]$isAllowed -or
      $statement -match '(?is)^create\s+or\s+replace\s+view\s+public\.(finance_public_summary|inventory_public_items|assets_public)\b' -or
      $statement -match '(?is)^revoke\s+all\s+privileges\s+on\s+public\.(finance_public_summary|inventory_public_items|assets_public)\s+from\s+public\s*,\s*anon\s*,\s*authenticated$' -or
      $statement -match '(?is)^grant\s+select\s+on\s+public\.(finance_public_summary|inventory_public_items|assets_public)\s+to\s+authenticated$'
    if (-not $isAllowed) {
      throw "Candidate contains a forbidden or unrecognized SQL statement: $($statement.Substring(0, [Math]::Min(80, $statement.Length)))"
    }
  }
}

function Assert-FrontendContract {
  $contracts = @(
    @{
      Path = 'src\services\finance.ts'
      Markers = @(
        '\.from\(\s*[''"]finance_public_summary[''"]\s*\)',
        '\.select\(\s*[''"]month, record_type, category, total_amount[''"]\s*\)',
        '\.eq\(\s*[''"]team_id[''"]'
      )
    },
    @{
      Path = 'src\services\inventory.ts'
      Markers = @(
        '\.from\(\s*[''"]inventory_public_items[''"]\s*\)',
        '\.select\(\s*[''"]id, name, sku, quantity, unit, public_status, low_stock_threshold, updated_at[''"]\s*\)',
        '\.eq\(\s*[''"]team_id[''"]'
      )
    },
    @{
      Path = 'src\services\assets.ts'
      Markers = @(
        'ASSET_PUBLIC_SELECT\s*=\s*[''"]id, name, category, description, purchase_date, status, image_url, created_by, created_at, updated_at[''"]',
        '\.from\(\s*[''"]assets_public[''"]\s*\)',
        '\.select\(\s*ASSET_PUBLIC_SELECT\s*\)',
        '\.eq\(\s*[''"]team_id[''"]'
      )
    }
  )

  foreach ($contract in $contracts) {
    $fullPath = Join-Path $repoRoot $contract.Path
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      throw "Frontend dependency file is missing: $($contract.Path)"
    }
    $content = Get-Content -LiteralPath $fullPath -Raw -Encoding UTF8
    foreach ($marker in $contract.Markers) {
      if (-not [regex]::IsMatch($content, $marker, [System.Text.RegularExpressions.RegexOptions]::Singleline)) {
        throw "Frontend dependency marker is missing from $($contract.Path): $marker"
      }
    }
  }
}

$expectedCandidateRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'docs\team-os-4.0\p0\candidates'))
if (-not $candidateFullPath.StartsWith($expectedCandidateRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Candidate must remain under docs/team-os-4.0/p0/candidates: $candidateFullPath"
}

$candidateSql = Get-Content -LiteralPath $candidateFullPath -Raw -Encoding UTF8

# Pure in-memory newline tests prove line comments are removed consistently on
# Windows and Unix checkouts, including comments whose semicolons must not be
# interpreted as SQL statement separators.
$lfCandidateSql = [regex]::Replace($candidateSql, "`r`n?", "`n")
$crlfCandidateSql = $lfCandidateSql.Replace("`n", "`r`n")
$mixedCandidateSql = $lfCandidateSql.Replace(
  "`ncreate or replace view public.inventory_public_items",
  "`r`ncreate or replace view public.inventory_public_items"
)
$commentSemicolonSql = "-- regression comment contains ; a statement separator`r`n$crlfCandidateSql"

if (-not $mixedCandidateSql.Contains("`r`n") -or -not [regex]::IsMatch($mixedCandidateSql, '(?<!\r)\n')) {
  throw 'Validator self-test fixture is not mixed LF/CRLF text.'
}

$commentRegressionCases = @(
  @{ Name = 'lf'; Text = $lfCandidateSql },
  @{ Name = 'crlf'; Text = $crlfCandidateSql },
  @{ Name = 'mixed'; Text = $mixedCandidateSql },
  @{ Name = 'comment-semicolon'; Text = $commentSemicolonSql }
)

foreach ($case in $commentRegressionCases) {
  Test-CandidateSql -Sql $case.Text
}

# Pure in-memory mutation tests prove the validator rejects scope and contract drift.
$negativeCases = @(
  @{ Name = 'out-of-scope-view'; Text = $candidateSql.Replace('public.assets_public', 'public.assets_private') },
  @{ Name = 'missing-invoker'; Text = $candidateSql.Replace('security_invoker = true', 'security_invoker = false') },
  @{ Name = 'data-write'; Text = $candidateSql + "`nupdate public.assets set status = 'x';" },
  @{ Name = 'broad-grant'; Text = $candidateSql.Replace('grant select on public.assets_public to authenticated;', 'grant select on public.assets_public to anon;') },
  @{ Name = 'legacy-finance-role'; Text = $candidateSql.Replace("public.has_access_role(team_id, array['finance', 'admin'])", "public.has_role(team_id, array['finance', 'admin'])") },
  @{ Name = 'projection-drift'; Text = $candidateSql.Replace('  a.updated_at', '  a.amount') }
)

Test-CandidateSql -Sql $candidateSql
foreach ($case in $negativeCases) {
  $rejected = $false
  try {
    Test-CandidateSql -Sql $case.Text
  }
  catch {
    $rejected = $true
  }
  if (-not $rejected) {
    throw "Validator self-test failed to reject case: $($case.Name)"
  }
}

Assert-FrontendContract

$migrationStatus = & git -C $repoRoot status --porcelain=v1 --untracked-files=all -- supabase/migrations 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect historical migration changes: $($migrationStatus -join [Environment]::NewLine)"
}
if (@($migrationStatus).Count -gt 0) {
  throw "Historical migrations have worktree changes; candidate validation stops:`n$($migrationStatus -join [Environment]::NewLine)"
}

Write-Output "P0_SECURITY_INVOKER_COMMENT_REGRESSION_OK cases=$($commentRegressionCases.Count) formats=lf,crlf,mixed,comment-semicolon"
Write-Output "P0_SECURITY_INVOKER_CANDIDATE_STATIC_SELFTEST_OK cases=$($commentRegressionCases.Count + $negativeCases.Count) positive=$($commentRegressionCases.Count) negative=$($negativeCases.Count)"
Write-Output 'P0_SECURITY_INVOKER_CANDIDATE_OK views=3 policies=4 callers=3 migrations=clean database_calls=0'
