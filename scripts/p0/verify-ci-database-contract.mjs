import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'ci-database-test-contract.json')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const contract = readJson(contractPath)
const clone = (value) => structuredClone(value)
const normalizeLf = (value) => value.replace(/\r\n?/g, '\n')
const sha256Lf = (path) => createHash('sha256').update(normalizeLf(readFileSync(path, 'utf8')), 'utf8').digest('hex')
const exactSet = (actual, expected) =>
  Array.isArray(actual) && actual.length === new Set(actual).size &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())

const expectedCategories = { database: 7, permission: 10, business: 9 }
const expectedCatalog = { publicTables: 103, publicRoutines: 162, publicViews: 11, storageBuckets: 1 }
const expectedRollbackFixtures = new Set([
  'supabase/tests/customer_import_behavior.sql',
  'supabase/tests/hardware_inventory_behavior.sql',
  'supabase/tests/hardware_shipping_chain_behavior.sql',
])
const allowedModes = new Set(['read_only', 'rollback_fixture'])
const forbiddenSqlBoundary = /(?:^|\W)(?:dblink_connect|postgres_fdw|postgresql_fdw|http_get|http_post|net\.http_)(?:\W|$)/i

function validate(candidate) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const counts = candidate.expectedCounts ?? {}
  const tests = candidate.tests ?? []
  const sourceRules = candidate.testSourceRules ?? {}
  const runtime = candidate.runtime ?? {}
  const boundary = candidate.acceptanceBoundary ?? {}

  check(candidate.schemaVersion === 1, 'schema version must be 1')
  check(candidate.manifestType === 'canwin-team-os-p0-ci-database-tests', 'manifest type drift')
  check(candidate.contractStatus === 'p0_candidate_requires_actual_github_run', 'contract status drift')

  check(candidate.baseline?.path === 'supabase/schema.sql', 'baseline path drift')
  check(candidate.baseline?.sha256Lf === sha256Lf(resolve(repoRoot, 'supabase', 'schema.sql')), 'baseline hash drift')
  check(candidate.migrations?.directory === 'supabase/migrations', 'migration directory drift')
  check(candidate.migrations?.sha256Manifest === 'docs/team-os-4.0/p0/migration-sha256-manifest.json', 'migration manifest path drift')
  check(candidate.migrations?.expectedCount === 69, 'migration expected count drift')

  const manifest = readJson(resolve(repoRoot, candidate.migrations?.sha256Manifest ?? 'missing'))
  const migrationFiles = readdirSync(resolve(repoRoot, candidate.migrations?.directory ?? 'missing'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  check(manifest.expectedCount === 69 && manifest.entries?.length === 69, 'migration manifest count drift')
  check(migrationFiles.length === 69, 'migration directory count drift')
  check(exactSet(migrationFiles, (manifest.entries ?? []).map((entry) => entry.file)), 'migration file set drift')
  for (const entry of manifest.entries ?? []) {
    check(entry.sha256 === sha256Lf(resolve(repoRoot, candidate.migrations.directory, entry.file)), `migration hash drift ${entry.file}`)
  }

  check(counts.database === expectedCategories.database, 'database expected count drift')
  check(counts.permission === expectedCategories.permission, 'permission expected count drift')
  check(counts.business === expectedCategories.business, 'business expected count drift')
  check(counts.total === 26, 'total expected count drift')
  check(counts.postInstallCatalogAssertions === 4, 'catalog assertion count drift')
  check(sourceRules.doKeywordSeparatedFromDollarQuote === true, 'DO dollar-quote separator rule drift')
  check(sourceRules.forbiddenUnseparatedToken === 'do$$', 'DO dollar-quote forbidden token drift')
  check(tests.length === counts.total, 'test entry count drift')
  check(exactSet(tests.map((entry) => entry.path), tests.map((entry) => entry.path)), 'duplicate test path')

  const discoveredTests = readdirSync(resolve(repoRoot, 'supabase', 'tests'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => `supabase/tests/${name}`)
  check(exactSet(tests.map((entry) => entry.path), discoveredTests), 'test file set drift')
  for (const [category, expected] of Object.entries(expectedCategories)) {
    check(tests.filter((entry) => entry.category === category).length === expected, `${category} category count drift`)
  }
  check(tests.every((entry) => Object.hasOwn(expectedCategories, entry.category)), 'unknown test category')
  check(tests.every((entry) => allowedModes.has(entry.executionMode)), 'unknown execution mode')
  check(exactSet(
    tests.filter((entry) => entry.executionMode === 'rollback_fixture').map((entry) => entry.path),
    [...expectedRollbackFixtures],
  ), 'rollback fixture set drift')

  for (const entry of tests) {
    const absolutePath = resolve(repoRoot, entry.path)
    const sql = normalizeLf(readFileSync(absolutePath, 'utf8'))
    check(entry.sha256Lf === sha256Lf(absolutePath), `test hash drift ${entry.path}`)
    check(!/^\s*\\/m.test(sql), `psql meta-command forbidden ${entry.path}`)
    check(!forbiddenSqlBoundary.test(sql), `remote SQL boundary forbidden ${entry.path}`)
    check(!/\bdo\$\$/i.test(sql), `DO keyword must be separated from dollar quote ${entry.path}`)
    if (entry.executionMode === 'rollback_fixture') {
      check(/^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(sql), `fixture must begin a transaction ${entry.path}`)
      check(/rollback\s*;\s*$/i.test(sql), `fixture must end with rollback ${entry.path}`)
    } else {
      check(!/^\s*(?:begin|commit|rollback)\s*;/im.test(sql), `read-only test contains transaction control ${entry.path}`)
    }
  }

  check(JSON.stringify(candidate.postInstallCatalog) === JSON.stringify(expectedCatalog), 'post-install catalog contract drift')
  const salesV3 = candidate.historicalChainExpectations?.salesOsV3 ?? {}
  check(salesV3.foundationMigration === 'supabase/migrations/20260713080000_add_access_control_foundation.sql', 'sales_os_v3 foundation migration drift')
  check(salesV3.foundationInsertedEnabled === false, 'sales_os_v3 foundation default drift')
  check(salesV3.finalEnableMigration === 'supabase/migrations/20260713200000_enable_sales_os_v3_pilot.sql', 'sales_os_v3 enable migration drift')
  check(salesV3.after69MigrationsEnabled === true, 'sales_os_v3 final-chain state drift')
  check(salesV3.operationalUsePausedOutsideDatabaseFlag === true, '3.0 operational pause boundary drift')
  const foundationSql = normalizeLf(readFileSync(resolve(repoRoot, salesV3.foundationMigration ?? 'missing'), 'utf8'))
  const pilotSql = normalizeLf(readFileSync(resolve(repoRoot, salesV3.finalEnableMigration ?? 'missing'), 'utf8'))
  const accessTestSql = normalizeLf(readFileSync(resolve(repoRoot, 'supabase/tests/access_control_foundation.sql'), 'utf8'))
  check(/'sales_os_v3'[\s\S]*false/i.test(foundationSql), 'foundation disabled insert evidence missing')
  check(/set\s+enabled\s*=\s*true/i.test(pilotSql), 'pilot enable evidence missing')
  check(accessTestSql.includes('20260713200000') && accessTestSql.includes("if not public.is_feature_enabled('CANWIN_TEAM', 'sales_os_v3')"), 'post-chain feature test semantics drift')
  check(!accessTestSql.includes('sales_os_v3 must default to disabled'), 'obsolete pre-pilot assertion returned')
  const qualification = candidate.historicalChainExpectations?.crmOpportunityQualification ?? {}
  check(qualification.foundationMigration === 'supabase/migrations/20260713090000_add_crm_core.sql', 'qualification foundation migration drift')
  check(exactSet(qualification.foundationAllowedGrades, ['A', 'B', 'C']), 'qualification foundation grades drift')
  check(qualification.foundationRequiredAdvisoryFacts === true, 'qualification foundation facts drift')
  check(qualification.finalMigration === 'supabase/migrations/20260716114824_add_package_price_and_relax_qualification.sql', 'qualification final migration drift')
  check(exactSet(qualification.after69AllowedGrades, ['A', 'B', 'C', 'D']), 'qualification final grades drift')
  check(qualification.after69RequiredAdvisoryFacts === false, 'qualification final advisory-facts drift')
  check(qualification.confirmedContactGateFunction === 'public.qualify_crm_lead(uuid)', 'qualification contact gate function drift')
  const qualificationFoundationSql = normalizeLf(readFileSync(resolve(repoRoot, qualification.foundationMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  const qualificationFinalSql = normalizeLf(readFileSync(resolve(repoRoot, qualification.finalMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  const crmCoreTestSql = normalizeLf(readFileSync(resolve(repoRoot, 'supabase/tests/crm_core.sql'), 'utf8'))
  check(qualificationFoundationSql.includes("selecttarget_gradein('a','b','c')") && qualificationFoundationSql.includes('coalesce(target_annual_fee_viable,false)'), 'qualification foundation strict-rule evidence missing')
  check(qualificationFinalSql.includes("selecttarget_gradein('a','b','c','d')"), 'qualification final grade-rule evidence missing')
  check(qualificationFinalSql.includes("lead_row.contactability_status<>'ready'") && qualificationFinalSql.includes('public.crm_lead_private'), 'qualification confirmed-contact gate evidence missing')
  check(crmCoreTestSql.includes('20260716114824') && crmCoreTestSql.includes("crm_is_valid_opportunity('D',false,false,null) is distinct from true"), 'post-chain qualification test semantics drift')
  check(crmCoreTestSql.includes("crm_is_valid_opportunity('E',true,true,null) is distinct from false"), 'post-chain invalid-grade test missing')
  check(!crmCoreTestSql.includes('Qualification rule skeleton failed'), 'obsolete strict qualification assertion returned')
  const leadsView = candidate.historicalChainExpectations?.crmLeadsVisible ?? {}
  const expectedLeadColumns = [
    'id', 'read_scope', 'store_name', 'contact_name', 'masked_phone', 'district_name',
    'business_type', 'source', 'created_at', 'next_action_at', 'stage', 'facts',
    'lead_status', 'owner_display_name', 'claimable', 'active_opportunity_id',
    'recycle_risk', 'recycle_due_at', 'recycle_paused', 'address',
  ]
  check(leadsView.finalMigration === 'supabase/migrations/20260717184206_add_quick_lead_address.sql', 'lead view final migration drift')
  check(JSON.stringify(leadsView.after69Columns) === JSON.stringify(expectedLeadColumns), 'lead view final column order drift')
  check(leadsView.addressHiddenFromOtherOwner === true, 'lead view address privacy drift')
  check(leadsView.rawPhoneColumnForbidden === true, 'lead view raw phone boundary drift')
  const finalLeadViewSql = normalizeLf(readFileSync(resolve(repoRoot, leadsView.finalMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  check(finalLeadViewSql.includes("casewhenl.owner_idisnotnullandl.owner_id<>auth.uid()thennullelsel.addressendaddress"), 'lead view address privacy evidence missing')
  check(crmCoreTestSql.includes('20260717184206') && crmCoreTestSql.includes("'recycle_paused',\n      'address']"), 'lead view final column test drift')
  check(!/array\[[^\]]*'recycle_paused'\s*\]\s*then/.test(crmCoreTestSql), 'obsolete pre-address column contract returned')
  const importAccess = candidate.historicalChainExpectations?.customerImportHistoryAccess ?? {}
  check(importAccess.foundationMigration === 'supabase/migrations/20260713150000_add_customer_import.sql', 'import access foundation migration drift')
  check(exactSet(importAccess.protectedTables, ['import_rows', 'import_created_entities']), 'import protected table set drift')
  check(exactSet(importAccess.clientRoles, ['anon', 'authenticated']), 'import client role set drift')
  check(importAccess.requiredRestrictiveAllGate === 'sales os v3 server gate', 'import restrictive gate drift')
  check(importAccess.permissiveClientWritePoliciesAllowed === false, 'import permissive write boundary drift')
  check(importAccess.directClientWritePrivilegesAllowed === false, 'import direct write privilege boundary drift')
  const importFoundationSql = normalizeLf(readFileSync(resolve(repoRoot, importAccess.foundationMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  const customerImportTestSql = normalizeLf(readFileSync(resolve(repoRoot, 'supabase/tests/customer_import.sql'), 'utf8'))
  check(importFoundationSql.includes('createpolicy"salesosv3servergate"onpublic.%iasrestrictiveforalltoauthenticated'), 'import restrictive gate source evidence missing')
  check(customerImportTestSql.includes("permissive='RESTRICTIVE'") && customerImportTestSql.includes("permissive='PERMISSIVE'"), 'import permissive/restrictive policy test drift')
  check(customerImportTestSql.includes("from(values('anon'),('authenticated'))") && customerImportTestSql.includes('has_table_privilege'), 'import effective client privilege test missing')
  check(!customerImportTestSql.includes("cmd in('INSERT','UPDATE','DELETE','ALL'))then raise exception'Import history client-mutable'"), 'obsolete import policy-presence assertion returned')
  check(runtime.engine === 'supabase-cli-local-postgres', 'runtime engine drift')
  check(runtime.supabaseCliVersion === '2.109.1', 'Supabase CLI pin drift')
  check(runtime.postgresMajor === 17, 'Postgres major drift')
  check(runtime.startup === 'supabase db start', 'database-only startup command drift')
  check(runtime.workdir === 'scripts/p0/ci-runtime', 'CI workdir drift')
  check(runtime.projectId === 'canwin-team-os-4-ci', 'CI project id drift')
  check(exactSet(runtime.allowedHosts, ['127.0.0.1', 'localhost']), 'allowed host boundary drift')
  check(runtime.allowedPort === 54322, 'allowed port drift')
  check(runtime.allowedDatabase === 'postgres', 'allowed database drift')
  check(runtime.allowedUser === 'postgres', 'allowed user drift')
  check(runtime.remoteConnectionsAllowed === false, 'remote connections must remain disabled')
  check(runtime.credentialMode === 'ephemeral-local-defaults', 'credential mode drift')
  check(runtime.testData === 'synthetic-only', 'test data boundary drift')
  check(runtime.cleanup === 'supabase stop --no-backup', 'cleanup contract drift')

  const config = normalizeLf(readFileSync(resolve(repoRoot, runtime.workdir ?? 'missing', 'supabase', 'config.toml'), 'utf8')).trim()
  const expectedConfig = [
    `project_id = "${runtime.projectId}"`,
    '',
    '[db]',
    `port = ${runtime.allowedPort}`,
    'shadow_port = 54320',
    `major_version = ${runtime.postgresMajor}`,
    '',
    '[db.seed]',
    'enabled = false',
  ].join('\n')
  check(config === expectedConfig, 'isolated Supabase config drift')

  const workflow = normalizeLf(readFileSync(resolve(repoRoot, '.github', 'workflows', 'p0-static.yml'), 'utf8'))
  check(workflow.includes('p0-database:'), 'isolated database CI job missing')
  check(workflow.includes('uses: supabase/setup-cli@v1'), 'official Supabase CLI setup action missing')
  check(workflow.includes(`version: ${runtime.supabaseCliVersion}`), 'workflow Supabase CLI pin drift')
  check(workflow.includes(`${runtime.startup} --workdir ${runtime.workdir} --yes`), 'database-only start step missing')
  check(!workflow.includes('--exclude'), 'full-stack container exclusion list is forbidden')
  check(workflow.includes(`--workdir ${runtime.workdir}`), 'isolated workdir missing from workflow')
  check(workflow.includes('node scripts/p0/run-ci-database-gates.mjs'), 'database gate runner missing from workflow')
  check(workflow.includes(`supabase stop --no-backup --workdir ${runtime.workdir} --yes`), 'destructive isolated cleanup step missing')
  check(!/\bsecrets\s*\./i.test(workflow), 'repository secret reference forbidden')
  check(!/--linked\b|supabase\.co|pooler/i.test(workflow), 'remote Supabase boundary forbidden')

  check(boundary.contractAccepted === true, 'CI database contract not accepted')
  check(boundary.actualGithubRunEvidence === 'pending', 'actual GitHub run must remain pending before evidence')
  check(boundary.g0OverallClaim === false, 'G0 must not be claimed')
  check(boundary.productionReadPerformed === false, 'production read must remain false')
  check(boundary.productionWritePerformed === false, 'production write must remain false')
  check(boundary.repositorySecretsRequired === false, 'repository secrets must not be required')

  const attempts = candidate.formalAttemptHistory ?? []
  check(attempts.length === 6, 'formal attempt history count drift')
  const failedAttempt = attempts[0] ?? {}
  check(failedAttempt.runId === '29680934378', 'failed run id drift')
  check(failedAttempt.jobId === '88176860842', 'failed job id drift')
  check(failedAttempt.headSha === '9d3b0d2a0c2569367dcfcfb0b41e696b4886d185', 'failed head SHA drift')
  check(failedAttempt.conclusion === 'failure', 'failed attempt conclusion drift')
  check(failedAttempt.failedStep === 'Start isolated local Postgres', 'failed step drift')
  check(failedAttempt.rootCauseCode === 'full_stack_exclusion_name_drift', 'failed root cause drift')
  check(failedAttempt.sqlTestsStarted === false, 'failed attempt must not claim SQL execution')
  check(failedAttempt.cleanupPassed === true, 'failed attempt cleanup evidence missing')
  check(failedAttempt.productionReadPerformed === false, 'failed attempt production read must remain false')
  check(failedAttempt.productionWritePerformed === false, 'failed attempt production write must remain false')
  check(failedAttempt.rerunOfFailedRun === false, 'failed run must not be represented as rerun')
  const testAttempt = attempts[1] ?? {}
  check(testAttempt.runId === '29681166438', 'test run id drift')
  check(testAttempt.jobId === '88177487346', 'test job id drift')
  check(testAttempt.headSha === 'd618e3293e751fa8821df8c38a9147644fd2f6c3', 'test run head SHA drift')
  check(testAttempt.conclusion === 'failure', 'test run conclusion drift')
  check(testAttempt.failedStep === 'Run database permission and business gates', 'test run failed step drift')
  check(testAttempt.rootCauseCode === 'post_chain_test_expected_pre_pilot_flag_state', 'test run root cause drift')
  check(testAttempt.databaseStartupPassed === true, 'database startup success evidence missing')
  check(testAttempt.baselinePassed === true, 'baseline success evidence missing')
  check(testAttempt.migrationsPassed === 69, 'migration success count drift')
  check(testAttempt.sqlTestsStarted === 1 && testAttempt.sqlTestsPassed === 0, 'test execution count drift')
  check(testAttempt.firstFailedTest === 'supabase/tests/access_control_foundation.sql', 'first failed test drift')
  check(testAttempt.cleanupPassed === true, 'test run cleanup evidence missing')
  check(testAttempt.productionReadPerformed === false, 'test run production read must remain false')
  check(testAttempt.productionWritePerformed === false, 'test run production write must remain false')
  check(testAttempt.rerunOfFailedRun === false, 'test run must be a new candidate, not a failed-run rerun')
  const qualificationAttempt = attempts[2] ?? {}
  check(qualificationAttempt.runId === '29681350750', 'qualification run id drift')
  check(qualificationAttempt.jobId === '88177979675', 'qualification job id drift')
  check(qualificationAttempt.headSha === 'b86b6415d4576bf3095382a2c52d65caf16f6bd4', 'qualification run head SHA drift')
  check(qualificationAttempt.conclusion === 'failure', 'qualification run conclusion drift')
  check(qualificationAttempt.failedStep === 'Run database permission and business gates', 'qualification run failed step drift')
  check(qualificationAttempt.rootCauseCode === 'post_chain_test_expected_pre_relaxation_qualification', 'qualification run root cause drift')
  check(qualificationAttempt.databaseStartupPassed === true, 'qualification run database startup evidence missing')
  check(qualificationAttempt.baselinePassed === true, 'qualification run baseline evidence missing')
  check(qualificationAttempt.migrationsPassed === 69, 'qualification run migration count drift')
  check(qualificationAttempt.sqlTestsStarted === 2 && qualificationAttempt.sqlTestsPassed === 1, 'qualification run test count drift')
  check(qualificationAttempt.firstFailedTest === 'supabase/tests/crm_core.sql', 'qualification first failed test drift')
  check(qualificationAttempt.cleanupPassed === true, 'qualification run cleanup evidence missing')
  check(qualificationAttempt.productionReadPerformed === false, 'qualification run production read must remain false')
  check(qualificationAttempt.productionWritePerformed === false, 'qualification run production write must remain false')
  check(qualificationAttempt.rerunOfFailedRun === false, 'qualification run must remain a new candidate')
  const addressAttempt = attempts[3] ?? {}
  check(addressAttempt.runId === '29681529637', 'address run id drift')
  check(addressAttempt.jobId === '88178429672', 'address job id drift')
  check(addressAttempt.headSha === '93383912475c643707c6896e9e630a0a96cdb351', 'address run head SHA drift')
  check(addressAttempt.conclusion === 'failure', 'address run conclusion drift')
  check(addressAttempt.failedStep === 'Run database permission and business gates', 'address run failed step drift')
  check(addressAttempt.rootCauseCode === 'post_chain_test_missing_final_address_column', 'address run root cause drift')
  check(addressAttempt.databaseStartupPassed === true, 'address run database startup evidence missing')
  check(addressAttempt.baselinePassed === true, 'address run baseline evidence missing')
  check(addressAttempt.migrationsPassed === 69, 'address run migration count drift')
  check(addressAttempt.sqlTestsStarted === 2 && addressAttempt.sqlTestsPassed === 1, 'address run test count drift')
  check(addressAttempt.firstFailedTest === 'supabase/tests/crm_core.sql', 'address first failed test drift')
  check(addressAttempt.qualificationAssertionPassed === true, 'address run prior qualification assertion evidence missing')
  check(addressAttempt.cleanupPassed === true, 'address run cleanup evidence missing')
  check(addressAttempt.productionReadPerformed === false, 'address run production read must remain false')
  check(addressAttempt.productionWritePerformed === false, 'address run production write must remain false')
  check(addressAttempt.rerunOfFailedRun === false, 'address run must remain a new candidate')
  const lexicalAttempt = attempts[4] ?? {}
  check(lexicalAttempt.runId === '29681693222', 'lexical run id drift')
  check(lexicalAttempt.jobId === '88178855663', 'lexical job id drift')
  check(lexicalAttempt.headSha === '5c4b42989716dac883f33f7062a49a5b06fb3c65', 'lexical run head SHA drift')
  check(lexicalAttempt.conclusion === 'failure', 'lexical run conclusion drift')
  check(lexicalAttempt.failedStep === 'Run database permission and business gates', 'lexical run failed step drift')
  check(lexicalAttempt.rootCauseCode === 'sql_keyword_dollar_quote_missing_separator', 'lexical run root cause drift')
  check(lexicalAttempt.databaseStartupPassed === true, 'lexical run database startup evidence missing')
  check(lexicalAttempt.baselinePassed === true, 'lexical run baseline evidence missing')
  check(lexicalAttempt.migrationsPassed === 69, 'lexical run migration count drift')
  check(lexicalAttempt.sqlTestsStarted === 3 && lexicalAttempt.sqlTestsPassed === 2, 'lexical run test count drift')
  check(lexicalAttempt.firstFailedTest === 'supabase/tests/customer_import.sql', 'lexical first failed test drift')
  check(lexicalAttempt.classwideAffectedFiles === 14 && lexicalAttempt.classwideOccurrences === 17, 'lexical classwide evidence drift')
  check(lexicalAttempt.cleanupPassed === true, 'lexical run cleanup evidence missing')
  check(lexicalAttempt.productionReadPerformed === false, 'lexical run production read must remain false')
  check(lexicalAttempt.productionWritePerformed === false, 'lexical run production write must remain false')
  check(lexicalAttempt.rerunOfFailedRun === false, 'lexical run must remain a new candidate')
  const importPolicyAttempt = attempts[5] ?? {}
  check(importPolicyAttempt.runId === '29681885277', 'import policy run id drift')
  check(importPolicyAttempt.jobId === '88179367094', 'import policy job id drift')
  check(importPolicyAttempt.headSha === 'acd6e18ddf1a0335940893e7801242e0833525b9', 'import policy run head SHA drift')
  check(importPolicyAttempt.conclusion === 'failure', 'import policy run conclusion drift')
  check(importPolicyAttempt.failedStep === 'Run database permission and business gates', 'import policy run failed step drift')
  check(importPolicyAttempt.rootCauseCode === 'restrictive_all_policy_misclassified_as_write_grant', 'import policy run root cause drift')
  check(importPolicyAttempt.databaseStartupPassed === true, 'import policy run database startup evidence missing')
  check(importPolicyAttempt.baselinePassed === true, 'import policy run baseline evidence missing')
  check(importPolicyAttempt.migrationsPassed === 69, 'import policy run migration count drift')
  check(importPolicyAttempt.sqlTestsStarted === 3 && importPolicyAttempt.sqlTestsPassed === 2, 'import policy run test count drift')
  check(importPolicyAttempt.firstFailedTest === 'supabase/tests/customer_import.sql', 'import policy first failed test drift')
  check(importPolicyAttempt.sqlParsingPassed === true, 'import policy run SQL parsing evidence missing')
  check(importPolicyAttempt.cleanupPassed === true, 'import policy run cleanup evidence missing')
  check(importPolicyAttempt.productionReadPerformed === false, 'import policy run production read must remain false')
  check(importPolicyAttempt.productionWritePerformed === false, 'import policy run production write must remain false')
  check(importPolicyAttempt.rerunOfFailedRun === false, 'import policy run must remain a new candidate')
  return failures
}

const failures = validate(contract)
const negativeCases = [
  ['schema version', (value) => { value.schemaVersion = 2 }],
  ['baseline hash', (value) => { value.baseline.sha256Lf = '0'.repeat(64) }],
  ['missing test', (value) => { value.tests.pop() }],
  ['test hash', (value) => { value.tests[0].sha256Lf = '0'.repeat(64) }],
  ['test category', (value) => { value.tests[0].category = 'unknown' }],
  ['fixture mode', (value) => { value.tests[0].executionMode = 'rollback_fixture' }],
  ['unseparated DO dollar quote rule', (value) => { value.testSourceRules.doKeywordSeparatedFromDollarQuote = false }],
  ['remote connection', (value) => { value.runtime.remoteConnectionsAllowed = true }],
  ['remote host', (value) => { value.runtime.allowedHosts = ['db.example.com'] }],
  ['remote port', (value) => { value.runtime.allowedPort = 6543 }],
  ['Postgres major', (value) => { value.runtime.postgresMajor = 15 }],
  ['CLI unpinned', (value) => { value.runtime.supabaseCliVersion = 'latest' }],
  ['full stack startup', (value) => { value.runtime.startup = 'supabase start' }],
  ['pre-pilot final state', (value) => { value.historicalChainExpectations.salesOsV3.after69MigrationsEnabled = false }],
  ['pre-relaxation final qualification', (value) => { value.historicalChainExpectations.crmOpportunityQualification.after69RequiredAdvisoryFacts = true }],
  ['pre-address lead view', (value) => { value.historicalChainExpectations.crmLeadsVisible.after69Columns.pop() }],
  ['import direct client write', (value) => { value.historicalChainExpectations.customerImportHistoryAccess.directClientWritePrivilegesAllowed = true }],
  ['repository secret', (value) => { value.acceptanceBoundary.repositorySecretsRequired = true }],
  ['production write', (value) => { value.acceptanceBoundary.productionWritePerformed = true }],
  ['G0 falsely claimed', (value) => { value.acceptanceBoundary.g0OverallClaim = true }],
  ['failed evidence erased', (value) => { value.formalAttemptHistory.pop() }],
]
let negativePassed = 0
for (const [name, mutate] of negativeCases) {
  const candidate = clone(contract)
  mutate(candidate)
  if (validate(candidate).length > 0) negativePassed += 1
  else failures.push(`negative self-test did not fail: ${name}`)
}

if (failures.length > 0) {
  console.error('P0_CI_DATABASE_CONTRACT_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `P0_CI_DATABASE_CONTRACT_OK baseline=1 migrations=69 tests=${contract.tests.length} database=7 permission=10 business=9 catalog=4 negative=${negativePassed}/${negativeCases.length} localOnly=true repositorySecrets=0 productionReads=0 productionWrites=0 actualGithubRun=pending`,
)
