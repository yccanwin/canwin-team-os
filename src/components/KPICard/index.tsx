import React from 'react';

interface KPICardProps {
  title: string;
  value: string | number;
  suffix?: string;
  trend?: 'up' | 'down' | 'flat';
  trendLabel?: string;
  color?: string;
  icon?: React.ReactNode;
  sparklineData?: number[]; // 7日迷你趋势线数据
}

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  suffix,
  trend,
  trendLabel,
  color = '#6366F1',
  icon,
  sparklineData,
}) => {
  // 迷你折线颜色：涨绿跌红平灰
  const sparklineColor =
    trend === 'up' ? '#10B981' : trend === 'down' ? '#EF4444' : '#9CA3AF'

  // 计算 SVG polyline points
  const polylinePoints = (() => {
    if (!sparklineData || sparklineData.length < 2) return ''
    const w = 80
    const h = 24
    const pad = 2
    const max = Math.max(...sparklineData, 1)
    const min = Math.min(...sparklineData, 0)
    const range = max - min || 1
    return sparklineData
      .map((v, i) => {
        const x = pad + (i / (sparklineData.length - 1)) * (w - pad * 2)
        const y = h - pad - ((v - min) / range) * (h - pad * 2)
        return `${x},${y}`
      })
      .join(' ')
  })()
  return (
    <div className="bg-white rounded-card shadow-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-brand-300">{title}</span>
        {icon && (
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${color}15` }}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-brand-400">
          {value}
        </span>
        {suffix && (
          <span className="text-sm text-brand-200">{suffix}</span>
        )}
      </div>

      {trend && trendLabel && (
        <div className="flex items-center gap-1 mt-2">
          <span
            className={`text-xs font-medium ${
              trend === 'up'
                ? 'text-income'
                : trend === 'down'
                ? 'text-expense'
                : 'text-brand-200'
            }`}
          >
            {trendLabel}
          </span>
        </div>
      )}

      {/* 7日迷你趋势线 */}
      {sparklineData && sparklineData.length >= 2 && (
        <div className="mt-3">
          <svg
            width="100%"
            height="24"
            viewBox="0 0 80 24"
            preserveAspectRatio="none"
            aria-label={`${title} 7日趋势`}
          >
            <polyline
              fill="none"
              stroke={sparklineColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polylinePoints}
            />
          </svg>
        </div>
      )}
    </div>
  );
};
