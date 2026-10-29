import { callService, type TileEnv } from '#/tiles/actions.ts'
import { ConfirmTile } from '#/tiles/cards/Confirm.tsx'
import type { TileConfig } from '#/tiles/host.tsx'
import { useFlash } from '#/tiles/features/parts.tsx'
import { Tile } from '#/tiles/Tile.tsx'
import { useEffect, useState } from 'react'

const PRESS: Record<string, string> = {
  button: 'button.press',
  input_button: 'input_button.press',
  script: 'script.turn_on',
  scene: 'scene.turn_on',
}

type Props = { env: TileEnv; config: TileConfig }

// Rerenders every so often, so a relative time stays right.
function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [every])
  return now
}

function relative(when: number, now: number, language: string | undefined) {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const seconds = Math.round((when - now) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Infinity],
  ]
  let value = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(unit === 'second' ? Math.min(0, value) : Math.round(value), unit)
    value /= size
  }
  return ''
}

// A button, a script or a scene. A tap runs it and the tile lights up for
// a moment, then slowly fades back. The line under the name says when it last ran.
// With confirm it runs only on a second tap.
export default function Button({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const domain = config.entity!.split('.')[0]
  const [flash, start] = useFlash()
  const now = useNow(30_000)
  // Scripts keep when they last ran in an attribute, the rest as their state.
  const last = domain === 'script' ? entity?.attributes.last_triggered : entity?.state
  const when = typeof last === 'string' ? Date.parse(last) : NaN
  const language = env.hass.locale?.language ?? env.hass.language
  const state =
    domain === 'script' && entity?.state === 'on'
      ? 'Running'
      : Number.isNaN(when)
        ? 'Never'
        : relative(when, Math.max(now, when), language)
  const press = () => {
    start()
    callService(env.hass, PRESS[domain], { entity_id: config.entity })
  }
  if (config.confirm)
    return (
      <ConfirmTile
        env={env}
        config={config}
        entity={entity}
        on={flash === 'lit'}
        fading={flash === 'fading'}
        unknownIsUnavailable={false}
        state={state}
        prompt="Tap again to run"
        onConfirm={press}
      />
    )
  return (
    <Tile
      env={env}
      config={config}
      entity={entity}
      active={flash === 'lit'}
      fading={flash === 'fading'}
      unknownIsUnavailable={false}
      state={state}
      onTap={press}
    />
  )
}
