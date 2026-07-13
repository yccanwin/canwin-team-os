import type { SupabaseClient } from '@supabase/supabase-js'
import { NotificationAdminDataError, type NotificationAdminDataSource, type NotificationStatusRecord } from './dataSource'

type RawStatus = {
  job_id: string
  recipient_name: string
  job_type: NotificationStatusRecord['jobType']
  scheduled_for: string
  status: NotificationStatusRecord['status']
  attempt_count: number | string
  manual_retry_used: boolean
  last_error: string | null
  channel_configured: boolean
  last_worker_at: string | null
}

export const createSupabaseNotificationAdminDataSource = (client: SupabaseClient): NotificationAdminDataSource => ({
  async listStatus() {
    const { data, error } = await client.rpc('get_wecom_notification_status')
    if (error || !data) throw new NotificationAdminDataError(`读取企业微信通知状态失败：${error?.message ?? '服务端未返回数据'}`, error?.code)
    return (data as RawStatus[]).map(row => ({
      jobId: row.job_id,
      recipientName: row.recipient_name,
      jobType: row.job_type,
      scheduledFor: row.scheduled_for,
      status: row.status,
      attemptCount: Number(row.attempt_count),
      manualRetryUsed: row.manual_retry_used,
      lastError: row.last_error,
      channelConfigured: row.channel_configured,
      lastWorkerAt: row.last_worker_at,
    }))
  },
  async retryOnce(jobId, idempotencyKey) {
    const { error } = await client.rpc('retry_wecom_notification_once', { p_job_id: jobId, p_idempotency_key: idempotencyKey })
    if (error) throw new NotificationAdminDataError(`人工重试失败：${error.message}`, error.code)
  },
})
