import { cn } from '#/lib/utils.ts'
import { entityName, formatState, moreInfo, runAction, type TileEnv } from '#/tiles/actions.ts'
import { useTileGestures } from '#/tiles/gestures.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Icon } from '#/tiles/Icon.tsx'
import { defaultIcon } from '#/tiles/icons.ts'
import type { HomeAssistant } from '#/types.ts'
import { useEffect, useState } from 'react'

type Forecast = {
  datetime: string
  condition?: string
  temperature?: number
  templow?: number
  is_daytime?: boolean
}
export type Kind = 'hourly' | 'daily'

// The forecasts a weather entity offers, as Home Assistant numbers them.
const DAILY = 1
const HOURLY = 2

// How many steps of the forecast fit along the bottom of the tile.
const STEPS = 6

// The sky behind the tile, by the weather and whether the sun is up.
const SKIES: Record<string, string> = {
  day: 'linear-gradient(180deg, #2c5a9c 0%, #4f7dbd 100%)',
  night: 'linear-gradient(180deg, #13244a 0%, #2a4677 100%)',
  cloudy: 'linear-gradient(180deg, #2c5a9c 0%, #4f7dbd 100%)',
  cloudyNight: 'linear-gradient(180deg, #1c2a45 0%, #344a6e 100%)',
  rain: 'linear-gradient(180deg, #3c4a5c 0%, #66768a 100%)',
  storm: 'linear-gradient(180deg, #232836 0%, #474e63 100%)',
}

function sky(condition: string | undefined, night: boolean) {
  switch (condition) {
    case 'cloudy':
    case 'fog':
      return night ? SKIES.cloudyNight : SKIES.cloudy
    case 'rainy':
    case 'pouring':
    case 'snowy':
    case 'snowy-rainy':
    case 'hail':
      return night ? SKIES.storm : SKIES.rain
    case 'lightning':
    case 'lightning-rainy':
      return SKIES.storm
    case 'clear-night':
      return SKIES.night
    default:
      return night ? SKIES.night : SKIES.day
  }
}

// The forecast of one kind, kept up to date for as long as the tile shows.
function useForecast(hass: HomeAssistant, entityId: string | undefined, kind: Kind | null) {
  const [forecast, setForecast] = useState<Forecast[] | null>(null)
  const connection = hass.connection
  useEffect(() => {
    if (!entityId || !kind || !connection) return
    let unsubscribe: (() => void) | undefined
    let live = true
    connection
      .subscribeMessage<{ forecast?: Forecast[] }>(event => live && setForecast(event.forecast ?? null), {
        type: 'weather/subscribe_forecast',
        entity_id: entityId,
        forecast_type: kind,
      })
      .then(stop => (live ? (unsubscribe = stop) : stop()))
      .catch(() => {})
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [connection, entityId, kind])
  return forecast
}

// Whole degrees with a degree sign and no unit, like 21°.
const degrees = (value: number | undefined) => (typeof value === 'number' ? `${Math.round(value)}°` : '')

// How a condition looks at night: a clear sky shows the moon, and a partly
// cloudy one the moon behind a cloud.
const NIGHT: Record<string, string> = { sunny: 'clear-night', partlycloudy: 'partlycloudy-night' }
const atNight = (condition: string | undefined, night: boolean) => (night && NIGHT[condition ?? '']) || condition

// White icons, but for the sun, which is yellow.
const iconColor = (condition: string | undefined) => (condition === 'sunny' ? '#ffd60a' : undefined)

// Small is half the width and square, with only the weather now. Large is
// twice as tall, with the next hours and then the next days.
export type WeatherConfig = TileConfig & {
  // Which forecast runs along the bottom. The hours when the entity has
  // them, and the days when it does not.
  forecast_type?: Kind
}

// How many days a large tile lists under the hours.
const DAYS = 5

type Props = { env: TileEnv; config: WeatherConfig }

// The weather outside, the whole width and three rows tall. The temperature
// in large type, what the sky is doing and the day's high and low on the
// right, and the next hours along the bottom, or the next days when the
// entity has no hourly forecast. Its background is the sky. A tap opens the
// entity's dialog. Small, it is a square half as wide with the temperature
// under the name and the sky, the high and the low at its foot. Large, it
// is six rows tall, with the next hours and under them the next days, each
// with its low and high on a bar across the week's range.
export default function Weather({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const attributes = entity?.attributes ?? {}
  const features = typeof attributes.supported_features === 'number' ? attributes.supported_features : 0
  const offered: Kind[] = [
    ...(features & HOURLY ? ['hourly' as const] : []),
    ...(features & DAILY ? ['daily' as const] : []),
  ]
  const small = config.size === 'small'
  const large = config.size === 'large'
  // Large shows the hours along the strip, when there are any, and the days
  // under it.
  const strip: Kind | null = small
    ? null
    : large
      ? features & HOURLY
        ? 'hourly'
        : null
      : config.forecast_type && offered.includes(config.forecast_type)
        ? config.forecast_type
        : (offered[0] ?? null)
  const steps = useForecast(env.hass, config.entity, strip)
  const days = useForecast(env.hass, config.entity, features & DAILY ? 'daily' : null)
  const open = () => moreInfo(env.host, config.entity)
  const { pressed, handlers } = useTileGestures({
    haptics: config.haptic !== false,
    onTap: () => runAction(env, config.tap_action, open),
    onHold: () => runAction(env, config.hold_action, open),
  })

  const night = env.hass.states['sun.sun']?.state === 'below_horizon'
  const condition = entity?.state
  const looks = atNight(condition, night)
  const today = days?.[0]
  const language = env.hass.locale?.language ?? env.hass.language
  const label = (step: Forecast, i: number) => {
    if (i === 0) return strip === 'hourly' ? 'Now' : 'Today'
    const date = new Date(step.datetime)
    return strip === 'hourly'
      ? date.toLocaleTimeString(language, { hour: 'numeric' })
      : date.toLocaleDateString(language, { weekday: 'short' })
  }
  const unavailable = !entity || entity.state === 'unavailable' || entity.state === 'unknown'
  const now = attributes.temperature as number | undefined
  const stateText = unavailable ? 'Unavailable' : formatState(env.hass, entity)
  const range = today && (
    <div className="dio-weather-condition dio-weather-range">
      H:{degrees(today.temperature)} L:{degrees(today.templow)}
    </div>
  )
  const skyIcon = (
    <span className="dio-weather-icon" style={{ color: iconColor(looks) }}>
      <Icon icon={config.icon ?? defaultIcon(config.entity, undefined, looks)} on />
    </span>
  )
  // The days under the hours of a large tile, more of them with no hours.
  const list = large ? days?.slice(0, strip ? DAYS : DAYS + 2) : undefined

  if (small)
    return (
      <div
        {...handlers}
        role="button"
        tabIndex={0}
        aria-label={entityName(config, entity)}
        data-pressed={pressed || undefined}
        data-unavailable={unavailable || undefined}
        className="dio-tile dio-weather dio-weather-small"
        style={{ background: sky(condition, night) }}
      >
        <div className="dio-text">
          <div className="dio-name">{entityName(config, entity)}</div>
          <div className="dio-weather-temp">{degrees(now)}</div>
        </div>
        <div className="dio-weather-foot">
          {skyIcon}
          <div className="dio-weather-condition">{stateText}</div>
          {range}
        </div>
      </div>
    )

  return (
    <div
      {...handlers}
      role="button"
      tabIndex={0}
      aria-label={entityName(config, entity)}
      data-pressed={pressed || undefined}
      data-unavailable={unavailable || undefined}
      className={cn('dio-tile dio-weather', large && 'dio-weather-large')}
      style={{ background: sky(condition, night) }}
    >
      <div className="dio-weather-now">
        <div className="dio-text">
          <div className="dio-name">{entityName(config, entity)}</div>
          <div className="dio-weather-temp">{degrees(now)}</div>
        </div>
        <div className="dio-weather-sky">
          <div>
            <div className="dio-weather-condition">{stateText}</div>
            {range}
          </div>
          {skyIcon}
        </div>
      </div>
      {steps && steps.length > 0 && (
        <div className="dio-weather-steps">
          {steps.slice(0, STEPS).map((step, i) => {
            const condition = atNight(step.condition, step.is_daytime === false)
            return (
              <div key={step.datetime} className="dio-weather-step">
                <div className="dio-weather-when">{label(step, i)}</div>
                <span className="dio-weather-icon" style={{ color: iconColor(condition) }}>
                  <Icon icon={defaultIcon(config.entity, undefined, condition)} on />
                </span>
                <div className="dio-weather-step-temp">{degrees(step.temperature)}</div>
              </div>
            )
          })}
        </div>
      )}
      {list && list.length > 0 && <Days days={list} now={now} entity={config.entity} language={language} />}
    </div>
  )
}

// The next days, one to a row: the day, its sky, its low, a bar for where
// its low and high fall in the week's range, and its high. Today's bar has
// a dot for the temperature now.
function Days({
  days,
  now,
  entity,
  language,
}: {
  days: Forecast[]
  now: number | undefined
  entity: string | undefined
  language: string | undefined
}) {
  const lows = days.map(day => day.templow ?? day.temperature ?? 0)
  const highs = days.map(day => day.temperature ?? 0)
  const bottom = Math.min(...lows, now ?? Infinity)
  const top = Math.max(...highs, now ?? -Infinity)
  const at = (value: number) => (top > bottom ? ((value - bottom) / (top - bottom)) * 100 : 50)
  return (
    <div className="dio-weather-days">
      {days.map((day, i) => {
        const low = lows[i]
        const high = highs[i]
        return (
          <div key={day.datetime} className="dio-weather-day">
            <div className="dio-weather-day-name">
              {i === 0 ? 'Today' : new Date(day.datetime).toLocaleDateString(language, { weekday: 'short' })}
            </div>
            <span className="dio-weather-icon" style={{ color: iconColor(day.condition) }}>
              <Icon icon={defaultIcon(entity, undefined, day.condition)} on />
            </span>
            <div className="dio-weather-low">{degrees(day.templow)}</div>
            <div className="dio-weather-bar">
              <span style={{ left: `${at(low)}%`, right: `${100 - at(high)}%` }} />
              {i === 0 && typeof now === 'number' && <i style={{ left: `${at(now)}%` }} />}
            </div>
            <div className="dio-weather-high">{degrees(day.temperature)}</div>
          </div>
        )
      })}
    </div>
  )
}
