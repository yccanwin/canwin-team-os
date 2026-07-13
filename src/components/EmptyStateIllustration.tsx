import type { ReactNode } from 'react'

// ============================================================
// 各页面空状态定制插图 — 内联 SVG，品牌色系
// ============================================================

type Variant = 'tasks' | 'goals' | 'inventory' | 'achievements' | 'photos'

interface Props {
  variant: Variant
  title: string
  description?: string
  action?: ReactNode
}

// ---------- 尺寸常量 ----------
const SIZE = 120

// ---------- 各变体 SVG ----------
function TasksIllustration() {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      {/* 剪贴板 */}
      <rect x="26" y="16" width="68" height="88" rx="6" fill="#EEF2FF" stroke="#6366F1" strokeWidth="2" />
      {/* 顶部夹子 */}
      <rect x="42" y="10" width="36" height="10" rx="3" fill="#6366F1" />
      {/* 勾选框 1 */}
      <rect x="38" y="38" width="12" height="12" rx="3" fill="#6366F1" opacity="0.15" stroke="#6366F1" strokeWidth="1.5" />
      <line x1="57" y1="44" x2="80" y2="44" stroke="#A5B4FC" strokeWidth="2" strokeLinecap="round" />
      {/* 勾选框 2 */}
      <rect x="38" y="58" width="12" height="12" rx="3" fill="#6366F1" opacity="0.15" stroke="#6366F1" strokeWidth="1.5" />
      <line x1="57" y1="64" x2="80" y2="64" stroke="#A5B4FC" strokeWidth="2" strokeLinecap="round" />
      {/* 勾选框 3 — 已打勾 */}
      <rect x="38" y="78" width="12" height="12" rx="3" fill="#6366F1" />
      <path d="M41 84l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="57" y1="84" x2="80" y2="84" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round" />
      {/* 右下角小铅笔 */}
      <circle cx="98" cy="98" r="14" fill="#6366F1" opacity="0.12" />
      <path d="M93 98l5 5-7 2 2-7z" fill="#6366F1" opacity="0.4" />
    </svg>
  )
}

function GoalsIllustration() {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      {/* 外圈 */}
      <circle cx="60" cy="52" r="32" stroke="#C7D2FE" strokeWidth="2" />
      {/* 中圈 */}
      <circle cx="60" cy="52" r="22" stroke="#A5B4FC" strokeWidth="2" />
      {/* 内圈 */}
      <circle cx="60" cy="52" r="12" fill="#EEF2FF" stroke="#6366F1" strokeWidth="2" />
      {/* 靶心 */}
      <circle cx="60" cy="52" r="4" fill="#6366F1" />
      {/* 十字准线 */}
      <line x1="30" y1="52" x2="44" y2="52" stroke="#C7D2FE" strokeWidth="1.5" />
      <line x1="76" y1="52" x2="90" y2="52" stroke="#C7D2FE" strokeWidth="1.5" />
      <line x1="60" y1="22" x2="60" y2="36" stroke="#C7D2FE" strokeWidth="1.5" />
      {/* 箭矢（从右下射入） */}
      <path d="M62 82l10-22" stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="62,82 68,74 56,76" fill="#6366F1" />
      <line x1="89" y1="68" x2="72" y2="60" stroke="#6366F1" strokeWidth="1.2" strokeDasharray="3 2" opacity="0.4" />
      {/* 旗标 */}
      <line x1="30" y1="90" x2="30" y2="110" stroke="#6366F1" strokeWidth="1.5" />
      <path d="M30 90l16 -5v14l-16 -4z" fill="#6366F1" opacity="0.2" stroke="#6366F1" strokeWidth="1.5" />
    </svg>
  )
}

function InventoryIllustration() {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      {/* 箱子主体 */}
      <rect x="28" y="38" width="64" height="52" rx="4" fill="#EEF2FF" stroke="#6366F1" strokeWidth="2" />
      {/* 箱盖 */}
      <path d="M22 38l12-14h52l12 14" fill="#C7D2FE" stroke="#6366F1" strokeWidth="2" strokeLinejoin="round" />
      {/* 箱子中线 */}
      <line x1="60" y1="24" x2="60" y2="90" stroke="#6366F1" strokeWidth="1.5" opacity="0.3" />
      {/* 箱子内容物 1 */}
      <rect x="36" y="56" width="16" height="16" rx="3" fill="#6366F1" opacity="0.25" />
      <circle cx="44" cy="64" r="3" fill="#6366F1" opacity="0.5" />
      {/* 箱子内容物 2 */}
      <rect x="68" y="56" width="16" height="16" rx="3" fill="#818CF8" opacity="0.25" />
      <circle cx="76" cy="64" r="3" fill="#818CF8" opacity="0.5" />
      {/* 库存标签 */}
      <rect x="38" y="80" width="44" height="6" rx="3" fill="#6366F1" opacity="0.1" />
      {/* 侧面把手 */}
      <circle cx="28" cy="64" r="6" fill="none" stroke="#6366F1" strokeWidth="1.5" opacity="0.4" />
      <circle cx="92" cy="64" r="6" fill="none" stroke="#6366F1" strokeWidth="1.5" opacity="0.4" />
    </svg>
  )
}

function AchievementsIllustration() {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      {/* 底座 */}
      <rect x="36" y="88" width="48" height="10" rx="3" fill="#C7D2FE" />
      <rect x="42" y="80" width="36" height="10" rx="2" fill="#A5B4FC" />
      {/* 杯身 */}
      <path d="M40 56c0-24 16-24 20-24s20 0 20 24c0 12-8 24-20 24s-20-12-20-24z" fill="#EEF2FF" stroke="#6366F1" strokeWidth="2" />
      {/* 左弧线 */}
      <path d="M40 56c-4 0-8 8-8 12 0 6 8 12 8 12" stroke="#6366F1" strokeWidth="2" fill="none" />
      {/* 右弧线 */}
      <path d="M80 56c4 0 8 8 8 12 0 6-8 12-8 12" stroke="#6366F1" strokeWidth="2" fill="none" />
      {/* 星星 */}
      <path d="M60 44l3.5 7 7.5 1-5.5 5.5 1.5 7.5-7-4-7 4 1.5-7.5-5.5-5.5 7.5-1z" fill="#6366F1" />
      {/* 杯身纹理 */}
      <line x1="48" y1="64" x2="72" y2="64" stroke="#6366F1" strokeWidth="1" opacity="0.2" />
      <line x1="50" y1="70" x2="70" y2="70" stroke="#6366F1" strokeWidth="1" opacity="0.2" />
      <line x1="54" y1="76" x2="66" y2="76" stroke="#6366F1" strokeWidth="1" opacity="0.2" />
    </svg>
  )
}

function PhotosIllustration() {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      {/* 照片框 */}
      <rect x="20" y="20" width="80" height="70" rx="6" fill="#EEF2FF" stroke="#6366F1" strokeWidth="2" />
      {/* 照片内衬 */}
      <rect x="26" y="26" width="68" height="58" rx="3" fill="white" />
      {/* 太阳/风景 */}
      <circle cx="76" cy="44" r="10" fill="#6366F1" opacity="0.15" />
      <circle cx="76" cy="44" r="6" fill="#6366F1" opacity="0.3" />
      {/* 山脉 */}
      <path d="M22 84l16-24 10 10 16-20 12 14 22-16v20z" fill="#C7D2FE" opacity="0.5" />
      <path d="M22 84l16-24 10 10 16-20 12 14 22-16v15z" fill="#A5B4FC" opacity="0.3" />
      {/* 树 */}
      <rect x="34" y="68" width="3" height="12" rx="1.5" fill="#6366F1" opacity="0.3" />
      <circle cx="35.5" cy="66" r="5" fill="#6366F1" opacity="0.2" />
      <rect x="48" y="70" width="2" height="8" rx="1" fill="#6366F1" opacity="0.25" />
      <circle cx="49" cy="68" r="4" fill="#6366F1" opacity="0.15" />
      {/* 取景框角标 */}
      <path d="M20 36v-6a4 4 0 014-4h6" stroke="#6366F1" strokeWidth="1.5" opacity="0.3" />
      <path d="M90 26h6a4 4 0 014 4v6" stroke="#6366F1" strokeWidth="1.5" opacity="0.3" />
      <path d="M100 84v6a4 4 0 01-4 4h-6" stroke="#6366F1" strokeWidth="1.5" opacity="0.3" />
      <path d="M30 94h-6a4 4 0 01-4-4v-6" stroke="#6366F1" strokeWidth="1.5" opacity="0.3" />
    </svg>
  )
}

// ---------- 映射表 ----------
const illustrations: Record<Variant, () => JSX.Element> = {
  tasks: TasksIllustration,
  goals: GoalsIllustration,
  inventory: InventoryIllustration,
  achievements: AchievementsIllustration,
  photos: PhotosIllustration,
}

// ============================================================
// 主组件
// ============================================================
export default function EmptyStateIllustration({
  variant,
  title,
  description,
  action,
}: Props) {
  const Illustration = illustrations[variant]

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      {/* 插图 */}
      <div className="mb-6">
        <Illustration />
      </div>

      {/* 标题 */}
      <h3 className="font-heading text-lg font-medium text-brand-400 mb-2">
        {title}
      </h3>

      {/* 描述 */}
      {description && (
        <p className="text-sm text-brand-200 mb-6 text-center max-w-xs leading-relaxed">
          {description}
        </p>
      )}

      {/* CTA 按钮 */}
      {action && <div>{action}</div>}
    </div>
  )
}
