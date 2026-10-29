import { callService, type TileEnv } from '#/tiles/actions.ts'
import { Control } from '#/tiles/Control.tsx'
import { formatDegrees } from '#/tiles/features/parts.tsx'
import { insideTile } from '#/tiles/gestures.ts'
import { useEffect, useRef, useState } from 'react'

// How long the minus and plus buttons wait for another press before they
// send the new temperature, so a few presses make one change.
const SEND_MS = 700

// How long a new temperature shows after it is sent if Home Assistant never
// says it took it.
const HOLD_MS = 5000

type Aim = { temperature?: number; low?: number; high?: number }

type Props = { env: TileEnv; entityId: string }

// Minus and plus around the temperature a thermostat or a water heater aims
// for, or around the two ends of the range it keeps to, where a tap on one
// picks which the buttons move.
export default function TemperatureStepper({ env, entityId }: Props) {
  const entity = env.hass.states[entityId]
  const domain = entityId.split('.')[0]
  const attributes = entity?.attributes ?? {}
  const number = (key: string) => (typeof attributes[key] === 'number' ? (attributes[key] as number) : null)
  const target = number('temperature')
  const range = target === null && number('target_temp_low') !== null && number('target_temp_high') !== null
  const [pending, setPending] = useState<Aim | null>(null)
  const [end, setEnd] = useState<'low' | 'high'>('high')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(hold.current)
    },
    [],
  )

  // A new temperature shows until Home Assistant reports it, so the old one
  // never flashes back in between. Once it does, what it reports shows.
  const reported = (key: keyof Aim) => number(key === 'temperature' ? key : `target_temp_${key}`)
  const held =
    pending && (Object.keys(pending) as (keyof Aim)[]).some(key => pending[key] !== reported(key)) ? pending : null
  const aim = {
    temperature: held?.temperature ?? target ?? undefined,
    low: held?.low ?? number('target_temp_low') ?? undefined,
    high: held?.high ?? number('target_temp_high') ?? undefined,
  }

  const step = number('target_temp_step') ?? (domain === 'water_heater' ? 1 : 0.5)
  const min = number('min_temp') ?? -Infinity
  const max = number('max_temp') ?? Infinity
  const nudge = (by: number) => () => {
    const key = range ? end : 'temperature'
    const now = aim[key]
    if (now === undefined) return
    // Each end of a range stays on its own side of the other.
    const floor = key === 'high' ? Math.max(min, aim.low ?? min) : min
    const ceiling = key === 'low' ? Math.min(max, aim.high ?? max) : max
    const next = Math.min(ceiling, Math.max(floor, Math.round((now + by * step) / step) * step))
    const merged = { ...held, [key]: next }
    setPending(merged)
    clearTimeout(timer.current)
    clearTimeout(hold.current)
    timer.current = setTimeout(() => {
      const data = range
        ? { target_temp_low: merged.low ?? aim.low, target_temp_high: merged.high ?? aim.high }
        : { temperature: next }
      void callService(env.hass, `${domain}.set_temperature`, { entity_id: entityId, ...data })
      hold.current = setTimeout(() => setPending(null), HOLD_MS)
    }, SEND_MS)
  }

  const degrees = (value: number | undefined) => (value === undefined ? '' : formatDegrees(env.hass, value))

  if (!range && aim.temperature === undefined) return null
  return (
    <>
      <Control icon="ph:minus-bold" label="Lower the temperature" onPress={nudge(-1)} />
      {range ? (
        <span className="dio-stepper-range">
          <End label="Lowest" value={degrees(aim.low)} picked={end === 'low'} onPick={() => setEnd('low')} />
          <End label="Highest" value={degrees(aim.high)} picked={end === 'high'} onPick={() => setEnd('high')} />
        </span>
      ) : (
        <span className="dio-stepper-value" aria-live="polite">
          {degrees(aim.temperature)}
        </span>
      )}
      <Control icon="ph:plus-bold" label="Raise the temperature" onPress={nudge(1)} />
    </>
  )
}

type EndProps = { label: string; value: string; picked: boolean; onPick: () => void }

// One end of a range, which a tap picks for the minus and plus to move.
function End({ label, value, picked, onPick }: EndProps) {
  return (
    <button
      {...insideTile}
      type="button"
      aria-label={`${label} ${value}`}
      aria-pressed={picked}
      className="dio-stepper-end"
      onClick={e => {
        e.stopPropagation()
        onPick()
      }}
    >
      {value}
    </button>
  )
}
