import { useState } from 'react'
import { useUserStore } from '@/stores/useUserStore'
import { Coffee, Heart, AlertTriangle, Pencil, X, Check, MessageCircle, NotebookText } from 'lucide-react'
import { updateProfileRecord } from '@/services/profile'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export default function PersonalInfoCard() {
  const currentUser = useUserStore((s) => s.currentUser)
  const updateUser = useUserStore((s) => s.updateUser)

  const [editing, setEditing] = useState(false)
  const [restDays, setRestDays] = useState<string[]>(currentUser.restDays ?? [])
  const [communicationPreference, setCommunicationPreference] = useState(currentUser.communicationPreference ?? '')
  const [mood, setMood] = useState(currentUser.mood ?? '')
  const [taboos, setTaboos] = useState(currentUser.taboos ?? '')
  const [notes, setNotes] = useState(currentUser.notes ?? '')

  const toggleRestDay = (day: string) => {
    setRestDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  const handleSave = () => {
    updateUser(currentUser.id, { restDays, communicationPreference, mood, taboos, notes })
    void updateProfileRecord(currentUser.id, { restDays, communicationPreference, mood, taboos, notes }).catch(() => {
      updateUser(currentUser.id, {
        restDays: currentUser.restDays,
        communicationPreference: currentUser.communicationPreference,
        mood: currentUser.mood,
        taboos: currentUser.taboos,
        notes: currentUser.notes,
      })
    })
    setEditing(false)
  }

  const handleCancel = () => {
    setRestDays(currentUser.restDays ?? [])
    setCommunicationPreference(currentUser.communicationPreference ?? '')
    setMood(currentUser.mood ?? '')
    setTaboos(currentUser.taboos ?? '')
    setNotes(currentUser.notes ?? '')
    setEditing(false)
  }

  // 没有编辑过任何信息时，显示空状态
  const hasContent =
    (currentUser.restDays?.length ?? 0) > 0 ||
    currentUser.communicationPreference ||
    currentUser.mood ||
    currentUser.taboos ||
    currentUser.notes

  return (
    <div className="bg-white rounded-card shadow-card p-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-semibold text-brand-400">
          个人资料卡
        </h3>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            编辑
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-200 hover:text-brand-400 hover:bg-brand-50 rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              取消
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              保存
            </button>
          </div>
        )}
      </div>

      {/* 无内容空状态 */}
      {!hasContent && !editing && (
        <div className="text-center py-6 text-brand-200 text-sm">
          还没有填写个人资料，点击「编辑」让团队更了解你 😊
        </div>
      )}

      {/* ====== 休息日 ====== */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Coffee className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-brand-400">每周休息日</span>
        </div>
        {editing ? (
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <button
                key={day}
                onClick={() => toggleRestDay(day)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  restDays.includes(day)
                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                    : 'bg-brand-50 text-brand-200 border border-brand-100 hover:border-amber-200 hover:text-amber-600'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        ) : currentUser.restDays && currentUser.restDays.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {currentUser.restDays.map((day) => (
              <span
                key={day}
                className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-md text-xs font-medium"
              >
                {day}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-brand-200">未设置</p>
        )}
      </div>

      {/* ====== 沟通偏好 ====== */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <MessageCircle className="w-4 h-4 text-sky-500" />
          <span className="text-sm font-medium text-brand-400">沟通偏好</span>
        </div>
        {editing ? (
          <input
            type="text"
            value={communicationPreference}
            onChange={(e) => setCommunicationPreference(e.target.value)}
            placeholder="比如：微信文字优先 / 急事电话 / 下午集中回复..."
            maxLength={120}
            className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 placeholder:text-brand-200/60"
          />
        ) : currentUser.communicationPreference ? (
          <p className="text-sm text-brand-300 bg-sky-50/60 rounded-lg px-3 py-2">
            {currentUser.communicationPreference}
          </p>
        ) : (
          <p className="text-xs text-brand-200">未设置</p>
        )}
      </div>

      {/* ====== 最近心情 ====== */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Heart className="w-4 h-4 text-rose-500" />
          <span className="text-sm font-medium text-brand-400">最近心情</span>
        </div>
        {editing ? (
          <input
            type="text"
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            placeholder="比如：干劲满满 / 有点累但还能冲 / 在学新东西..."
            maxLength={100}
            className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 placeholder:text-brand-200/60"
          />
        ) : currentUser.mood ? (
          <p className="text-sm text-brand-300 bg-rose-50/50 rounded-lg px-3 py-2">
            {currentUser.mood}
          </p>
        ) : (
          <p className="text-xs text-brand-200">未设置</p>
        )}
      </div>

      {/* ====== 个人忌讳 ====== */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-medium text-brand-400">忌讳 / 注意事项</span>
        </div>
        {editing ? (
          <textarea
            value={taboos}
            onChange={(e) => setTaboos(e.target.value)}
            placeholder="比如：不吃香菜、上午10点前不打电话、开会别突然cue我..."
            maxLength={200}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 placeholder:text-brand-200/60 resize-none"
          />
        ) : currentUser.taboos ? (
          <p className="text-sm text-brand-300 whitespace-pre-wrap bg-orange-50/50 rounded-lg px-3 py-2">
            {currentUser.taboos}
          </p>
        ) : (
          <p className="text-xs text-brand-200">未设置</p>
        )}
      </div>

      {/* ====== 协作备注 ====== */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <NotebookText className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-medium text-brand-400">协作备注</span>
        </div>
        {editing ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="比如：当前重点项目、适合协作的时间段、需要团队配合的地方..."
            maxLength={240}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 placeholder:text-brand-200/60 resize-none"
          />
        ) : currentUser.notes ? (
          <p className="text-sm text-brand-300 whitespace-pre-wrap bg-emerald-50/50 rounded-lg px-3 py-2">
            {currentUser.notes}
          </p>
        ) : (
          <p className="text-xs text-brand-200">未设置</p>
        )}
      </div>
    </div>
  )
}
