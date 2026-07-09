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
  addSkill: (skill: Omit<Skill, 'id' | 'createdAt'>) => void
  lightSkill: (skillId: string, userId: string, note?: string) => void
  unlightSkill: (skillId: string, userId: string) => void
}

export const useSkillStore = create<SkillState & SkillActions>()(
  persist(
    (set, get) => ({
      skills: [],
      userSkills: [],

      setSkillData: ({ skills, userSkills }) => set({ skills, userSkills }),

      addSkill: (skill) => {
        const optimistic: Skill = {
          ...skill,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }
        set((state) => ({ skills: [...state.skills, optimistic] }))
        void createSkillRecord(skill)
          .then((saved) =>
            set((state) => ({
              skills: state.skills.map((item) => (item.id === optimistic.id ? saved : item)),
            }))
          )
          .catch(() =>
            set((state) => ({ skills: state.skills.filter((item) => item.id !== optimistic.id) }))
          )
      },

      lightSkill: (skillId, userId, note) => {
        if (get().userSkills.some((item) => item.skillId === skillId && item.userId === userId)) return
        const optimistic: UserSkill = {
          id: crypto.randomUUID(),
          skillId,
          userId,
          note,
          litAt: new Date().toISOString(),
        }
        set((state) => ({ userSkills: [optimistic, ...state.userSkills] }))
        void lightSkillRecord(skillId, userId, note)
          .then((saved) =>
            set((state) => ({
              userSkills: state.userSkills.map((item) => (item.id === optimistic.id ? saved : item)),
            }))
          )
          .catch(() =>
            set((state) => ({
              userSkills: state.userSkills.filter((item) => item.id !== optimistic.id),
            }))
          )
      },

      unlightSkill: (skillId, userId) => {
        const previous = get().userSkills
        const target = previous.find((item) => item.skillId === skillId && item.userId === userId)
        set((state) => ({
          userSkills: state.userSkills.filter(
            (item) => !(item.skillId === skillId && item.userId === userId)
          ),
        }))
        if (target) {
          void unlightSkillRecord(target.id).catch(() => set({ userSkills: previous }))
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
