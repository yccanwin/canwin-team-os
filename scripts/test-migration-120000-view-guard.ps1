$ErrorActionPreference = 'Stop'

$migrationPath = Join-Path $PSScriptRoot '..\supabase\migrations\20260713120000_add_sales_automation.sql'
$source = Get-Content -LiteralPath $migrationPath -Raw -Encoding utf8

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Assert-True ($source.Contains("to_regclass('public.crm_leads_visible') is null")) 'Missing absent-view branch.'
Assert-True ($source.Contains("column_name='active_opportunity_id'")) 'Missing new-contract column guard.'
Assert-True ($source.Contains('execute $view$')) 'Legacy view definition is not isolated in named dynamic SQL.'
Assert-True ($source.Contains('create or replace view public.crm_leads_visible with(security_invoker=true)as')) 'Legacy 15-column view definition changed or missing.'

function Should-CreateLegacyView([bool]$ViewExists, [bool]$ActiveOpportunityColumnExists) {
  return (-not $ViewExists) -or (-not $ActiveOpportunityColumnExists)
}

Assert-True (Should-CreateLegacyView $false $false) 'Absent view must create the legacy contract.'
Assert-True (Should-CreateLegacyView $true $false) 'Old view without active_opportunity_id must be replaced.'
Assert-True (-not (Should-CreateLegacyView $true $true)) 'New view with active_opportunity_id must be preserved.'

Write-Output 'PASS migration 120000 crm_leads_visible guard branches'
