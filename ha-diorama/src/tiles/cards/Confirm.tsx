import type { TileEnv } from '#/tiles/actions.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Tile } from '#/tiles/Tile.tsx'
import type { EntityState } from '#/types.ts'
import { useConfirm } from '#/tiles/twice.ts'
import type { ComponentProps } from 'react'

type Props = {
  env: TileEnv
  config: TileConfig
  entity: EntityState | undefined
  // Lit, as the tile is at rest.
  on: boolean
  fading?: boolean
  state: string
  // Under the name while it waits for the second tap.
  prompt: string
  // Sent on the second tap.
  onConfirm: () => void
} & Pick<ComponentProps<typeof Tile>, 'accent' | 'glow' | 'role' | 'unknownIsUnavailable'>

// A tile that only acts on a second tap, so a stray one never does, see
// useConfirm. Past the lit part it shows the tile as it is.
export function ConfirmTile({ env, config, entity, on, fading, state, prompt, onConfirm, ...look }: Props) {
  const { lit, waiting, shown, step, tap } = useConfirm(on, onConfirm)
  const said = waiting ? prompt : state
  return (
    <div className="dio-fill dio-confirm" data-step={step} data-fading={fading || undefined}>
      <Tile
        env={env}
        config={config}
        entity={entity}
        active={shown && !waiting}
        fading={fading}
        state={said}
        onTap={tap}
        {...look}
      />
      <div ref={lit} className="dio-fill-lit" inert>
        <Tile env={env} config={config} entity={entity} active state={said} {...look} />
      </div>
    </div>
  )
}
