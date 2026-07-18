import type { PerformanceCenterSnapshot, PerformanceScope } from './types'
import { supabase } from '../../lib/supabase'
import { createSupabasePerformanceCenterDataSource } from './supabaseDataSource'

export interface PerformanceCenterQuery {
  quarterStart: string
  scope: PerformanceScope
  profileId?: string
}

export interface PerformanceCenterDataSource {
  loadSnapshot(query: PerformanceCenterQuery): Promise<PerformanceCenterSnapshot>
}

export const performanceCenterDataSource: PerformanceCenterDataSource = createSupabasePerformanceCenterDataSource(supabase)
