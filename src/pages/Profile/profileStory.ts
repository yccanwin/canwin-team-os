import type { Achievement, Asset, InventoryLog, PersonalGoal, Photo, Task, TimelineEvent, User, Vote } from '@/types'
import type { ToolItem } from '@/types/toolbox'

export type StoryRecordKind = 'task' | 'goal' | 'memory' | 'case' | 'photo' | 'tool' | 'inventory' | 'asset' | 'decision'

export type StoryRecord = {
  id: string
  kind: StoryRecordKind
  label: string
  title: string
  date: string
  description?: string
}

export type ProfileStory = {
  firstRecord?: StoryRecord
  learned: StoryRecord[]
  accomplished: StoryRecord[]
  leftBehind: StoryRecord[]
  experienced: StoryRecord[]
  timeline: StoryRecord[]
  counts: {
    tasksDone: number
    goals: number
    memories: number
    cases: number
    decisions: number
  }
}

type ProfileStoryInput = {
  user: User
  tasks: Task[]
  timelineEvents: TimelineEvent[]
  achievements: Achievement[]
  photos: Photo[]
  tools: ToolItem[]
  logs: InventoryLog[]
  votes: Vote[]
  assets: Asset[]
  personalGoals: PersonalGoal[]
}

function byNewest(a: StoryRecord, b: StoryRecord) {
  return new Date(b.date).getTime() - new Date(a.date).getTime()
}

function byOldest(a: StoryRecord, b: StoryRecord) {
  return new Date(a.date).getTime() - new Date(b.date).getTime()
}

function take(records: StoryRecord[], count = 6) {
  return records.sort(byNewest).slice(0, count)
}

export function buildProfileStory({
  user,
  tasks,
  timelineEvents,
  achievements,
  photos,
  tools,
  logs,
  votes,
  assets,
  personalGoals,
}: ProfileStoryInput): ProfileStory {
  const userId = user.id

  const completedTasks: StoryRecord[] = tasks
    .filter((task) => task.assigneeId === userId && task.status === 'done')
    .map((task) => ({
      id: `task-${task.id}`,
      kind: 'task',
      label: '完成任务',
      title: task.title,
      date: task.completedAt || task.createdAt,
      description: task.description,
    }))

  const userGoals = personalGoals.filter((goal) => goal.userId === userId)
  const goalRecords: StoryRecord[] = userGoals.flatMap((goal) => [
    {
      id: `goal-${goal.id}`,
      kind: 'goal' as const,
      label: goal.goalType ? `目标：${goal.goalType}` : '个人目标',
      title: goal.title,
      date: goal.createdAt,
      description: goal.description,
    },
    ...goal.updates.map((update) => ({
      id: `goal-update-${update.id}`,
      kind: 'goal' as const,
      label: '目标进展',
      title: goal.title,
      date: update.createdAt,
      description: update.content,
    })),
  ])

  const createdMemories: StoryRecord[] = timelineEvents
    .filter((event) => event.createdBy === userId)
    .map((event) => ({
      id: `memory-created-${event.id}`,
      kind: 'memory',
      label: '记录团队记忆',
      title: event.title,
      date: event.date || event.createdAt,
      description: event.description,
    }))

  const participatedMemories: StoryRecord[] = timelineEvents
    .filter((event) => event.participants.includes(userId))
    .map((event) => ({
      id: `memory-participated-${event.id}`,
      kind: 'memory',
      label: event.createdBy === userId ? '共同经历' : '参与团队记忆',
      title: event.title,
      date: event.date || event.createdAt,
      description: event.description,
    }))

  const caseRecords: StoryRecord[] = achievements
    .filter((achievement) => achievement.createdBy === userId)
    .map((achievement) => ({
      id: `case-${achievement.id}`,
      kind: 'case',
      label: '沉淀案例',
      title: achievement.name,
      date: achievement.achievedDate || achievement.createdAt,
      description: achievement.description,
    }))

  const photoRecords: StoryRecord[] = photos
    .filter((photo) => photo.uploadedBy === userId || photo.participants.includes(userId))
    .map((photo) => ({
      id: `photo-${photo.id}`,
      kind: 'photo',
      label: photo.uploadedBy === userId ? '上传照片' : '参与照片',
      title: photo.title || '团队瞬间',
      date: photo.date || photo.uploadedAt,
      description: photo.description || photo.location,
    }))

  const toolRecords: StoryRecord[] = tools
    .filter((tool) => tool.creatorId === userId)
    .map((tool) => ({
      id: `tool-${tool.id}`,
      kind: 'tool',
      label: '分享工具',
      title: tool.title,
      date: tool.createdAt,
      description: tool.description,
    }))

  const inventoryRecords: StoryRecord[] = logs
    .filter((log) => log.operatorId === userId)
    .map((log) => ({
      id: `inventory-${log.id}`,
      kind: 'inventory',
      label: log.operation === 'in' ? '入库记录' : '出库记录',
      title: `${log.itemName} x ${log.quantityChange}`,
      date: log.createdAt,
    }))

  const assetRecords: StoryRecord[] = assets
    .filter((asset) => asset.createdBy === userId)
    .map((asset) => ({
      id: `asset-${asset.id}`,
      kind: 'asset',
      label: '记录资产',
      title: asset.name,
      date: asset.createdAt,
      description: asset.description,
    }))

  const decisionRecords: StoryRecord[] = votes.flatMap((vote) =>
    vote.votes
      .filter((record) => record.userId === userId)
      .map((record) => ({
        id: `vote-${vote.id}-${record.userId}`,
        kind: 'decision' as const,
        label: '参与决定',
        title: vote.title,
        date: record.votedAt,
      }))
  )

  const learned = take([...goalRecords, ...completedTasks, ...caseRecords], 5)
  const accomplished = take([...completedTasks, ...caseRecords, ...goalRecords], 6)
  const leftBehind = take([...createdMemories, ...caseRecords, ...photoRecords.filter((item) => item.label === '上传照片'), ...toolRecords, ...assetRecords, ...inventoryRecords], 6)
  const experienced = take([...participatedMemories, ...photoRecords, ...decisionRecords], 6)
  const timeline = take([...learned, ...leftBehind, ...experienced], 9)

  return {
    firstRecord: [...completedTasks, ...goalRecords, ...createdMemories, ...participatedMemories, ...caseRecords, ...photoRecords, ...toolRecords, ...inventoryRecords, ...assetRecords, ...decisionRecords].sort(byOldest)[0],
    learned,
    accomplished,
    leftBehind,
    experienced,
    timeline,
    counts: {
      tasksDone: completedTasks.length,
      goals: userGoals.length,
      memories: new Set([...createdMemories, ...participatedMemories].map((item) => item.id.replace('memory-created-', '').replace('memory-participated-', ''))).size,
      cases: caseRecords.length,
      decisions: decisionRecords.length,
    },
  }
}
