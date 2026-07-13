import { useState, useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  Clock,
  MapPin,
  Trash2,
  Pencil,
  X,
  User,
} from 'lucide-react'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useUserStore } from '@/stores/useUserStore'
import { useGoalStore } from '@/stores/useGoalStore'
import { usePersonalGoalStore } from '@/stores/usePersonalGoalStore'
import type { CalendarEvent } from '@/types/calendar'

// ============================================================
// 常量
// ============================================================
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const EVENT_COLORS = [
  '#6366F1', // 紫色 primary
  '#10B981', // 绿色 income
  '#EF4444', // 红色 expense
  '#3B82F6', // 蓝色 profit
  '#F59E0B', // 橙色
  '#8B5CF6', // 紫罗兰 cash
]
const TYPE_LABELS: Record<CalendarEvent['type'], string> = {
  rest_day: '休息',
  task_deadline: '任务截止',
  personal_goal_deadline: '个人目标',
  team_goal_deadline: '团队目标',
  visit: '外出拜访',
  store_check: '巡店',
  inventory_check: '仓库盘点',
  team_activity: '团队活动',
  finance_day: '财务日',
  schedule: '行程',
  task: '任务',
  meeting: '会议',
  other: '其他',
}

const REST_DAY_INDEX: Record<string, number> = {
  周日: 0,
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
}

// ============================================================
// 工具函数
// ============================================================
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function formatDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ============================================================
// 页面组件
// ============================================================
export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [showForm, setShowForm] = useState(false)

  // 表单状态
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formType, setFormType] = useState<CalendarEvent['type']>('schedule')
  const [formStartTime, setFormStartTime] = useState('')
  const [formEndTime, setFormEndTime] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formColor, setFormColor] = useState(EVENT_COLORS[0])

  // Store
  const events = useCalendarStore((s) => s.events)
  const tasks = useTaskStore((s) => s.tasks)
  const goals = useGoalStore((s) => s.goals)
  const personalGoals = usePersonalGoalStore((s) => s.personalGoals)
  const users = useUserStore((s) => s.users)
  const addEvent = useCalendarStore((s) => s.addEvent)
  const updateEvent = useCalendarStore((s) => s.updateEvent)
  const deleteEvent = useCalendarStore((s) => s.deleteEvent)
  const currentUser = useUserStore((s) => s.currentUser)

  // 当月数据
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const yearMonth = `${year}-${String(month + 1).padStart(2, '0')}`
  const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate())
  const todayRestUsers = useMemo(() => {
    const weekday = new Date(todayStr).getDay()
    return users.filter((user) =>
      (user.restDays ?? []).some((day) => REST_DAY_INDEX[day] === weekday)
    )
  }, [todayStr, users])
  const todayOnDutyUsers = useMemo(
    () => users.filter((user) => !todayRestUsers.some((restUser) => restUser.id === user.id)),
    [todayRestUsers, users]
  )

  // 当月事件按日期分组
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    const pushEvent = (dateKey: string, event: CalendarEvent) => {
      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(event)
    }

    events.forEach((e) => {
      // 跨日事件在每一天都显示
      if (e.endDate) {
        const start = new Date(e.startDate)
        const end = new Date(e.endDate)
        const curr = new Date(start)
        while (curr <= end) {
          const dateKey = formatDate(curr.getFullYear(), curr.getMonth(), curr.getDate())
          pushEvent(dateKey, e)
          curr.setDate(curr.getDate() + 1)
        }
      } else {
        pushEvent(e.startDate, e)
      }
    })

    users.forEach((user) => {
      ;(user.restDays ?? []).forEach((restDay) => {
        const weekday = REST_DAY_INDEX[restDay]
        if (weekday === undefined) return
        for (let day = 1; day <= daysInMonth; day++) {
          const dateKey = formatDate(year, month, day)
          if (new Date(dateKey).getDay() !== weekday) continue
          pushEvent(dateKey, {
            id: `rest-${user.id}-${dateKey}`,
            title: `${user.name} 休息`,
            startDate: dateKey,
            creatorId: user.id,
            creatorName: user.name,
            type: 'rest_day',
            color: '#F59E0B',
            createdAt: dateKey,
            description: '每周固定休息日',
          })
        }
      })
    })

    // 追加任务截止日
    tasks.filter((t) => t.deadline).forEach((t) => {
      const key = t.deadline!.slice(0, 10)
      pushEvent(key, {
        id: `task-${t.id}`,
        title: t.title,
        startDate: key,
        creatorId: t.assigneeId,
        creatorName: users.find((user) => user.id === t.assigneeId)?.name || '未分配',
        type: 'task_deadline',
        color: '#EF4444',
        createdAt: t.createdAt,
        description: t.description,
      })
    })

    goals.filter((goal) => goal.deadline).forEach((goal) => {
      const key = goal.deadline!
      pushEvent(key, {
        id: `team-goal-${goal.id}`,
        title: `团队目标：${goal.title}`,
        startDate: key,
        creatorId: currentUser?.id || '',
        creatorName: '团队目标',
        type: 'team_goal_deadline',
        color: '#10B981',
        createdAt: key,
        description: '团队目标截止日',
      })
    })

    personalGoals.filter((goal) => goal.deadline && goal.visibility === 'team').forEach((goal) => {
      const owner = users.find((user) => user.id === goal.userId)
      const key = goal.deadline!
      pushEvent(key, {
        id: `personal-goal-${goal.id}`,
        title: `个人目标：${goal.title}`,
        startDate: key,
        creatorId: goal.userId,
        creatorName: owner?.name || '成员',
        type: 'personal_goal_deadline',
        color: '#3B82F6',
        createdAt: goal.createdAt,
        description: '公开个人目标截止日',
      })
    })

    return map
  }, [currentUser?.id, daysInMonth, events, goals, month, personalGoals, tasks, users, year])

  // 选中日的事件列表
  const selectedEvents = selectedDate ? eventsByDate[selectedDate] || [] : []
  const mobileFocusDate = selectedDate || todayStr
  const mobileFocusEvents = eventsByDate[mobileFocusDate] || []
  const upcomingEvents = useMemo(() => {
    const result: Array<CalendarEvent & { dateKey: string }> = []
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(todayStr)
      date.setDate(date.getDate() + offset)
      const dateKey = formatDate(date.getFullYear(), date.getMonth(), date.getDate())
      ;(eventsByDate[dateKey] || []).forEach((event) => {
        result.push({ ...event, dateKey })
      })
    }
    return result.slice(0, 6)
  }, [eventsByDate, todayStr])

  // 导航
  const prevMonth = () => {
    if (month === 0) {
      setYear(year - 1)
      setMonth(11)
    } else {
      setMonth(month - 1)
    }
  }
  const nextMonth = () => {
    if (month === 11) {
      setYear(year + 1)
      setMonth(0)
    } else {
      setMonth(month + 1)
    }
  }

  // 打开新建表单
  const openNewForm = () => {
    if (!currentUser) return
    setEditingEvent(null)
    const date = selectedDate || formatDate(today.getFullYear(), today.getMonth(), today.getDate())
    setFormTitle('')
    setFormDesc('')
    setFormType('schedule')
    setFormStartTime('')
    setFormEndTime('')
    setFormEndDate('')
    setFormColor(EVENT_COLORS[0])
    setSelectedDate(date)
    setShowForm(true)
  }

  // 打开编辑表单
  const openEditForm = (event: CalendarEvent) => {
    setEditingEvent(event)
    setFormTitle(event.title)
    setFormDesc(event.description || '')
    setFormType(event.type)
    setFormStartTime(event.startTime || '')
    setFormEndTime(event.endTime || '')
    setFormEndDate(event.endDate || '')
    setFormColor(event.color || EVENT_COLORS[0])
    setShowForm(true)
  }

  // 提交表单
  const handleSubmit = () => {
    if (!formTitle.trim() || !currentUser) return
    const baseDate = selectedDate || formatDate(today.getFullYear(), today.getMonth(), today.getDate())

    const payload = {
      title: formTitle.trim(),
      description: formDesc.trim() || undefined,
      startDate: baseDate,
      endDate: formEndDate || undefined,
      startTime: formStartTime || undefined,
      endTime: formEndTime || undefined,
      creatorId: currentUser.id,
      creatorName: currentUser.name,
      color: formColor,
      type: formType,
    }

    if (editingEvent) {
      updateEvent(editingEvent.id, payload)
    } else {
      addEvent(payload)
    }

    setShowForm(false)
    setEditingEvent(null)
  }

  // 删除事件
  const handleDelete = (id: string) => {
    deleteEvent(id)
    setShowForm(false)
    setEditingEvent(null)
  }

  // 今天按钮
  const goToday = () => {
    const now = new Date()
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setSelectedDate(formatDate(now.getFullYear(), now.getMonth(), now.getDate()))
  }

  // 渲染日期格
  const totalCells = firstDay + daysInMonth
  const rows = Math.ceil(totalCells / 7)
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="max-w-6xl mx-auto">
      {/* 页面标题 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-400 font-heading">日历中心</h1>
          <p className="mt-1 text-sm text-brand-300">
            今日在岗 {todayOnDutyUsers.length} 人 · 休息 {todayRestUsers.length} 人
          </p>
        </div>
        <button
          onClick={openNewForm}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
          disabled={!currentUser}
        >
          <Plus className="w-4 h-4" />
          新建行程
        </button>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
          <p className="text-xs font-medium text-emerald-700">今日在岗</p>
          <p className="mt-2 text-sm text-emerald-900">
            {todayOnDutyUsers.length > 0 ? todayOnDutyUsers.map((user) => user.name).join('、') : '暂无成员资料'}
          </p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4">
          <p className="text-xs font-medium text-amber-700">今日休息</p>
          <p className="mt-2 text-sm text-amber-900">
            {todayRestUsers.length > 0 ? todayRestUsers.map((user) => user.name).join('、') : '无人休息'}
          </p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
          <p className="text-xs font-medium text-blue-700">自动联动</p>
          <p className="mt-2 text-sm text-blue-900">休息日、任务截止日、团队目标和公开个人目标截止日会自动显示。</p>
        </div>
      </div>

      <div className="mb-4 space-y-3 sm:hidden">
        <section className="rounded-xl border border-brand-100 bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold text-brand-400">
                {mobileFocusDate === todayStr ? '今天要知道' : mobileFocusDate}
              </h2>
              <p className="mt-0.5 text-xs text-brand-200">
                在岗 {todayOnDutyUsers.length} 人 · 休息 {todayRestUsers.length} 人
              </p>
            </div>
            <button
              onClick={openNewForm}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white"
              disabled={!currentUser}
            >
              新建
            </button>
          </div>
          {mobileFocusEvents.length ? (
            <div className="space-y-2">
              {mobileFocusEvents.slice(0, 4).map((event) => (
                <button
                  key={event.id}
                  onClick={() => {
                    const isDerived = event.type === 'task_deadline' || event.type === 'team_goal_deadline' || event.type === 'personal_goal_deadline' || event.type === 'rest_day'
                    if (!isDerived) openEditForm(event)
                  }}
                  className="w-full rounded-lg bg-brand-50 px-3 py-2 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-brand-400">{event.title}</span>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-brand-300">
                      {TYPE_LABELS[event.type]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-brand-200">{event.creatorName}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand-200">今天暂无安排</p>
          )}
        </section>

        <section className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
          <h2 className="font-heading text-sm font-semibold text-blue-900">未来 7 天</h2>
          {upcomingEvents.length ? (
            <div className="mt-3 space-y-2">
              {upcomingEvents.map((event) => (
                <div key={`${event.dateKey}-${event.id}`} className="flex items-start justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-medium text-blue-950">{event.title}</p>
                    <p className="mt-0.5 text-xs text-blue-700">{event.dateKey} · {TYPE_LABELS[event.type]}</p>
                  </div>
                  <span className="shrink-0 text-xs text-blue-700">{event.creatorName}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-blue-800">未来 7 天暂无自动联动事项</p>
          )}
        </section>
      </div>

      {/* 主布局：日历 + 侧边详情 */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* 左侧日历 */}
        <div className="flex-1 bg-white rounded-xl shadow-card border border-brand-100 overflow-hidden">
          {/* 月份导航 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-brand-100">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-brand-50 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-brand-400" />
            </button>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-brand-400 font-heading">
                {year}年 {month + 1}月
              </h2>
              <button
                onClick={goToday}
                className="text-xs px-2.5 py-1 rounded-full border border-brand-100 text-brand-300 hover:bg-brand-50 transition-colors"
              >
                今天
              </button>
            </div>
            <button
              onClick={nextMonth}
              className="p-1.5 rounded-lg hover:bg-brand-50 transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-brand-400" />
            </button>
          </div>

          {/* 星期头 */}
          <div className="grid grid-cols-7 border-b border-brand-100">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={`py-2 text-center text-xs font-medium ${
                  i === 0 || i === 6 ? 'text-red-400' : 'text-brand-200'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* 日期网格 */}
          <div
            className="grid grid-cols-7"
            style={{ gridTemplateRows: `repeat(${rows}, minmax(64px, 1fr))` }}
          >
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="border-b border-r border-brand-100/50 bg-brand-50/30" />
              }

              const dateStr = formatDate(year, month, day)
              const isToday = dateStr === todayStr
              const isSelected = dateStr === selectedDate
              const dayEvents = eventsByDate[dateStr] || []

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`
                    border-b border-r border-brand-100/50 p-1.5 text-left
                    transition-colors hover:bg-primary/[0.03]
                    ${isSelected ? 'bg-primary/[0.06] ring-1 ring-inset ring-primary/20' : ''}
                  `}
                >
                  <span
                    className={`
                      inline-flex items-center justify-center w-7 h-7 rounded-full text-sm
                      ${isToday ? 'bg-primary text-white font-bold' : 'text-brand-400'}
                    `}
                  >
                    {day}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        className="truncate rounded px-1.5 py-px text-[10px] text-white leading-tight"
                        style={{ backgroundColor: ev.color || EVENT_COLORS[0] }}
                        title={ev.title}
                      >
                        {ev.startTime ? `${ev.startTime} ` : ''}{ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-brand-200 pl-1.5">
                        +{dayEvents.length - 3} 项
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 右侧事件详情 */}
        <div className="w-full lg:w-72 shrink-0">
          <div className="bg-white rounded-xl shadow-card border border-brand-100 p-4">
            {selectedDate ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-brand-400 font-heading">
                    <CalendarDays className="w-4 h-4 inline mr-1.5 text-primary" />
                    {selectedDate}
                  </h3>
                  <button
                    onClick={openNewForm}
                    className="p-1 rounded-lg hover:bg-brand-50 transition-colors"
                    title="新建事件"
                  >
                    <Plus className="w-4 h-4 text-primary" />
                  </button>
                </div>

                {selectedEvents.length === 0 ? (
                  <p className="text-sm text-brand-200 py-4 text-center">暂无行程安排</p>
                ) : (
                  <div className="space-y-2">
                    {selectedEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-lg border border-brand-100 p-3 hover:border-brand-200 transition-colors cursor-pointer"
                        onClick={() => {
                          const isDerived = ev.type === 'task_deadline' || ev.type === 'team_goal_deadline' || ev.type === 'personal_goal_deadline' || ev.type === 'rest_day'
                          if (!isDerived) openEditForm(ev)
                        }}
                        style={{ borderLeftColor: ev.color || EVENT_COLORS[0], borderLeftWidth: 3 }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-brand-400">{ev.title}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-200 shrink-0">
                            {TYPE_LABELS[ev.type]}
                          </span>
                        </div>
                        {(ev.startTime || ev.endTime) && (
                          <div className="flex items-center gap-1 mt-1.5 text-xs text-brand-200">
                            <Clock className="w-3 h-3" />
                            {ev.startTime || '--'} ~ {ev.endTime || '--'}
                          </div>
                        )}
                        {ev.endDate && ev.endDate !== ev.startDate && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-brand-200">
                            <CalendarDays className="w-3 h-3" />
                            {ev.startDate} → {ev.endDate}
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-brand-200">
                          <User className="w-3 h-3" />
                          {ev.creatorName}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-brand-200 py-4 text-center">点击日期查看行程</p>
            )}
          </div>
        </div>
      </div>

      {/* 新建/编辑弹窗 */}
      {showForm && currentUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setShowForm(false)
              setEditingEvent(null)
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl px-6 py-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            {/* 头部 */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-heading text-lg font-bold text-brand-400">
                {editingEvent ? '编辑行程' : '新建行程'}
              </h3>
              <button
                onClick={() => {
                  setShowForm(false)
                  setEditingEvent(null)
                }}
                className="p-1 rounded-lg hover:bg-brand-50 transition-colors"
              >
                <X className="w-5 h-5 text-brand-300" />
              </button>
            </div>

            {/* 表单 */}
            <div className="space-y-4">
              {/* 标题 */}
              <div>
                <label className="block text-sm font-medium text-brand-400 mb-1">标题 *</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="如：团队周会、客户拜访"
                  className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  autoFocus
                />
              </div>

              {/* 类型 + 颜色 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-brand-400 mb-1">类型</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as CalendarEvent['type'])}
                    className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="visit">外出拜访</option>
                    <option value="store_check">巡店</option>
                    <option value="inventory_check">仓库盘点</option>
                    <option value="team_activity">团队活动</option>
                    <option value="finance_day">财务结算日</option>
                    <option value="meeting">会议</option>
                    <option value="schedule">普通行程</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-brand-400 mb-1">颜色</label>
                  <div className="flex items-center gap-1.5 pt-1.5">
                    {EVENT_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setFormColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          formColor === c ? 'border-brand-400 scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium text-brand-400 mb-1">描述</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="补充说明..."
                  rows={2}
                  className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
                />
              </div>

              {/* 时间 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-brand-400 mb-1">开始时间</label>
                  <input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-brand-400 mb-1">结束时间</label>
                  <input
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
              </div>

              {/* 结束日期（跨日事件） */}
              <div>
                <label className="block text-sm font-medium text-brand-400 mb-1">结束日期（可选，跨日时填写）</label>
                <input
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
            </div>

            {/* 按钮 */}
            <div className="flex gap-2 mt-6">
              {editingEvent && (
                <button
                  onClick={() => handleDelete(editingEvent.id)}
                  className="px-4 py-2 text-sm font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  删除
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => {
                  setShowForm(false)
                  setEditingEvent(null)
                }}
                className="px-4 py-2 text-sm font-medium text-brand-400 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!formTitle.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingEvent ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
