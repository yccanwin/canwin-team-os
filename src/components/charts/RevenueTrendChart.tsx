import { useMemo, memo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useFinanceStore } from '@/stores/useFinanceStore'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ═══════════════════════════════════════════════════════════
// 自定义插件
// ═══════════════════════════════════════════════════════════

/** 折线图渐变填充插件：收入绿 → 透明，支出红 → 透明 */
const gradientPlugin = {
  id: 'revenueGradient',
  beforeDraw(chart: any) {
    const { ctx, chartArea } = chart
    if (!chartArea) return
    const bottom = chartArea.bottom

    const incomeGrad = ctx.createLinearGradient(0, chartArea.top, 0, bottom)
    incomeGrad.addColorStop(0, 'rgba(16, 185, 129, 0.25)')
    incomeGrad.addColorStop(1, 'rgba(16, 185, 129, 0)')

    const expenseGrad = ctx.createLinearGradient(0, chartArea.top, 0, bottom)
    expenseGrad.addColorStop(0, 'rgba(239, 68, 68, 0.18)')
    expenseGrad.addColorStop(1, 'rgba(239, 68, 68, 0)')

    ;(chart.getDatasetMeta(0).dataset as any).backgroundColor = incomeGrad
    ;(chart.getDatasetMeta(1).dataset as any).backgroundColor = expenseGrad
  },
}

/** 为 Canvas tooltip 绘制圆角矩形 + 投影 */
const tooltipShadowPlugin = {
  id: 'tooltipShadow-line',
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

const CHART_COLORS = {
  income: '#10B981',
  expense: '#EF4444',
  grid: '#E2E8F0',
  border: '#CBD5E1',
  primary: '#6366F1',
}

export const RevenueTrendChart = memo(function RevenueTrendChart() {
  const records = useFinanceStore((s) => s.records)

  const data = useMemo(() => {
    // 最近6个月
    const months: string[] = []
    const incomeByMonth: number[] = []
    const expenseByMonth: number[] = []

    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const label = `${d.getMonth() + 1}月`
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

      months.push(label)
      incomeByMonth.push(
        records.filter((r) => r.type === 'income' && r.date.startsWith(prefix))
          .reduce((s, r) => s + r.amount, 0)
      )
      expenseByMonth.push(
        records.filter((r) => r.type === 'expense' && r.date.startsWith(prefix))
          .reduce((s, r) => s + r.amount, 0)
      )
    }

    return { months, incomeByMonth, expenseByMonth }
  }, [records])

  const chartData = {
    labels: data.months,
    datasets: [
      {
        label: '收入',
        data: data.incomeByMonth,
        borderColor: CHART_COLORS.income,
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.income,
        tension: 0.3,
        fill: true,
        // backgroundColor 由 gradientPlugin 动态注入
      },
      {
        label: '支出',
        data: data.expenseByMonth,
        borderColor: CHART_COLORS.expense,
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.expense,
        tension: 0.3,
        fill: true,
        // backgroundColor 由 gradientPlugin 动态注入
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          usePointStyle: true,
          padding: 20,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: '#FFFFFF',
        titleColor: CHART_COLORS.primary,
        bodyColor: '#334155',
        borderColor: CHART_COLORS.primary,
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: true,
        boxPadding: 4,
        padding: 12,
        titleFont: { size: 13, weight: 'bold' as const },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx: any) => {
            return ` ${ctx.dataset.label}: ¥${ctx.parsed.y.toLocaleString()}`
          },
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: (v: any) => `¥${(v / 10000).toFixed(1)}万`,
          font: { size: 11 },
          maxTicksLimit: 4,
        },
        grid: {
          color: CHART_COLORS.grid,
          drawTicks: false,
        },
        border: { color: CHART_COLORS.border, dash: [4, 4] },
      },
      x: {
        grid: { display: false },
        border: { color: CHART_COLORS.border },
      },
    },
  }

  return (
    <div className="bg-white rounded-card shadow-card p-5">
      <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">月度收支趋势</h3>
      <div className="h-[280px]">
        <Line data={chartData} options={options} plugins={[gradientPlugin, tooltipShadowPlugin]} />
      </div>
    </div>
  )
})

export default RevenueTrendChart
