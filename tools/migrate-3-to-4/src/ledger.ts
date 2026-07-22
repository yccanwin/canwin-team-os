import { DISPOSITIONS, type Disposition } from './manifest.ts'

export interface SourceDisposition {
  sourceTable: string
  sourceId: string
  disposition: Disposition
  targetEntity: string | null
  targetId: string | null
  reason: string
  mappingVersion: string
}

export interface DispositionLedger {
  schemaVersion: 1
  executionBatchId: string
  sourceSnapshotSha256: string
  migrationCodeCommit: string
  targetProjectRef: string
  rows: SourceDisposition[]
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
export function sourceKey(row: Pick<SourceDisposition, 'sourceTable' | 'sourceId'>): string { return `${row.sourceTable}\u0000${row.sourceId}` }

export function validateDispositionLedger(rows: SourceDisposition[]): string[] {
  const errors: string[] = []
  const seenSources = new Set<string>()
  const seenTargets = new Map<string, string>()
  for (const row of rows) {
    const key = sourceKey(row)
    if (!IDENTIFIER.test(row.sourceTable)) errors.push(`invalid source table: ${row.sourceTable}`)
    if (!row.sourceId) errors.push(`missing source id for ${row.sourceTable}`)
    if (seenSources.has(key)) errors.push(`source has more than one disposition: ${row.sourceTable}/${row.sourceId}`)
    seenSources.add(key)
    if (!DISPOSITIONS.includes(row.disposition)) errors.push(`invalid disposition for ${row.sourceTable}/${row.sourceId}`)
    if (!row.reason.trim()) errors.push(`missing disposition reason for ${row.sourceTable}/${row.sourceId}`)
    if (!row.mappingVersion.trim()) errors.push(`missing mapping version for ${row.sourceTable}/${row.sourceId}`)
    const needsTarget = row.disposition === 'import' || row.disposition === 'merge'
    if (needsTarget !== Boolean(row.targetEntity && row.targetId)) errors.push(`target mapping does not match disposition for ${row.sourceTable}/${row.sourceId}`)
    if (row.targetEntity && !IDENTIFIER.test(row.targetEntity)) errors.push(`invalid target entity: ${row.targetEntity}`)
    if (row.targetEntity && row.targetId) {
      const targetKey = `${row.targetEntity}\u0000${row.targetId}`
      const firstSource = seenTargets.get(targetKey)
      if (firstSource && row.disposition !== 'merge') errors.push(`multiple sources map to one target without merge: ${row.targetEntity}/${row.targetId}`)
      seenTargets.set(targetKey, firstSource ?? key)
    }
  }
  return errors
}

export function assertCompleteSourceCoverage(sourceRows: Array<{ sourceTable: string; sourceId: string }>, ledger: SourceDisposition[]): void {
  const errors = validateDispositionLedger(ledger)
  if (errors.length) throw new Error(errors.join('; '))
  const sourceKeys = new Set(sourceRows.map(sourceKey))
  const ledgerKeys = new Set(ledger.map(sourceKey))
  if (sourceKeys.size !== sourceRows.length) throw new Error('source snapshot contains duplicate source keys')
  for (const key of sourceKeys) if (!ledgerKeys.has(key)) throw new Error(`source row has no disposition: ${key.replace('\u0000', '/')}`)
  for (const key of ledgerKeys) if (!sourceKeys.has(key)) throw new Error(`ledger row is not present in source snapshot: ${key.replace('\u0000', '/')}`)
}

export function validateLedgerIdentity(ledger: DispositionLedger): string[] {
  const errors = validateDispositionLedger(ledger.rows)
  if (ledger.schemaVersion !== 1) errors.push('ledger schemaVersion must be 1')
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(ledger.executionBatchId)) errors.push('execution batch id is invalid')
  if (!/^[a-f0-9]{64}$/.test(ledger.sourceSnapshotSha256)) errors.push('ledger source snapshot SHA-256 is invalid')
  if (!/^[a-f0-9]{40}$/.test(ledger.migrationCodeCommit)) errors.push('ledger migration commit is invalid')
  if (!/^[a-z0-9]{20}$/.test(ledger.targetProjectRef)) errors.push('ledger target project ref is invalid')
  return errors
}

export function dispositionCounts(rows: SourceDisposition[]): Record<Disposition, number> {
  const counts = Object.fromEntries(DISPOSITIONS.map((value) => [value, 0])) as Record<Disposition, number>
  for (const row of rows) counts[row.disposition] += 1
  return counts
}

export function buildSourceIdMap(rows: SourceDisposition[]): ReadonlyMap<string, { targetEntity: string; targetId: string }> {
  const errors = validateDispositionLedger(rows)
  if (errors.length) throw new Error(errors.join('; '))
  return new Map(rows.filter((row) => row.targetEntity !== null && row.targetId !== null)
    .map((row) => [sourceKey(row), { targetEntity: row.targetEntity!, targetId: row.targetId! }]))
}
