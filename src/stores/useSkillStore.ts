import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Skill, UserSkill } from '@/types'
import {
  createSkillRecord,
  deleteSkillRecord,
  isSkillCloudUnavailable,
  lightSkillRecord,
  unlightSkillRecord,
  updateSkillRecord,
} from '@/services/skills'

const LOCAL_SKILL_SAVE_MESSAGE =
  '本地已保存：线上技能表尚未启用或当前账号无写入权限，当前改动只保存在本机。执行 Supabase skills / user_skills 表迁移并检查 RLS 后，才能团队共享。'

interface SkillState {
  skills: Skill[]
  userSkills: UserSkill[]
}

interface SkillActions {
  setSkillData: (data: { skills: Skill[]; userSkills: UserSkill[] }) => void
  addSkill: (skill: Omit<Skill, 'id' | 'createdAt'>) => Promise<void>
  updateSkill: (id: string, updates: Partial<Omit<Skill, 'id' | 'createdAt' | 'createdBy'>>) => Promise<void>
  deleteSkill: (id: string) => Promise<void>
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
          if (isSkillCloudUnavailable(error)) {
            throw new Error(LOCAL_SKILL_SAVE_MESSAGE, { cause: error })
          }
          set((state) => ({ skills: state.skills.filter((item) => item.id !== optimistic.id) }))
          throw error
        }
      },

      updateSkill: async (id, updates) => {
        const previous = get().skills
        set((state) => ({
          skills: state.skills.map((item) => (item.id === id ? { ...item, ...updates } : item)),
        }))
        try {
          const saved = await updateSkillRecord(id, updates)
          set((state) => ({
            skills: state.skills.map((item) => (item.id === id ? saved : item)),
          }))
        } catch (error) {
          if (isSkillCloudUnavailable(error)) {
            throw new Error(LOCAL_SKILL_SAVE_MESSAGE, { cause: error })
          }
          set({ skills: previous })
          throw error
        }
      },

      deleteSkill: async (id) => {
        const previousSkills = get().skills
        const previousUserSkills = get().userSkills
        set((state) => ({
          skills: state.skills
            .filter((skill) => skill.id !== id)
            .map((skill) => ({
              ...skill,
              prerequisiteIds: skill.prerequisiteIds.filter((prerequisiteId) => prerequisiteId !== id),
            })),
          userSkills: state.userSkills.filter((item) => item.skillId !== id),
        }))
        try {
          await deleteSkillRecord(id)
        } catch (error) {
          if (isSkillCloudUnavailable(error)) {
            throw new Error(LOCAL_SKILL_SAVE_MESSAGE, { cause: error })
          }
          set({ skills: previousSkills, userSkills: previousUserSkills })
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
          if (isSkillCloudUnavailable(error)) {
            throw new Error(LOCAL_SKILL_SAVE_MESSAGE, { cause: error })
          }
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
            if (isSkillCloudUnavailable(error)) {
              throw new Error(LOCAL_SKILL_SAVE_MESSAGE, { cause: error })
            }
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
