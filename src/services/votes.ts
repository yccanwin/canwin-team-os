import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { Vote, VoteOption, VoteRecord } from '@/types'

type VoteRow = {
  id: string
  title: string
  deadline: string | null
  status: string
  created_by: string | null
  vote_options?: { id: string; label: string }[] | null
  vote_records?: { user_id: string; option_id: string; voted_at: string }[] | null
}

const VOTE_SELECT = 'id, title, deadline, status, created_by, vote_options(id, label), vote_records(user_id, option_id, voted_at)'

function rowToVote(row: VoteRow): Vote {
  return {
    id: row.id,
    title: row.title,
    options: (row.vote_options ?? []).map((option): VoteOption => ({
      id: option.id,
      label: option.label,
    })),
    deadline: row.deadline || new Date().toISOString(),
    createdBy: row.created_by || '',
    votes: (row.vote_records ?? []).map((record): VoteRecord => ({
      userId: record.user_id,
      optionId: record.option_id,
      votedAt: record.voted_at,
    })),
    isActive: row.status === 'active',
  }
}

export async function loadVotes(): Promise<Vote[]> {
  const { data, error } = await supabase
    .from('votes')
    .select(VOTE_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToVote(row as VoteRow))
}

export async function createVoteRecord(vote: Omit<Vote, 'id' | 'votes'>): Promise<Vote> {
  const { data, error } = await supabase
    .from('votes')
    .insert({
      team_id: CANWIN_TEAM_ID,
      title: vote.title,
      deadline: vote.deadline,
      status: vote.isActive ? 'active' : 'closed',
      created_by: vote.createdBy,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  const { error: optionsError } = await supabase.from('vote_options').insert(
    vote.options.map((option) => ({
      vote_id: data.id,
      label: option.label,
    }))
  )

  if (optionsError) throw new Error(optionsError.message)

  const { data: createdVote, error: selectError } = await supabase
    .from('votes')
    .select(VOTE_SELECT)
    .eq('id', data.id)
    .single()

  if (selectError) throw new Error(selectError.message)
  return rowToVote(createdVote as VoteRow)
}

export async function deleteVoteRecord(id: string): Promise<void> {
  const { error } = await supabase.from('votes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function castVoteRecord(voteId: string, userId: string, optionId: string): Promise<void> {
  const { error } = await supabase.from('vote_records').insert({
    vote_id: voteId,
    user_id: userId,
    option_id: optionId,
  })
  if (error) throw new Error(error.message)
}

export async function closeVoteRecord(id: string): Promise<void> {
  const { error } = await supabase.from('votes').update({ status: 'closed' }).eq('id', id)
  if (error) throw new Error(error.message)
}
