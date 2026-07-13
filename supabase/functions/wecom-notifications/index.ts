import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type NotificationJob = { id: string; payload: { title?: string; appointment_at?: string; due_count?: number; recycle_risk_count?: number } }

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function message(job: NotificationJob) {
  const p = job.payload
  const lines = [p.title ?? '工作提醒']
  if (p.appointment_at) lines.push(`时间：${p.appointment_at}`)
  if (typeof p.due_count === 'number') lines.push(`待处理：${p.due_count}项`)
  if (typeof p.recycle_risk_count === 'number') lines.push(`回收风险：${p.recycle_risk_count}项`)
  return lines.join('\n')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const webhookUrl = Deno.env.get('WECOM_WEBHOOK_URL')
  if (!url || !serviceKey || !webhookUrl) return response({ error: 'Server notification environment is incomplete' }, 500)
  if (req.headers.get('authorization') !== `Bearer ${serviceKey}`) return response({ error: 'Unauthorized' }, 401)

  const db = createClient(url, serviceKey)
  const { data: jobs, error: claimError } = await db.rpc('claim_wecom_notification_jobs', { p_limit: 20 })
  if (claimError) return response({ error: claimError.message }, 500)

  let sent = 0
  for (const job of (jobs ?? []) as NotificationJob[]) {
    try {
      const outgoing = await fetch(webhookUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: message(job) } }),
      })
      const result = await outgoing.json().catch(() => ({})) as { errcode?: number; errmsg?: string }
      const succeeded = outgoing.ok && result.errcode === 0
      await db.rpc('complete_wecom_notification_job', {
        p_job_id: job.id, p_succeeded: succeeded,
        p_error_code: succeeded ? null : String(result.errcode ?? outgoing.status),
        p_error_message: succeeded ? null : (result.errmsg ?? 'WeCom request failed'),
      })
      if (succeeded) sent += 1
    } catch (error) {
      await db.rpc('complete_wecom_notification_job', {
        p_job_id: job.id, p_succeeded: false, p_error_code: 'NETWORK_ERROR',
        p_error_message: error instanceof Error ? error.message : 'Unknown network error',
      })
    }
  }
  return response({ claimed: jobs?.length ?? 0, sent })
})
