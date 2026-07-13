import { useEffect, useRef } from 'react'

const GLYPHS = '01FANSHONTEAM<>/{}[]+=*#'

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let animationFrame = 0
    let columns: number[] = []
    let width = 0
    let height = 0
    const fontSize = 15

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      columns = Array.from({ length: Math.ceil(width / fontSize) }, () => Math.random() * -80)
      context.fillStyle = '#020705'
      context.fillRect(0, 0, width, height)
    }

    const draw = () => {
      context.fillStyle = 'rgba(2, 7, 5, 0.085)'
      context.fillRect(0, 0, width, height)
      context.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`

      columns.forEach((position, index) => {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        const x = index * fontSize
        const y = position * fontSize
        const isHead = Math.random() > 0.92
        context.fillStyle = isHead ? 'rgba(190, 255, 237, 0.9)' : 'rgba(0, 255, 153, 0.48)'
        context.shadowColor = isHead ? '#7fffd4' : '#00d98b'
        context.shadowBlur = isHead ? 8 : 2
        context.fillText(glyph, x, y)

        if (y > height && Math.random() > 0.975) columns[index] = Math.random() * -35
        else columns[index] = position + (reducedMotion ? 0.08 : 0.52)
      })

      context.shadowBlur = 0
      animationFrame = window.requestAnimationFrame(draw)
    }

    resize()
    if (!reducedMotion) draw()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [])

  return <canvas ref={canvasRef} className="matrix-rain-canvas" aria-hidden="true" />
}
