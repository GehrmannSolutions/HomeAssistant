import { formatState, type TileEnv } from '#/tiles/actions.ts'
import { insideTile } from '#/tiles/gestures.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Panel } from '#/tiles/Panel.tsx'
import { useEffect, useRef, useState } from 'react'

export type MapConfig = TileConfig & {
  // How many hours of a person's path the map draws behind them.
  hours_to_show?: number
  // Where the map goes: over the whole card with the name and the state
  // on it, the default, or across the top over a bar with them.
  layout?: 'full' | 'top'
}

type Card = HTMLElement & { hass?: unknown; layout?: string; setConfig?: (config: Record<string, unknown>) => void }

// Where a person, a tracker or a zone is: Home Assistant's own map over the
// whole card with the name and the place on it in the bottom left, or
// across the top over a bar with them, and no icon either way. The map
// takes its own drags and pinches.
export default function MapCard({ env, config }: { env: TileEnv; config: MapConfig }) {
  const entity = env.hass.states[config.entity!]
  const box = useRef<HTMLDivElement>(null)
  const [card, setCard] = useState<Card | null>(null)
  // The same card, to hand it each new state without changing what was
  // rendered.
  const element = useRef<Card | null>(null)
  const hours = config.hours_to_show ?? 0

  useEffect(() => {
    let live = true
    window
      .loadCardHelpers?.()
      .then(helpers => {
        if (!live) return
        const made = helpers.createCardElement({
          type: 'map',
          entities: [config.entity],
          hours_to_show: hours,
          theme_mode: 'auto',
        }) as Card
        // Laid out as in a grid, the map fills its box rather than keeping
        // square, so it centers on what it shows.
        made.layout = 'grid'
        element.current = made
        setCard(made)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [config.entity, hours])

  useEffect(() => {
    if (!card || !box.current) return
    box.current.replaceChildren(card)
  }, [card])

  useEffect(() => {
    if (card && element.current) element.current.hass = env.hass
  }, [card, env.hass])

  return (
    <Panel
      env={env}
      config={config}
      entity={entity}
      state={formatState(env.hass, entity)}
      className={`dio-map dio-map-${config.layout ?? 'full'}`}
    >
      <div {...insideTile} ref={box} className="dio-map-box" />
    </Panel>
  )
}
