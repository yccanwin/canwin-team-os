import { useSupabaseSync } from '@/hooks/useSupabaseSync'
import { useTeamStore } from '@/stores/useTeamStore'
import { useUserStore } from '@/stores/useUserStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useGoalStore } from '@/stores/useGoalStore'
import { useVoteStore } from '@/stores/useVoteStore'
import { useBadgeStore } from '@/stores/useBadgeStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useActivityStore } from '@/stores/useActivityStore'
import { useAchievementStore } from '@/stores/useAchievementStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useAssetStore } from '@/stores/useAssetStore'
import { useToolboxStore } from '@/stores/useToolboxStore'
import { useWarRoomStore } from '@/stores/useWarRoomStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { isSupabaseConfigured } from '@/lib/supabase'

export default function SupabaseSyncProvider() {
  const teamId = useTeamStore((s) => s.teamId)
  const enabled = !!teamId && isSupabaseConfigured() && teamId !== 'default'

  // 为每个 store 启动双向同步（不能放循环里，React hooks 规则）
  useSupabaseSync('canwin-users', useUserStore as any, {
    enabled,
    excludeKeys: ['currentUser'],
  })
  useSupabaseSync('canwin-tasks', useTaskStore as any, { enabled })
  useSupabaseSync('canwin-finance', useFinanceStore as any, { enabled })
  useSupabaseSync('canwin-goals', useGoalStore as any, { enabled })
  useSupabaseSync('canwin-votes', useVoteStore as any, { enabled })
  useSupabaseSync('canwin-badges', useBadgeStore as any, { enabled })
  useSupabaseSync('canwin-inventory', useInventoryStore as any, { enabled })
  useSupabaseSync('canwin-activity', useActivityStore as any, { enabled })
  useSupabaseSync('canwin-achievements', useAchievementStore as any, { enabled })
  useSupabaseSync('canwin-timeline', useTimelineStore as any, { enabled })
  useSupabaseSync('canwin-photos', usePhotoStore as any, { enabled })
  useSupabaseSync('canwin-assets', useAssetStore as any, { enabled })
  useSupabaseSync('canwin-toolbox', useToolboxStore as any, { enabled })
  useSupabaseSync('canwin-warroom', useWarRoomStore as any, { enabled })
  useSupabaseSync('canwin-calendar', useCalendarStore as any, { enabled })

  return null
}
