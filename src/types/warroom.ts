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
  creatorId: string
  createdAt: string // ISO string
  comments: WarRoomComment[]
}
