import { callService, formatAttribute, formatState, moreInfo, type TileEnv } from '#/tiles/actions.ts'
import { FillTile } from '#/tiles/cards/Fill.tsx'
import TemperatureStepper from '#/tiles/cards/TemperatureStepper.tsx'
import { HvacModes, OperationModes } from '#/tiles/features/climate.tsx'
import { climateColor, NO_COLOR } from '#/tiles/modes.ts'
import { formatDegrees, listOf, numberOf, supports } from '#/tiles/features/parts.tsx'
import type { TileConfig } from '#/tiles/host.tsx'
import { Tile } from '#/tiles/Tile.tsx'

type Props = { env: TileEnv; config: TileConfig }

// The bits that say a water heater or a thermostat turns on and off.
const ON_OFF: Record<string, number> = { water_heater: 8, climate: 128 | 256 }

// A thermostat or a water heater. The line under the name says what it is
// doing, how warm it is and how warm it aims to be, and a tap opens its
// dialog. Its top right corner has minus and plus, on a small tile only
// when they fit, around the temperature it aims
// for, or around the two ends of the range it keeps to, where a tap on one
// picks which the buttons move. A wide thermostat or water heater adds a
// button for each mode it runs in across from the name, unless a feature sits beside the
// icon instead. Lit while it is on, in the color of the mode it runs in,
// or in a mode that heats or cools as it needs to of what it is doing,
// which washes down from the top of the tile.
export default function Climate({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const attributes = entity?.attributes ?? {}
  const on = !!entity && entity.state !== 'off'
  const action = typeof attributes.hvac_action === 'string' ? attributes.hvac_action : null
  const color = (entity && climateColor(entity.state, action)) ?? 'var(--_accent-climate)'
  const wide = config.size === 'wide'

  // A tile with minus and plus shows what it aims for between them.
  const stepped = (wide && !config.feature) || config.feature === 'target-temperature'
  const now =
    entity && typeof attributes.current_temperature === 'number'
      ? formatDegrees(env.hass, attributes.current_temperature)
      : null
  const aim =
    !stepped && on && entity && typeof attributes.temperature === 'number'
      ? `to ${formatDegrees(env.hass, attributes.temperature)}`
      : null
  const parts = [
    entity &&
      (action && action !== 'off' ? formatAttribute(env.hass, entity, 'hvac_action') : formatState(env.hass, entity)),
    // How warm it is and how warm it aims to be read as one phrase.
    [now, aim].filter(Boolean).join(' '),
  ]

  // With the slider the whole tile is the temperature it holds, from its
  // lowest to its highest, and empty while it is off. Down to nothing
  // turns it off, when it can be, and a tap opens its dialog, as on the
  // other thermostat tiles.
  const target = entity ? numberOf(entity, 'temperature') : null
  if (entity && config.feature === 'temperature-slider' && target !== null) {
    const domain = entity.entity_id.split('.')[0]
    const min = numberOf(entity, 'min_temp') ?? 7
    const max = numberOf(entity, 'max_temp') ?? 35
    const step = numberOf(entity, 'target_temp_step') ?? (domain === 'water_heater' ? 1 : 0.5)
    const span = max - min || 1
    const switches = supports(entity, ON_OFF[domain] ?? 0)
    const degrees = (share: number) =>
      Math.round(Math.min(max, min + Math.round((share * span) / 100 / step) * step) * 10) / 10
    const power = (turnOn: boolean) =>
      callService(env.hass, `${domain}.turn_${turnOn ? 'on' : 'off'}`, { entity_id: entity.entity_id })
    const { feature: _, ...plain } = config
    return (
      <FillTile
        env={env}
        config={plain}
        entity={entity}
        value={on ? Math.max(1, Math.round(((target - min) / span) * 100)) : 0}
        step={(step / span) * 100}
        on={on}
        accent={color}
        glow={on && color !== NO_COLOR ? color : undefined}
        format={share =>
          share === 0
            ? formatState(env.hass, entity)
            : [parts[0], [now, `to ${formatDegrees(env.hass, degrees(share))}`].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(' · ')
        }
        onTap={() => moreInfo(env.host, config.entity)}
        onSend={share =>
          share === 0 && switches
            ? power(false)
            : Promise.all([
                callService(env.hass, `${domain}.set_temperature`, {
                  entity_id: entity.entity_id,
                  temperature: degrees(share),
                }),
                !on && switches && power(true),
              ])
        }
      />
    )
  }

  const modes =
    entity &&
    (entity.entity_id.startsWith('water_heater.')
      ? listOf(entity, 'operation_list').length > 0 && <OperationModes env={env} config={config} entity={entity} />
      : listOf(entity, 'hvac_modes').length > 0 && <HvacModes env={env} config={config} entity={entity} />)

  return (
    <Tile
      env={env}
      config={config}
      entity={entity}
      active={on}
      accent={color}
      glow={on && color !== NO_COLOR ? color : undefined}
      glowFrom="top"
      state={parts.filter(Boolean).join(' · ')}
      onTap={() => moreInfo(env.host, config.entity)}
      controls={<TemperatureStepper env={env} entityId={config.entity!} />}
      aside={modes}
    />
  )
}
