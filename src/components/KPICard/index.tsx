import React from 'react';
import { Link } from 'react-router-dom';

interface KPICardProps {
  title: string;
  value: string | number;
  suffix?: string;
  trend?: 'up' | 'down' | 'flat';
  trendLabel?: string;
  color?: string;
  icon?: React.ReactNode;
  sparklineData?: number[]; // 7日迷你趋势线数据
  tone?: 'growth' | 'progress' | 'pending' | 'risk' | 'memory' | 'photo';
  comparisonLabel?: string;
  href?: string;
}

const TONE_STYLES = {
  growth: { accent: '#10B981', shell: 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50/80', badge: 'bg-emerald-100 text-emerald-700' },
  progress: { accent: '#3B82F6', shell: 'border-blue-100 bg-gradient-to-br from-white to-blue-50/80', badge: 'bg-blue-100 text-blue-700' },
  pending: { accent: '#F59E0B', shell: 'border-amber-100 bg-gradient-to-br from-white to-amber-50/80', badge: 'bg-amber-100 text-amber-700' },
  risk: { accent: '#EF4444', shell: 'border-red-100 bg-gradient-to-br from-white to-red-50/80', badge: 'bg-red-100 text-red-700' },
  memory: { accent: '#8B5CF6', shell: 'border-violet-100 bg-gradient-to-br from-white to-violet-50/80', badge: 'bg-violet-100 text-violet-700' },
  photo: { accent: '#EC4899', shell: 'border-pink-100 bg-gradient-to-br from-white to-pink-50/80', badge: 'bg-pink-100 text-pink-700' },
} as const;

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  suffix,
  trend,
  trendLabel,
  color,
  icon,
  sparklineData,
  tone = 'progress',
  comparisonLabel,
  href,
}) => {
  const toneStyle = TONE_STYLES[tone]
  const resolvedColor = color || toneStyle.accent
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
  const card = (
    <div className={`h-full rounded-card border p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md ${toneStyle.shell}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-brand-300">{title}</span>
        {icon && (
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${resolvedColor}18` }}
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

      {comparisonLabel && (
        <div className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${toneStyle.badge}`}>
          {comparisonLabel}
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
              stroke={trend ? sparklineColor : resolvedColor}
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

  return href ? (
    <Link to={href} className="block h-full rounded-card focus:outline-none focus:ring-2 focus:ring-cyan-400/50">
      {card}
    </Link>
  ) : card
};

