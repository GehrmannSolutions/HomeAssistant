import { formatState, type TileEnv } from '#/tiles/actions.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Panel } from '#/tiles/Panel.tsx'

export type GaugeConfig = TileConfig & { min?: number; max?: number }

// The ring sweeps three quarters of a circle, open at the bottom.
const SWEEP = 270
const RADIUS = 40
const LENGTH = (2 * Math.PI * RADIUS * SWEEP) / 360

// A reading on a ring, as tall as a tile with a control: the name and the
// reading in the bottom left corner like every tile, and across from them
// a small ring that fills in the accent as far as the value goes from its
// minimum to its maximum.
export default function Gauge({ env, config }: { env: TileEnv; config: GaugeConfig }) {
  const entity = env.hass.states[config.entity!]
  const value = Number(entity?.state)
  const known = Number.isFinite(value) && entity?.state !== ''
  const unit = typeof entity?.attributes.unit_of_measurement === 'string' ? entity.attributes.unit_of_measurement : ''
  // A number entity says its own range, like 1 to 5 for a pump's speed.
  const own = (key: 'min' | 'max') => {
    const v = entity?.attributes[key] ?? entity?.attributes[`${key}imum`]
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }
  const min = config.min ?? own('min') ?? 0
  const max = config.max ?? own('max') ?? (unit === '%' ? 100 : Math.max(100, Math.ceil(value)))
  const share = known ? Math.min(Math.max((value - min) / (max - min || 1), 0), 1) : 0
  return (
    <Panel env={env} config={config} entity={entity} state={formatState(env.hass, entity)} className="dio-gauge">
      {known && (
        <svg
          viewBox="0 0 100 92"
          className="dio-gauge-ring"
          role="meter"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
        >
          <g transform={`rotate(${90 + (360 - SWEEP) / 2} 50 50)`}>
            <circle className="dio-gauge-track" cx="50" cy="50" r={RADIUS} strokeDasharray={`${LENGTH} 999`} />
            <circle className="dio-gauge-fill" cx="50" cy="50" r={RADIUS} strokeDasharray={`${LENGTH * share} 999`} />
          </g>
        </svg>
      )}
    </Panel>
  )
}
