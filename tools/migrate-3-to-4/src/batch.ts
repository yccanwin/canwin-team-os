export interface TargetTransaction {
  execute(statement: string, parameters: readonly unknown[]): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}
export interface TargetWriter { begin(): Promise<TargetTransaction> }
export interface TargetWrite { statement: string; parameters: readonly unknown[] }

export function assertSafeTargetWrite(write: TargetWrite): void {
  if (!write.statement.trim()) throw new Error('empty target write is forbidden')
  if (/\bon\s+conflict\s+do\s+nothing\b/i.test(write.statement)) throw new Error('ON CONFLICT DO NOTHING is forbidden')
  if (/\b(upsert|insert\s+or\s+ignore)\b/i.test(write.statement)) throw new Error('silent target overwrite or skip is forbidden')
  if (/\bon\s+conflict\b/i.test(write.statement)) throw new Error('ON CONFLICT is forbidden for migration writes')
  if (/\bupdate\b/i.test(write.statement)) throw new Error('target UPDATE is forbidden during insert-only migration')
}

export async function writeTargetBatch(writer: TargetWriter, executionBatchId: string, writes: readonly TargetWrite[]): Promise<void> {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(executionBatchId)) throw new Error('execution batch id is invalid')
  if (writes.length === 0) throw new Error('empty migration batch is forbidden')
  writes.forEach(assertSafeTargetWrite)
  const transaction = await writer.begin()
  try {
    for (const write of writes) await transaction.execute(write.statement, write.parameters)
    await transaction.commit()
  } catch (error) {
    try { await transaction.rollback() }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], 'target batch failed and rollback failed') }
    throw error
  }
}
