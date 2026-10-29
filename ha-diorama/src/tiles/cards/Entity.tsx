import { formatState, moreInfo, type TileEnv } from '#/tiles/actions.ts'
import { FillTile } from '#/tiles/cards/Fill.tsx'
import { numberInput } from '#/tiles/features/other.tsx'
import type { TileConfig } from '#/tiles/host.tsx'
import { Tile } from '#/tiles/Tile.tsx'
import type { EntityState } from '#/types.ts'

type Props = { env: TileEnv; config: TileConfig }

// When an entity of each domain counts as on, for the ones that have such
// a state at all.
function isActive(domain: string, entity: EntityState) {
  switch (domain) {
    case 'binary_sensor':
    case 'update':
    case 'calendar':
    case 'input_boolean':
      return entity.state === 'on'
    case 'person':
    case 'device_tracker':
      return entity.state === 'home'
    case 'alarm_control_panel':
      return entity.state !== 'disarmed'
    case 'timer':
      return entity.state === 'active'
    default:
      return false
  }
}

// Any other entity, a sensor, a person or the weather. The line under the
// name is its state as Home Assistant words it, and a tap opens its dialog.
// With the bar feature a percentage, like a battery's charge, fills the
// whole tile from the left as far, with nothing to drag. With the number
// feature a number that can be a slider is the whole tile, dragged sideways
// to set it.
export default function Entity({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const domain = config.entity!.split('.')[0]
  const { feature, ...plain } = config
  const value = Number(entity?.state)
  const details = () => moreInfo(env.host, config.entity)
  if (entity && entity.state !== '' && Number.isFinite(value)) {
    if (feature === 'bar-gauge')
      return (
        <FillTile
          env={env}
          config={plain}
          entity={entity}
          value={Math.min(100, Math.max(0, value))}
          on={value > 0}
          accent="var(--_accent)"
          format={() => formatState(env.hass, entity)}
          onTap={details}
          onSend={() => {}}
          readOnly
        />
      )
    const number = feature === 'numeric-input' ? numberInput(env.hass, entity) : null
    if (number && !number.box) {
      const { min, max, step, digits, format, send } = number
      const range = max - min || 1
      // The value at a share of the range, on a step.
      const at = (share: number) => Number((min + Math.round((share / 100) * (range / step)) * step).toFixed(digits))
      return (
        <FillTile
          env={env}
          config={plain}
          entity={entity}
          value={((value - min) / range) * 100}
          step={(step / range) * 100}
          on={value > min}
          accent="var(--_accent)"
          format={share => format(at(share))}
          onTap={details}
          onSend={share => send(at(share))}
        />
      )
    }
  }
  return (
    <Tile
      env={env}
      config={config}
      entity={entity}
      active={!!entity && isActive(domain, entity)}
      unknownIsUnavailable={false}
      state={formatState(env.hass, entity)}
      onTap={details}
    />
  )
}
