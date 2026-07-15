import type { PerformanceCenterSnapshot, PerformanceScope } from './types'

export interface PerformanceCenterQuery {
  quarterStart: string
  scope: PerformanceScope
  profileId?: string
}

export interface PerformanceCenterDataSource {
  loadSnapshot(query: PerformanceCenterQuery): Promise<PerformanceCenterSnapshot>
}

/**
 * Order-backed implementation is installed with the performance RPC migration.
 * Keeping the contract here lets the page ship without falling back to legacy
 * manual score records or displaying invented values.
 */
export const performanceCenterDataSource: PerformanceCenterDataSource | null = null
