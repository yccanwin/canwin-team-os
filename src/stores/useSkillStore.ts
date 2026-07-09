import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Skill, UserSkill } from '@/types'
import { createSkillRecord, lightSkillRecord, unlightSkillRecord } from '@/services/skills'

interface SkillState {
  skills: Skill[]
  userSkills: UserSkill[]
}

interface SkillActions {
  setSkillData: (data: { skills: Skill[]; userSkills: UserSkill[] }) => void
  addSkill: (skill: Omit<Skill, 'id' | 'createdAt'>) => Promise<void>
  lightSkill: (skillId: string, userId: string, note?: string) => Promise<void>
  unlightSkill: (skillId: string, userId: string) => Promise<void>
}

export const useSkillStore = create<SkillState & SkillActions>()(
  persist(
    (set, get) => ({
      skills: [],
      userSkills: [],

      setSkillData: ({ skills, userSkills }) => set({ skills, userSkills }),

      addSkill: async (skill) => {
        const optimistic: Skill = {
          ...skill,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }
        set((state) => ({ skills: [...state.skills, optimistic] }))
        try {
          const saved = await createSkillRecord(skill)
          set((state) => ({
            skills: state.skills.map((item) => (item.id === optimistic.id ? saved : item)),
          }))
        } catch (error) {
          set((state) => ({ skills: state.skills.filter((item) => item.id !== optimistic.id) }))
          throw error
        }
      },

      lightSkill: async (skillId, userId, note) => {
        if (get().userSkills.some((item) => item.skillId === skillId && item.userId === userId)) return
        const optimistic: UserSkill = {
          id: crypto.randomUUID(),
          skillId,
          userId,
          note,
          litAt: new Date().toISOString(),
        }
        set((state) => ({ userSkills: [optimistic, ...state.userSkills] }))
        try {
          const saved = await lightSkillRecord(skillId, userId, note)
          set((state) => ({
            userSkills: state.userSkills.map((item) => (item.id === optimistic.id ? saved : item)),
          }))
        } catch (error) {
          set((state) => ({
            userSkills: state.userSkills.filter((item) => item.id !== optimistic.id),
          }))
          throw error
        }
      },

      unlightSkill: async (skillId, userId) => {
        const previous = get().userSkills
        const target = previous.find((item) => item.skillId === skillId && item.userId === userId)
        set((state) => ({
          userSkills: state.userSkills.filter(
            (item) => !(item.skillId === skillId && item.userId === userId)
          ),
        }))
        if (target) {
          try {
            await unlightSkillRecord(target.id)
          } catch (error) {
            set({ userSkills: previous })
            throw error
          }
        }
      },
    }),
    {
      name: 'canwin-skills',
      version: 1,
      storage: safeStorage,
      migrate: () => ({ skills: [], userSkills: [] }),
    }
  )
)
