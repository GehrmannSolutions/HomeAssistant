import { callService, type TileEnv } from '#/tiles/actions.ts'
import CoverControls from '#/tiles/cards/CoverControls.tsx'
import { PositionTile } from '#/tiles/cards/Fill.tsx'
import { SET_POSITION, SET_TILT, STOP } from '#/tiles/features/cover.tsx'
import { supports } from '#/tiles/features/parts.tsx'
import type { TileConfig } from '#/tiles/host.tsx'
import { Tile } from '#/tiles/Tile.tsx'

export type CoverConfig = TileConfig & { invert?: boolean }

const STATES: Record<string, string> = { open: 'Open', closed: 'Closed', opening: 'Opening', closing: 'Closing' }

type Props = { env: TileEnv; config: CoverConfig }

// A blind, a shutter or a screen. A tap opens it or closes it, or stops it
// while it moves. Up, stop and down buttons sit in the top right corner,
// on a small tile only when they fit, stop only for a cover that can stop.
// With the position or tilt position feature
// the whole tile is how far it is open or tilted, and with position with
// buttons it keeps the buttons too. The tile is
// lit while the cover is open or opening, so it shows where it is heading.
export default function Cover({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const target = { entity_id: config.entity }
  const position = entity?.attributes.current_position
  const label = STATES[entity?.state ?? ''] ?? entity?.state ?? ''
  const state =
    typeof position === 'number' && entity?.state === 'open' && position < 100 ? `${label} · ${position}%` : label
  const run = (service: string) => () => callService(env.hass, `cover.${service}`, target)
  const usable = entity && entity.state !== 'unavailable' && entity.state !== 'unknown'
  const { feature: _, ...plain } = config
  if (usable && config.feature === 'position' && supports(entity, SET_POSITION))
    return <PositionTile env={env} config={plain} entity={entity} />
  if (usable && config.feature === 'position-buttons' && supports(entity, SET_POSITION))
    return <PositionTile env={env} config={plain} entity={entity} buttons />
  if (usable && config.feature === 'tilt-position' && supports(entity, SET_TILT))
    return <PositionTile env={env} config={plain} entity={entity} tilt />
  return (
    <Tile
      env={env}
      config={config}
      entity={entity}
      active={entity?.state === 'open' || entity?.state === 'opening'}
      toggles
      accent="var(--_accent-cover)"
      state={state}
      onTap={run('toggle')}
      controls={
        <CoverControls
          invert={config.invert === true}
          stops={supports(entity, STOP)}
          onOpen={run('open_cover')}
          onStop={run('stop_cover')}
          onClose={run('close_cover')}
        />
      }
    />
  )
}
