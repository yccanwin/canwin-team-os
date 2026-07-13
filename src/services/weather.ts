export interface YanchengWeather {
  location: string
  temperature: number | null
  weatherText: string
  maxTemperature: number | null
  minTemperature: number | null
  rainProbability: number | null
  rainAmount: number | null
  nextRainTime?: string
  advisory: string
  updatedAt: string
}

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number
    weather_code?: number
  }
  hourly?: {
    time?: string[]
    precipitation?: number[]
    precipitation_probability?: number[]
  }
  daily?: {
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_sum?: number[]
    precipitation_probability_max?: number[]
  }
}

const YANCHENG_LATITUDE = 33.35
const YANCHENG_LONGITUDE = 120.16
const WEATHER_CACHE_KEY = 'canwin-yancheng-weather'
const WEATHER_CACHE_TTL_MS = 6 * 60 * 60 * 1000

function weatherCodeText(code?: number): string {
  if (code === undefined) return '天气更新中'
  if (code === 0) return '晴'
  if ([1, 2, 3].includes(code)) return '多云'
  if ([45, 48].includes(code)) return '有雾'
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '有雨'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '有雪'
  if ([95, 96, 99].includes(code)) return '雷阵雨'
  return '天气变化'
}

function readCachedWeather(): YanchengWeather | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as YanchengWeather
    if (Date.now() - new Date(parsed.updatedAt).getTime() > WEATHER_CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedWeather(weather: YanchengWeather) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather))
  } catch {
    // Cache is optional.
  }
}

function formatRainTime(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  const today = new Date().toDateString() === date.toDateString()
  return `${today ? '今天' : '明天'} ${String(date.getHours()).padStart(2, '0')}:00`
}

function buildAdvisory(rainProbability: number | null, rainAmount: number | null, nextRainTime?: string): string {
  if (nextRainTime) return `${nextRainTime} 可能下雨，外出拜访和实施记得带伞。`
  if ((rainProbability ?? 0) >= 50 || (rainAmount ?? 0) > 0) return '今天有降雨概率，外勤安排注意留出路上时间。'
  return '今天降雨风险不高，适合外出拜访和实施。'
}

export async function loadYanchengWeather(): Promise<YanchengWeather> {
  const cached = readCachedWeather()
  if (cached) return cached

  const params = new URLSearchParams({
    latitude: String(YANCHENG_LATITUDE),
    longitude: String(YANCHENG_LONGITUDE),
    timezone: 'Asia/Shanghai',
    forecast_days: '2',
    current: 'temperature_2m,weather_code',
    hourly: 'precipitation,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
  })

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
  if (!response.ok) throw new Error(`Weather request failed: ${response.status}`)
  const data = (await response.json()) as OpenMeteoResponse
  const now = new Date()
  const hourlyTimes = data.hourly?.time ?? []
  const hourlyRain = data.hourly?.precipitation ?? []
  const hourlyProbability = data.hourly?.precipitation_probability ?? []
  const nextRainIndex = hourlyTimes.findIndex((time, index) => {
    const forecastTime = new Date(time)
    if (forecastTime.getTime() < now.getTime()) return false
    return (hourlyRain[index] ?? 0) > 0 || (hourlyProbability[index] ?? 0) >= 60
  })
  const nextRainTime = nextRainIndex >= 0 ? formatRainTime(hourlyTimes[nextRainIndex]) : undefined

  const weather: YanchengWeather = {
    location: '江苏盐城',
    temperature: data.current?.temperature_2m ?? null,
    weatherText: weatherCodeText(data.current?.weather_code),
    maxTemperature: data.daily?.temperature_2m_max?.[0] ?? null,
    minTemperature: data.daily?.temperature_2m_min?.[0] ?? null,
    rainProbability: data.daily?.precipitation_probability_max?.[0] ?? null,
    rainAmount: data.daily?.precipitation_sum?.[0] ?? null,
    nextRainTime,
    advisory: buildAdvisory(
      data.daily?.precipitation_probability_max?.[0] ?? null,
      data.daily?.precipitation_sum?.[0] ?? null,
      nextRainTime
    ),
    updatedAt: new Date().toISOString(),
  }

  writeCachedWeather(weather)
  return weather
}
