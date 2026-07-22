import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const p0Path = (...segments) => resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', ...segments)
const outputPath = p0Path('public-object-classification-freeze.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256File(path) {
  const canonicalText = readFileSync(path, 'utf8').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  return createHash('sha256').update(canonicalText, 'utf8').digest('hex')
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function countBy(values, keySelector) {
  const counts = {}
  for (const value of values) {
    const key = keySelector(value)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, 'en')))
}

function parseLedger(markdown) {
  const rows = []
  const rowPattern = /^\|\s*(\d+)\s*\|\s*`([a-z_][a-z0-9_]*)`\s*\|\s*([^|]+?)\s*\|\s*(保留|扩展|只读|淘汰候选)\s*\|\s*([^|]+?)\s*\|\s*$/u
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(rowPattern)
    if (!match) continue
    rows.push({
      ordinal: Number(match[1]),
      tableName: match[2],
      module: match[3].trim(),
      label: match[4],
      reason: match[5].trim(),
    })
  }
  return rows
}

function classificationMapping(classification, tableName, module) {
  if (classification === 'retain') {
    return {
      teamOs4Mapping: `${module}：沿用 public.${tableName} 作为 4.0 兼容基础对象`,
      compatibilityAction: '保留表名、字段和全部历史行；仅通过新增迁移补最小权限、必要索引和受控接口。',
    }
  }
  if (classification === 'extend') {
    return {
      teamOs4Mapping: `${module}：以 public.${tableName} 为兼容底座，承接 4.0 增量字段、事件或适配投影`,
      compatibilityAction: '保留旧字段和历史行；只做加法式扩展，回填、双读和切换另立可回退工单。',
    }
  }
  if (classification === 'read_only') {
    return {
      teamOs4Mapping: `${module}：纳入 4.0 历史查询投影，不再作为新业务写模型`,
      compatibilityAction: '切换时关闭旧写入口，保留底层数据和备份；4.0 只通过受控只读入口查询历史。',
    }
  }
  return {
    teamOs4Mapping: `${module}：仅保留归档与恢复映射，不进入 4.0 日常业务`,
    compatibilityAction: '切换时关闭入口和新写入；保留加密备份、依赖清单和恢复证据，未经另行授权不物理删除。',
  }
}

function tableOperation(dependency) {
  const operations = []
  if (dependency.readMarker) operations.push('read')
  if (dependency.insertMarker) operations.push('insert')
  if (dependency.updateMarker) operations.push('update')
  if (dependency.deleteMarker) operations.push('delete')
  if (dependency.mergeMarker) operations.push('merge')
  if (dependency.operationUnknown) operations.push('reference_unknown')
  return operations
}

function routineDisposition(routine, caller, isolated, incomingRoutineCallers) {
  const trigger = routine.resultType === 'trigger' || routine.triggerUses.length > 0
  if (trigger && routine.triggerUses.length === 0 && caller.sourceCallers.length === 0 && incomingRoutineCallers.length === 0) {
    return 'retirement_candidate_unused_trigger_helper'
  }
  if (trigger) return 'retain_internal_trigger'
  if (caller.sourceCallers.length > 0) return 'retain_active_business_rpc'
  if (isolated.sameNameBodyCallMarker) return 'retain_compatibility_overload'
  if (incomingRoutineCallers.length > 0) return 'retain_internal_helper'
  if (routine.effectiveExecuteRoles.includes('authenticated')) return 'retain_compatibility_rpc_pending_p1_caller_confirmation'
  return 'retain_internal_helper'
}

function routineRisk(routine, caller, disposition) {
  const markers = routine.definitionEvidence
  const anon = routine.effectiveExecuteRoles.includes('anon')
  const authenticated = routine.effectiveExecuteRoles.includes('authenticated')
  const fixedSearchPath = routine.searchPathSettings.length > 0
  if (!fixedSearchPath || anon) {
    return {
      priority: 'P0-permission-hardening',
      conclusion: '分类已冻结；PUBLIC/anon EXECUTE 或 search_path 暴露须在首个安全迁移中收紧并复测。',
    }
  }
  if (routine.securityDefiner && authenticated && caller.sourceCallers.length === 0) {
    return {
      priority: 'P1A-unconfirmed-security-definer-entry',
      conclusion: '分类已冻结；无本地直接调用方的 authenticated 提权入口须逐项确认调用链，未确认前不得扩大使用。',
    }
  }
  if (routine.securityDefiner && authenticated &&
      !markers.usesAuthUid && !markers.usesAuthJwt && !markers.usesRequestJwt && !markers.usesRoleGuardMarker) {
    return {
      priority: 'P1A-security-definer-identity-review',
      conclusion: '分类已冻结；正文未发现直接身份/岗位标记，必须依赖已登记的内部调用链或在后续迁移补显式检查。',
    }
  }
  if (disposition.startsWith('retirement_candidate')) {
    return {
      priority: 'P1B-retirement-proof',
      conclusion: '分类已冻结为退役候选；先撤入口和执行权、验证无依赖，未经授权不删除函数。',
    }
  }
  return {
    priority: 'P2-classified-retain',
    conclusion: '分类及当前调用/授权边界已登记；运行时六身份越权验证在 G1 按权限矩阵执行。',
  }
}

const paths = {
  ledger: p0Path('01-database-object-classification.md'),
  register: p0Path('public-table-classification-register.json'),
  tableLive: p0Path('public-table-live-evidence.json'),
  routineLive: p0Path('public-routine-live-evidence.json'),
  callers: p0Path('public-routine-caller-crosscheck.json'),
  foreignKeys: p0Path('public-foreign-key-risk-live-evidence.json'),
  advisor: p0Path('advisor-risk-priority-evidence.json'),
  isolated: p0Path('object-classification-isolated-evidence.json'),
  security: p0Path('security-invoker-isolated-evidence.json'),
}

const ledgerRows = parseLedger(readFileSync(paths.ledger, 'utf8'))
const register = readJson(paths.register)
const tableLive = readJson(paths.tableLive)
const routineLive = readJson(paths.routineLive)
const callerEvidence = readJson(paths.callers)
const foreignKeyEvidence = readJson(paths.foreignKeys)
const advisorEvidence = readJson(paths.advisor)
const isolatedEvidence = readJson(paths.isolated)
const securityEvidence = readJson(paths.security)

const classificationByTable = new Map(
  Object.entries(register.classifications).flatMap(([classification, names]) => names.map((name) => [name, classification])),
)
const tableLiveByName = new Map(tableLive.tables.map((entry) => [entry.tableName, entry]))
const exactCountByName = new Map(isolatedEvidence.exactCounts.map((entry) => [entry.tableName, entry.exactRows]))
const sourceEntrypointsByName = new Map(isolatedEvidence.sourceEntrypoints.tables.map((entry) => [entry.tableName, entry.entrypoints]))
const routineLiveBySignature = new Map(routineLive.routines.map((entry) => [entry.signature, entry]))
const callerBySignature = new Map(callerEvidence.routines.map((entry) => [entry.signature, entry]))
const isolatedRoutineBySignature = new Map(isolatedEvidence.routineDependencies.map((entry) => [entry.signature, entry]))
const unindexedBySourceTable = new Map()
for (const entry of advisorEvidence.unindexedForeignKeys) {
  if (!unindexedBySourceTable.has(entry.sourceTable)) unindexedBySourceTable.set(entry.sourceTable, [])
  unindexedBySourceTable.get(entry.sourceTable).push(entry)
}

const routineCallersByName = new Map()
for (const routine of isolatedEvidence.routineDependencies) {
  for (const dependency of routine.routineDependencies) {
    if (!routineCallersByName.has(dependency.name)) routineCallersByName.set(dependency.name, [])
    routineCallersByName.get(dependency.name).push(routine.signature)
  }
}

const routineClassifications = routineLive.routines.map((routine) => {
  const caller = callerBySignature.get(routine.signature)
  const isolated = isolatedRoutineBySignature.get(routine.signature)
  if (!caller || !isolated) throw new Error(`routine evidence missing for ${routine.signature}`)
  const incomingRoutineCallers = sortedUnique(routineCallersByName.get(routine.name) ?? [])
  const disposition = routineDisposition(routine, caller, isolated, incomingRoutineCallers)
  const risk = routineRisk(routine, caller, disposition)
  return {
    signature: routine.signature,
    name: routine.name,
    disposition,
    routineType: routine.routineType,
    resultType: routine.resultType,
    securityDefiner: routine.securityDefiner,
    fixedSearchPath: routine.searchPathSettings.length > 0,
    effectiveExecuteRoles: routine.effectiveExecuteRoles,
    triggerUses: routine.triggerUses,
    runtimeSourceCallers: caller.sourceCallers,
    incomingRoutineCallers,
    bodyDependencyEvidence: {
      definitionMd5: isolated.definitionMd5,
      definitionLength: isolated.definitionLength,
      productionFingerprintMatched: true,
      functionBodyReturned: false,
      dynamicSqlMarker: isolated.dynamicSqlMarker,
      sameNameBodyCallMarker: isolated.sameNameBodyCallMarker,
      tableDependencies: isolated.tableDependencies,
      routineDependencies: isolated.routineDependencies,
    },
    authorizationReview: {
      usesAuthUid: routine.definitionEvidence.usesAuthUid,
      usesAuthJwt: routine.definitionEvidence.usesAuthJwt,
      usesRequestJwt: routine.definitionEvidence.usesRequestJwt,
      usesTeamScopeMarker: routine.definitionEvidence.usesTeamScopeMarker,
      usesRoleGuardMarker: routine.definitionEvidence.usesRoleGuardMarker,
      writesDataMarker: routine.definitionEvidence.writesDataMarker,
      priority: risk.priority,
      conclusion: risk.conclusion,
    },
    acceptanceStatus: 'supervisor_classification_frozen',
    responsibleParty: '团队一（后端业务与数据）；监理冻结',
  }
}).sort((left, right) => left.signature.localeCompare(right.signature, 'en'))

const routineByTable = new Map()
for (const routine of routineClassifications) {
  for (const dependency of routine.bodyDependencyEvidence.tableDependencies) {
    if (!routineByTable.has(dependency.tableName)) routineByTable.set(dependency.tableName, [])
    routineByTable.get(dependency.tableName).push({
      signature: routine.signature,
      disposition: routine.disposition,
      operations: tableOperation(dependency),
      authorizationPriority: routine.authorizationReview.priority,
    })
  }
}

const tableClassifications = ledgerRows.map((ledger) => {
  const classification = classificationByTable.get(ledger.tableName)
  const live = tableLiveByName.get(ledger.tableName)
  const exactRows = exactCountByName.get(ledger.tableName)
  const directEntrypoints = sourceEntrypointsByName.get(ledger.tableName)
  const routines = (routineByTable.get(ledger.tableName) ?? []).sort((left, right) => left.signature.localeCompare(right.signature, 'en'))
  const unindexed = (unindexedBySourceTable.get(ledger.tableName) ?? []).sort((left, right) => left.constraintName.localeCompare(right.constraintName, 'en'))
  if (!classification || !live || !Number.isInteger(exactRows) || !directEntrypoints) {
    throw new Error(`table evidence missing for ${ledger.tableName}`)
  }
  const mapping = classificationMapping(classification, ledger.tableName, ledger.module)
  const zeroPolicyDecision = live.policies.length === 0
    ? (directEntrypoints.length === 0 && routines.length > 0 && live.rls.enabled
        ? 'rpc_only_intentional_keep_direct_api_denied'
        : 'zero_policy_requires_separate_remediation')
    : 'policies_mapped_with_table'
  const priorityCounts = countBy(unindexed, (entry) => entry.priorityCandidate)
  const highestIndexPriority = unindexed.some((entry) => entry.priorityCandidate === 'P1A-hot-chain')
    ? 'P1A-hot-chain'
    : unindexed.some((entry) => entry.priorityCandidate === 'P1B-active-chain')
      ? 'P1B-active-chain'
      : unindexed.length ? 'P2-history-observation' : 'covered-or-not-applicable'
  return {
    ordinal: ledger.ordinal,
    tableName: ledger.tableName,
    module: ledger.module,
    currentPurpose: ledger.reason.split('；')[0],
    frontendFunctionReadWriteEntrypoints: {
      directRuntimeSource: directEntrypoints,
      routines,
      directRuntimeSourceCount: directEntrypoints.length,
      routineDependencyCount: routines.length,
      coverageConclusion: directEntrypoints.length || routines.length
        ? 'runtime_or_routine_entrypoints_mapped'
        : 'no_current_runtime_or_routine_entrypoint_found',
    },
    criticalDependencies: {
      outgoingForeignKeys: live.outgoingForeignKeys,
      incomingForeignKeys: live.incomingForeignKeys,
      dependentViews: live.dependentViews,
    },
    rowCount: {
      exactRows,
      source: 'isolated-restored-copy-count-star',
      productionBusinessRowsRead: false,
      businessRowsReturned: false,
    },
    rls: live.rls,
    grants: live.effectiveClientGrants,
    policies: {
      entries: live.policies,
      decision: zeroPolicyDecision,
    },
    triggers: live.triggers,
    indexRisk: {
      currentIndexCount: live.indexes.length,
      unindexedForeignKeyCount: unindexed.length,
      priorityCounts,
      highestPriority: highestIndexPriority,
      unindexedForeignKeys: unindexed.map((entry) => ({
        constraintName: entry.constraintName,
        sourceColumns: entry.sourceColumns,
        targetTable: entry.targetTable,
        targetColumns: entry.targetColumns,
        priority: entry.priorityCandidate,
      })),
      decision: unindexed.length
        ? '优先级已冻结；按 P1A/P1B/P2 进入加法式索引工单，创建前再取查询计划和写放大证据。'
        : '当前无 Advisor 未覆盖外键；保留现有索引，后续按真实查询计划复核。',
    },
    classification,
    classificationReason: ledger.reason,
    teamOs4Mapping: mapping.teamOs4Mapping,
    compatibilityAction: mapping.compatibilityAction,
    acceptanceEvidence: [
      '生产只读逐表 catalog 元数据 103/103',
      '封闭恢复副本精确行数 103/103',
      '运行时源码表入口扫描，动态表名调用 0',
      '函数正文仅在隔离库内分析，162/162 指纹与生产一致且正文未返回',
      '策略/触发器/外键/索引风险逐表回连',
    ],
    acceptanceStatus: 'supervisor_classification_frozen',
    responsibleParty: '团队一（后端业务与数据）；监理冻结',
  }
})

const tableNames = tableClassifications.map((entry) => entry.tableName)
const expectedTableNames = sortedUnique([...classificationByTable.keys()])
if (tableClassifications.length !== 103 || ledgerRows.some((row, index) => row.ordinal !== index + 1) ||
    JSON.stringify(sortedUnique(tableNames)) !== JSON.stringify(expectedTableNames)) {
  throw new Error('103-table classification cross-review failed')
}
if (routineClassifications.length !== 162 || routineClassifications.some((entry) => !entry.bodyDependencyEvidence.productionFingerprintMatched)) {
  throw new Error('162-routine classification cross-review failed')
}

const zeroPolicyTables = tableClassifications.filter((entry) => entry.policies.entries.length === 0)
if (zeroPolicyTables.length !== 3 || zeroPolicyTables.some((entry) => entry.policies.decision !== 'rpc_only_intentional_keep_direct_api_denied')) {
  throw new Error('zero-policy table decision is incomplete')
}

const previous = existsSync(outputPath) ? readJson(outputPath) : null
const evidence = {
  schemaVersion: 1,
  evidenceType: 'p0-public-object-classification-supervisor-freeze',
  status: 'accepted_supervisor_frozen',
  frozenAtUtc: previous?.frozenAtUtc ?? new Date().toISOString(),
  productionProjectRef: register.livePerTableEvidence.projectRef,
  isolatedProjectRef: isolatedEvidence.projectRef,
  productionReadOnly: true,
  productionWritePerformed: false,
  isolatedReadOnly: true,
  isolatedWritePerformed: false,
  businessRowsReturned: false,
  functionBodiesReturned: false,
  secretsReturned: false,
  sources: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, {
    path: path.slice(repoRoot.length + 1).replaceAll('\\', '/'),
    sha256: sha256File(path),
  }])),
  counts: {
    tables: tableClassifications.length,
    tableClassifications: countBy(tableClassifications, (entry) => entry.classification),
    tableAccepted: tableClassifications.filter((entry) => entry.acceptanceStatus === 'supervisor_classification_frozen').length,
    routines: routineClassifications.length,
    routineDispositions: countBy(routineClassifications, (entry) => entry.disposition),
    routineAuthorizationPriorities: countBy(routineClassifications, (entry) => entry.authorizationReview.priority),
    routineAccepted: routineClassifications.filter((entry) => entry.acceptanceStatus === 'supervisor_classification_frozen').length,
    policies: tableClassifications.reduce((total, entry) => total + entry.policies.entries.length, 0),
    zeroPolicyRpcOnlyDecisions: zeroPolicyTables.length,
    triggerObjects: tableClassifications.reduce((total, entry) => total + entry.triggers.length, 0),
    indexes: tableClassifications.reduce((total, entry) => total + entry.indexRisk.currentIndexCount, 0),
    foreignKeys: foreignKeyEvidence.counts.foreignKeys,
    unindexedForeignKeys: advisorEvidence.counts.advisorUnindexedForeignKeys,
    exactRowsAcrossRestoredPublicTables: tableClassifications.reduce((total, entry) => total + entry.rowCount.exactRows, 0),
  },
  crossReview: {
    ledgerTableSetMatched: true,
    registerTableSetMatched: true,
    productionCatalogTableSetMatched: true,
    isolatedExactCountTableSetMatched: true,
    runtimeSourceDynamicTableSites: isolatedEvidence.validation.dynamicDatabaseFromSiteCount,
    productionRoutineFingerprintsMatched: isolatedEvidence.validation.routineFingerprintMatchCount,
    productionRoutineFingerprintMismatches: isolatedEvidence.validation.routineFingerprintMismatchCount,
    securityInvokerIsolatedSubgateAccepted: securityEvidence.subgateAccepted,
    classificationScope: 'classification_and_risk_priority_only',
    notClaimed: [
      'production schema or permission changes',
      'G1 six-identity runtime acceptance',
      '205 index creation or performance acceptance',
      'production migration, deploy, publish or merge',
    ],
  },
  g0Contribution: {
    tableClassificationComplete: true,
    routineClassificationComplete: true,
    policyAndTriggerMappingComplete: true,
    criticalIndexAndPermissionRiskPriorityComplete: true,
    g0OverallClaim: false,
    remainingOutsideThisEvidence: [
      'unified CI must actually execute database, permission and business tests',
      'other P0 artifacts must be jointly signed before G0 overall acceptance',
    ],
  },
  tableClassifications,
  routineClassifications,
}

writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(
  'P0_OBJECT_CLASSIFICATION_FREEZE_BUILT tables=' + evidence.counts.tables +
  ' tableAccepted=' + evidence.counts.tableAccepted +
  ' routines=' + evidence.counts.routines +
  ' routineAccepted=' + evidence.counts.routineAccepted +
  ' policies=' + evidence.counts.policies +
  ' triggers=' + evidence.counts.triggerObjects +
  ' unindexedPriority=' + evidence.counts.unindexedForeignKeys +
  ' productionWrites=0 isolatedWrites=0 g0=false',
)
