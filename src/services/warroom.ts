import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { WarRoomComment, WarRoomPolicy } from '@/types/warroom'

type AnnouncementRow = {
  id: string
  title: string
  content: string
  created_by: string | null
  created_at: string
}

type PolicyContent = {
  content?: string
  category?: WarRoomPolicy['category']
  status?: WarRoomPolicy['status']
  priority?: WarRoomPolicy['priority']
  decisionSummary?: string
  linkedVoteId?: string
  linkedTaskIds?: string[]
  comments?: WarRoomComment[]
}

const ANNOUNCEMENT_SELECT = 'id, title, content, created_by, created_at'

function parseContent(content: string): PolicyContent {
  try {
    const parsed = JSON.parse(content) as PolicyContent
    return parsed && typeof parsed === 'object' ? parsed : { content }
  } catch {
    return { content }
  }
}

function rowToPolicy(row: AnnouncementRow): WarRoomPolicy {
  const parsed = parseContent(row.content)
  return {
    id: row.id,
    title: row.title,
    content: parsed.content || '',
    category: parsed.category || 'strategy',
    status: parsed.status || 'discussing',
    priority: parsed.priority || 'medium',
    decisionSummary: parsed.decisionSummary,
    linkedVoteId: parsed.linkedVoteId,
    linkedTaskIds: parsed.linkedTaskIds ?? [],
    creatorId: row.created_by || '',
    createdAt: row.created_at,
    comments: parsed.comments ?? [],
  }
}

function policyToContent(
  policy: Pick<
    WarRoomPolicy,
    | 'content'
    | 'category'
    | 'status'
    | 'priority'
    | 'decisionSummary'
    | 'linkedVoteId'
    | 'linkedTaskIds'
    | 'comments'
  >
) {
  return JSON.stringify({
    content: policy.content,
    category: policy.category,
    status: policy.status,
    priority: policy.priority,
    decisionSummary: policy.decisionSummary,
    linkedVoteId: policy.linkedVoteId,
    linkedTaskIds: policy.linkedTaskIds,
    comments: policy.comments,
  })
}

export async function loadWarRoomPolicies(): Promise<WarRoomPolicy[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .eq('status', 'policy')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToPolicy(row as AnnouncementRow))
}

export async function createWarRoomPolicy(
  policy: Omit<WarRoomPolicy, 'id' | 'createdAt'>
): Promise<WarRoomPolicy> {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      team_id: CANWIN_TEAM_ID,
      title: policy.title,
      content: policyToContent(policy),
      status: 'policy',
      created_by: policy.creatorId,
    })
    .select(ANNOUNCEMENT_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToPolicy(data as AnnouncementRow)
}

export async function updateWarRoomPolicy(policy: WarRoomPolicy): Promise<WarRoomPolicy> {
  const { data, error } = await supabase
    .from('announcements')
    .update({
      title: policy.title,
      content: policyToContent(policy),
    })
    .eq('id', policy.id)
    .select(ANNOUNCEMENT_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToPolicy(data as AnnouncementRow)
}

export async function deleteWarRoomPolicyRecord(id: string): Promise<void> {
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
