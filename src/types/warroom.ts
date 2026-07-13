export interface WarRoomComment {
  id: string
  policyId: string
  userId: string
  content: string
  createdAt: string // ISO string
}

export interface WarRoomPolicy {
  id: string
  title: string
  content: string
  category: 'strategy' | 'process' | 'client' | 'finance' | 'team'
  status: 'discussing' | 'voting' | 'decided' | 'archived'
  priority: 'low' | 'medium' | 'high'
  decisionSummary?: string
  linkedVoteId?: string
  linkedTaskIds: string[]
  creatorId: string
  createdAt: string // ISO string
  comments: WarRoomComment[]
}
