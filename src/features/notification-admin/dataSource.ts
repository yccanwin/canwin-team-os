export interface NotificationStatusRecord {
  jobId: string
  recipientName: string
  jobType: 'daily_summary' | 'appointment_day_before' | 'appointment_2h'
  scheduledFor: string
  status: 'pending' | 'processing' | 'retry' | 'sent' | 'failed'
  attemptCount: number
  manualRetryUsed: boolean
  lastError: string | null
  channelConfigured: boolean
  lastWorkerAt: string | null
}

export interface NotificationAdminDataSource {
  listStatus(): Promise<NotificationStatusRecord[]>
  retryOnce(jobId: string, idempotencyKey: string): Promise<void>
}

export class NotificationAdminDataError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'NotificationAdminDataError'
  }
}
