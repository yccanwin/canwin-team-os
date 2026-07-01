import { CANWIN_TEAM_ID } from '@/config/team'
import { supabase } from '@/lib/supabase'

type AuditAction = 'create' | 'update' | 'delete' | 'status_change' | 'stock_in' | 'stock_out' | 'revert'

type AuditPayload = {
  action: AuditAction
  targetType: string
  targetId?: string
  beforeData?: Record<string, unknown> | null
  afterData?: Record<string, unknown> | null
}

export async function writeAuditLog(payload: AuditPayload): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)
  if (!userData.user) throw new Error('未登录，无法写入审计日志')

  const { error } = await supabase.from('audit_logs').insert({
    team_id: CANWIN_TEAM_ID,
    actor_id: userData.user.id,
    action: payload.action,
    target_type: payload.targetType,
    target_id: payload.targetId,
    before_data: payload.beforeData ?? null,
    after_data: payload.afterData ?? null,
  })

  if (error) throw new Error(error.message)
}
