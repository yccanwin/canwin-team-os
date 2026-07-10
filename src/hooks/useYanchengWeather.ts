import { useEffect, useState } from 'react'
import { loadYanchengWeather, type YanchengWeather } from '@/services/weather'

export function useYanchengWeather() {
  const [weather, setWeather] = useState<YanchengWeather | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadYanchengWeather()
      .then((data) => {
        if (!cancelled) {
          setWeather(data)
          setError('')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { weather, isLoading, error }
}
