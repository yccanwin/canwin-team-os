import type { PersonalGoal } from '@/types'

type GoalStatusInput = Pick<PersonalGoal, 'createdAt' | 'deadline' | 'lockStatus'>

const COOLDOWN_MS = 24 * 60 * 60 * 1000

function isPastDate(value?: string) {
  if (!value) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const deadline = new Date(`${value.slice(0, 10)}T00:00:00`)
  return deadline.getTime() < today.getTime()
}

export function derivePersonalGoalStatus(goal: GoalStatusInput): PersonalGoal['lockStatus'] {
  if (goal.lockStatus === 'unlocked') return 'unlocked'
  if (goal.lockStatus === 'review') return 'review'
  if (isPastDate(goal.deadline)) return 'review'
  if (goal.lockStatus === 'cooldown') {
    const pastCooldown = Date.now() - new Date(goal.createdAt).getTime() >= COOLDOWN_MS
    return pastCooldown ? 'locked' : 'cooldown'
  }
  return goal.lockStatus
}

export function withDerivedPersonalGoalStatus(goal: PersonalGoal): PersonalGoal {
  const lockStatus = derivePersonalGoalStatus(goal)
  return lockStatus === goal.lockStatus ? goal : { ...goal, lockStatus }
}
