import { useState, useEffect, useRef } from 'react'

/**
 * 数字滚动 Hook
 * 使用 requestAnimationFrame + ease-out-quart 缓动实现平滑计数
 * @param end   目标数值
 * @param duration 动画时长 (ms)，默认 800
 * @returns 当前动画帧的数值
 */
export function useCountUp(end: number, duration: number = 800): number {
  const [current, setCurrent] = useState(0)
  const frameRef = useRef<number>()
  const startValueRef = useRef(0)

  useEffect(() => {
    const startValue = startValueRef.current
    const range = end - startValue

    if (range === 0) return

    const startTime = performance.now()

    function animate(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out-quart: 1 - (1-t)^4
      const eased = 1 - (1 - progress) ** 4
      const value = startValue + range * eased

      setCurrent(Math.round(value))

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      } else {
        startValueRef.current = end
      }
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [end, duration])

  return current
}
