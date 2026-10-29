import { callService, type TileEnv } from '#/tiles/actions.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Icon } from '#/tiles/Icon.tsx'
import { menuKeys, openMenu } from '#/tiles/menu.ts'
import { Tile } from '#/tiles/Tile.tsx'
import { useRef } from 'react'

export type SelectConfig = TileConfig & { tap_behavior?: 'menu' | 'cycle' }

type Props = { env: TileEnv; config: SelectConfig }

// A select or a dropdown helper. A tap opens a menu of its options beside
// the tile, or with tap_behavior: cycle moves on to the next option.
export default function Select({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const domain = config.entity!.split('.')[0]
  const options = Array.isArray(entity?.attributes.options) ? (entity.attributes.options as string[]) : []
  // An option as Home Assistant words it, or the raw value made readable
  // when it has no words for it.
  const label = (option: string) => {
    const worded = entity && env.hass.formatEntityState?.(entity, option)
    if (worded && worded !== option) return worded
    const spaced = option.replace(/_/g, ' ')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
  }
  const anchor = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const choose = (option: string) => {
    menu.current?.hidePopover()
    if (option !== entity?.state) callService(env.hass, `${domain}.select_option`, { entity_id: config.entity, option })
  }

  const open = () => openMenu(menu.current, anchor.current?.getBoundingClientRect())

  const tap = () => {
    if (config.tap_behavior === 'cycle')
      callService(env.hass, `${domain}.select_next`, { entity_id: config.entity, cycle: true })
    else open()
  }

  return (
    <div ref={anchor} className="h-full">
      <Tile env={env} config={config} entity={entity} state={entity ? label(entity.state) : ''} onTap={tap} />
      <div ref={menu} popover="auto" role="menu" className="dio-menu" onKeyDown={menuKeys}>
        <div className="dio-menu-list">
          {options.map(option => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === entity?.state}
              className="dio-option"
              onClick={() => choose(option)}
            >
              <span className="min-w-0 flex-1 truncate">{label(option)}</span>
              {option === entity?.state && <Icon icon="ph:check" className="dio-check" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
