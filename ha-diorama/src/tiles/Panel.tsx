import { cn } from '#/lib/utils.ts'
import { moreInfo, type TileEnv } from '#/tiles/actions.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Tile } from '#/tiles/Tile.tsx'
import type { EntityState } from '#/types.ts'
import type { ComponentProps, CSSProperties, ReactNode } from 'react'

type Props = {
  env: TileEnv
  config: TileConfig
  entity: EntityState | undefined
  state: ReactNode
  // The color of the icon while it is active, like red for an armed alarm.
  accent?: string
  active?: boolean
  glow?: string
  glowFrom?: ComponentProps<typeof Tile>['glowFrom']
  tint?: string
  picture?: string
  logo?: ComponentProps<typeof Tile>['logo']
  // What a tap does when the config sets no tap_action, its dialog unless
  // set, or nothing when null.
  onTap?: (() => void) | null
  toggles?: boolean
  // Buttons and selectors in the top right corner.
  controls?: ReactNode
  className?: string
  style?: CSSProperties
  // What the card shows, in the bottom right corner across from the name.
  children?: ReactNode
}

// The shell of a card bigger than a tile, like the dial or the calendar: a
// wide tile as tall as what it holds, with the icon in the top left like
// every tile, its buttons in the top right, the name and the state in the
// bottom left and what it shows in the bottom right, as small as it can be.
export function Panel({ env, config, onTap, children, className, style, ...tile }: Props) {
  return (
    <div className={cn('dio-card', className)} style={style}>
      <Tile
        env={env}
        config={{ ...config, size: 'wide' }}
        onTap={onTap === undefined ? () => moreInfo(env.host, config.entity) : (onTap ?? undefined)}
        aside={children}
        unknownIsUnavailable={false}
        {...tile}
      />
    </div>
  )
}
