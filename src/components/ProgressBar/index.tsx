interface ProgressBarProps {
  label?: string;
  progress: number; // 0-100 或 0-1
  color?: string;
  height?: number;
  showPercent?: boolean;
}

export default function ProgressBar({
  label,
  progress,
  color = '#6366F1',
  height = 8,
  showPercent = true,
}: ProgressBarProps) {
  // 自动识别：如果 progress > 1 则认为是 0-100，否则 0-1
  const pct = progress > 1 ? Math.min(progress, 100) : Math.min(progress * 100, 100);

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="flex justify-between items-center mb-1.5">
          {label && <span className="text-xs text-brand-300">{label}</span>}
          {showPercent && <span className="text-xs font-medium text-brand-400">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className="w-full bg-gray-100 rounded-full overflow-hidden"
        style={{ height: `${height}px` }}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
