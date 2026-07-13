import { useMemo, memo } from 'react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { useTaskStore } from '@/stores/useTaskStore'

ChartJS.register(ArcElement, Tooltip, Legend)

// ═══════════════════════════════════════════════════════════
// 自定义插件
// ═══════════════════════════════════════════════════════════

/** 环形图中心文字插件：显示完成率 */
const centerTextPlugin = {
  id: 'centerText',
  afterDraw(chart: any) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const total = (chart.data.datasets[0].data as number[]).reduce((a: number, b: number) => a + b, 0)
    const done = (chart.data.datasets[0].data as number[])[2] // index 2 = done
    const pct = total > 0 ? Math.round((done / total) * 100) : 0

    const cx = chartArea.left + chartArea.width / 2
    const cy = chartArea.top + chartArea.height / 2

    ctx.save()
    ctx.font = 'bold 28px Inter, system-ui, sans-serif'
    ctx.fillStyle = '#1E293B'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${pct}%`, cx, cy - 8)

    ctx.font = '12px Inter, system-ui, sans-serif'
    ctx.fillStyle = '#94A3B8'
    ctx.fillText('完成率', cx, cy + 16)
    ctx.restore()
  },
}

/** Canvas tooltip 圆角 + 投影 */
const tooltipShadowPlugin = {
  id: 'tooltipShadow-doughnut',
  beforeTooltipDraw(chart: any) {
    const { tooltip, ctx } = chart
    if (!tooltip || !tooltip.opacity) return
    const { x, y, width, height } = tooltip
    const r = 8
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.10)'
    ctx.shadowBlur = 14
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 3
    ctx.fillStyle = 'rgba(255,255,255,0.01)'
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + width - r, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + r)
    ctx.lineTo(x + width, y + height - r)
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    ctx.lineTo(x + r, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  },
}

const PRIMARY_COLOR = '#6366F1'

const CHART_COLORS = {
  todo: '#94A3B8',
  in_progress: '#3B82F6',
  done: '#10B981',
}

const STATUS_LABELS: Record<string, string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
}

export const TaskStatusChart = memo(function TaskStatusChart() {
  const tasks = useTaskStore((s) => s.tasks)

  const stats = useMemo(() => {
    const counts = { todo: 0, in_progress: 0, done: 0 }
    tasks.forEach((t) => {
      if (t.status in counts) {
        counts[t.status as keyof typeof counts]++
      }
    })
    return counts
  }, [tasks])

  const chartData = {
    labels: ['待办', '进行中', '已完成'],
    datasets: [
      {
        data: [stats.todo, stats.in_progress, stats.done],
        backgroundColor: [CHART_COLORS.todo, CHART_COLORS.in_progress, CHART_COLORS.done],
        borderWidth: 0,
        borderRadius: 6,
        hoverOffset: 6,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          usePointStyle: true,
          padding: 16,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: '#FFFFFF',
        titleColor: PRIMARY_COLOR,
        bodyColor: '#334155',
        borderColor: PRIMARY_COLOR,
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: true,
        boxPadding: 4,
        padding: 12,
        titleFont: { size: 13, weight: 'bold' as const },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx: any) => {
            const total = tasks.length
            const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0
            return ` ${ctx.label}: ${ctx.parsed} 个 (${pct}%)`
          },
        },
      },
    },
  }

  const statusItems = [
    { key: 'todo', label: '待办', count: stats.todo, color: CHART_COLORS.todo },
    { key: 'in_progress', label: '进行中', count: stats.in_progress, color: CHART_COLORS.in_progress },
    { key: 'done', label: '已完成', count: stats.done, color: CHART_COLORS.done },
  ]

  return (
    <div className="bg-white rounded-card shadow-card p-5">
      <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">任务状态分布</h3>
      <div className="h-[220px]">
        <Doughnut data={chartData} options={options} plugins={[centerTextPlugin, tooltipShadowPlugin]} />
      </div>
      {/* 图例下方统计 */}
      <div className="flex justify-center gap-6 mt-2">
        {statusItems.map((item) => (
          <div key={item.key} className="text-center">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-xs text-brand-300">{item.label}</span>
            </div>
            <span className="text-sm font-semibold text-brand-400">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export default TaskStatusChart
