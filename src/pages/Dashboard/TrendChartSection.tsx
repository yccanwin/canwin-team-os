import { memo } from 'react'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { TaskStatusChart } from '@/components/charts/TaskStatusChart'

const TrendChartSection = memo(function TrendChartSection() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <RevenueTrendChart />
      <TaskStatusChart />
    </div>
  )
})

export default TrendChartSection
