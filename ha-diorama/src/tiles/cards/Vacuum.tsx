import { callService, type TileEnv } from '#/tiles/actions.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Control } from '#/tiles/Control.tsx'
import { Tile } from '#/tiles/Tile.tsx'

export type VacuumConfig = TileConfig & {
  // A sensor with the battery level, for a vacuum that keeps it there
  // rather than in an attribute of its own. Without it, a battery sensor
  // on the same device is used.
  battery_entity?: string
}

// The vacuum's supported_features bits.
const PAUSE = 4
const STOP = 8
const RETURN_HOME = 16
const START = 8192

const STATES: Record<string, string> = {
  cleaning: 'Cleaning',
  docked: 'Docked',
  idle: 'Idle',
  paused: 'Paused',
  returning: 'Returning',
  error: 'Error',
}

type Props = { env: TileEnv; config: VacuumConfig }

// A battery sensor on the same device as the vacuum, for one that keeps
// its level there rather than in an attribute.
function batterySensor(hass: TileEnv['hass'], entityId: string | undefined) {
  const device = entityId ? hass.entities?.[entityId]?.device_id : undefined
  if (!device) return undefined
  return Object.values(hass.entities ?? {}).find(
    entry =>
      entry.device_id === device &&
      entry.entity_id.startsWith('sensor.') &&
      hass.states[entry.entity_id]?.attributes.device_class === 'battery',
  )?.entity_id
}

// A robot vacuum. A tap starts it, or pauses it while it cleans. Start or
// pause, stop and dock buttons sit in the top right corner, only those it
// supports, on a small tile only when they fit.
// The tile is lit only while it cleans: returning is on its way to resting.
export default function Vacuum({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const features = Number(entity?.attributes.supported_features ?? 0)
  const supports = (bit: number) => (features & bit) !== 0
  const cleaning = entity?.state === 'cleaning'
  const run = (service: string) => () => callService(env.hass, `vacuum.${service}`, { entity_id: config.entity })
  const pause = run(supports(PAUSE) ? 'pause' : 'stop')
  const start = run('start')

  const battery =
    config.battery_entity ??
    (entity?.attributes.battery_level === undefined ? batterySensor(env.hass, config.entity) : undefined)
  const sensor = battery ? env.hass.states[battery]?.state : undefined
  const level = Number(sensor ?? entity?.attributes.battery_level)
  const label = STATES[entity?.state ?? ''] ?? entity?.state ?? ''
  const state =
    Number.isFinite(level) && (sensor !== undefined || entity?.attributes.battery_level !== undefined)
      ? `${label} · ${Math.round(level)}%`
      : label

  return (
    <Tile
      env={env}
      config={config}
      entity={entity}
      active={cleaning}
      toggles
      state={state}
      onTap={cleaning ? pause : start}
      controls={
        <>
          {cleaning && (supports(PAUSE) || supports(STOP)) ? (
            <Control icon="ph:pause" label="Pause" onPress={pause} />
          ) : (
            supports(START) && <Control icon="ph:play" label="Start" onPress={start} />
          )}
          {supports(STOP) && <Control icon="ph:stop" label="Stop" onPress={run('stop')} />}
          {supports(RETURN_HOME) && <Control icon="ph:house" label="Dock" onPress={run('return_to_base')} />}
        </>
      }
    />
  )
}
