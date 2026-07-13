import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type NotificationJob = {
  id: string
  team_id: string
  payload: {
    title?: string
    appointment_at?: string
    due_count?: number
    recycle_risk_count?: number
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function isValidWebhook(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/webhook/send' && Boolean(url.searchParams.get('key'))
  } catch {
    return false
  }
}

function message(job: NotificationJob) {
  const payload = job.payload
  const lines = [payload.title ?? '工作提醒']
  if (payload.appointment_at) lines.push(`时间：${new Date(payload.appointment_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
  if (typeof payload.due_count === 'number') lines.push(`待处理：${payload.due_count}项`)
  if (typeof payload.recycle_risk_count === 'number') lines.push(`回收风险：${payload.recycle_risk_count}项`)
  return lines.join('\n')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return response({ error: 'Notification worker is unavailable' }, 503)
  if (req.headers.get('authorization') !== `Bearer ${serviceKey}`) return response({ error: 'Unauthorized' }, 401)

  const webhookUrl = Deno.env.get('WECOM_WEBHOOK_URL')
  if (!webhookUrl || !isValidWebhook(webhookUrl)) {
    return response({ configured: false, claimed: 0, sent: 0, error: 'WeCom channel is safely disabled' }, 503)
  }

  const db = createClient(url, serviceKey)
  const { data: jobs, error: claimError } = await db.rpc('claim_wecom_notification_jobs', { p_limit: 20 })
  if (claimError) return response({ error: 'Unable to claim notification jobs' }, 500)

  let sent = 0
  const claimedJobs = (jobs ?? []) as NotificationJob[]
  for (const teamId of new Set(claimedJobs.map(job => job.team_id))) {
    await db.rpc('report_wecom_channel_status', { p_team_id: teamId, p_configured: true })
  }

  for (const job of claimedJobs) {
    try {
      const outgoing = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: message(job) } }),
        signal: AbortSignal.timeout(10_000),
      })
      const result = await outgoing.json().catch(() => ({})) as { errcode?: number; errmsg?: string }
      const succeeded = outgoing.ok && result.errcode === 0
      await db.rpc('complete_wecom_notification_job', {
        p_job_id: job.id,
        p_succeeded: succeeded,
        p_error_code: succeeded ? null : String(result.errcode ?? outgoing.status),
        p_error_message: succeeded ? null : (result.errmsg ?? 'WeCom request failed'),
      })
      if (succeeded) sent += 1
    } catch (error) {
      await db.rpc('complete_wecom_notification_job', {
        p_job_id: job.id,
        p_succeeded: false,
        p_error_code: error instanceof DOMException && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        p_error_message: error instanceof Error ? error.message : 'Unknown network error',
      })
    }
  }

  return response({ configured: true, claimed: claimedJobs.length, sent })
})
