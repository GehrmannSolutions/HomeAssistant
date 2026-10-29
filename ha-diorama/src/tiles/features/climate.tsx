import { callService } from '#/tiles/actions.ts'
import TemperatureStepper from '#/tiles/cards/TemperatureStepper.tsx'
import { Control } from '#/tiles/Control.tsx'
import {
  domainOf,
  Group,
  listOf,
  MenuPill,
  numberOf,
  optionWord,
  Stepper,
  type FeatureProps,
} from '#/tiles/features/parts.tsx'
import { HVAC_MODES, HVAC_ORDER, WATER_HEATER_MODES } from '#/tiles/modes.ts'
import type { CSSProperties } from 'react'

// The features of a thermostat, a water heater and a humidifier.

const rank = (mode: string) => (HVAC_ORDER.includes(mode) ? HVAC_ORDER.indexOf(mode) : HVAC_ORDER.length)

// A round button for each mode the thermostat runs in, the one it is in
// filled in its own color.
export function HvacModes({ env, entity }: FeatureProps) {
  const modes = listOf(entity, 'hvac_modes').sort((a, b) => rank(a) - rank(b))
  return (
    <Group label="Mode" radio>
      {modes.map(mode => (
        <Control
          key={mode}
          icon={HVAC_MODES[mode]?.icon ?? 'ph:circle'}
          label={optionWord(env.hass, entity, mode)}
          role="radio"
          checked={entity.state === mode}
          className="dio-mode"
          style={{ '--_mode-color': HVAC_MODES[mode]?.color } as CSSProperties}
          onPress={() =>
            entity.state !== mode &&
            callService(env.hass, 'climate.set_hvac_mode', { entity_id: entity.entity_id, hvac_mode: mode })
          }
        />
      ))}
    </Group>
  )
}

const WATER_HEATER_ORDER = Object.keys(WATER_HEATER_MODES)
const operationRank = (mode: string) =>
  WATER_HEATER_ORDER.includes(mode) ? WATER_HEATER_ORDER.indexOf(mode) : WATER_HEATER_ORDER.length

// A round button for each way the water heater can run, the one it runs
// in filled in the color of heat, or plain while it is off.
export function OperationModes({ env, entity }: FeatureProps) {
  const current = entity.attributes.operation_mode ?? entity.state
  const modes = listOf(entity, 'operation_list').sort((a, b) => operationRank(a) - operationRank(b))
  return (
    <Group label="Mode" radio>
      {modes.map(mode => (
        <Control
          key={mode}
          icon={WATER_HEATER_MODES[mode] ?? 'ph:circle'}
          label={optionWord(env.hass, entity, mode, 'operation_mode')}
          role="radio"
          checked={current === mode}
          className="dio-mode"
          style={{ '--_mode-color': mode === 'off' ? undefined : 'var(--_mode-heat)' } as CSSProperties}
          onPress={() =>
            current !== mode &&
            callService(env.hass, 'water_heater.set_operation_mode', {
              entity_id: entity.entity_id,
              operation_mode: mode,
            })
          }
        />
      ))}
    </Group>
  )
}

type Menu = { icon: string; label: string; list: string; current: string; service: string; field: string }

// The menus a thermostat, a water heater and a humidifier can have, each
// the list of choices, the choice it holds and how to pick another.
export const MENUS: Record<string, Menu> = {
  'preset-modes': {
    icon: 'ph:sliders-horizontal',
    label: 'Preset',
    list: 'preset_modes',
    current: 'preset_mode',
    service: 'climate.set_preset_mode',
    field: 'preset_mode',
  },
  'fan-modes': {
    icon: 'ph:fan',
    label: 'Fan',
    list: 'fan_modes',
    current: 'fan_mode',
    service: 'climate.set_fan_mode',
    field: 'fan_mode',
  },
  'swing-modes': {
    icon: 'ph:arrows-vertical',
    label: 'Swing',
    list: 'swing_modes',
    current: 'swing_mode',
    service: 'climate.set_swing_mode',
    field: 'swing_mode',
  },
  'swing-horizontal-modes': {
    icon: 'ph:arrows-horizontal',
    label: 'Side to side',
    list: 'swing_horizontal_modes',
    current: 'swing_horizontal_mode',
    service: 'climate.set_swing_horizontal_mode',
    field: 'swing_horizontal_mode',
  },
  'operation-modes': {
    icon: 'ph:fire',
    label: 'Mode',
    list: 'operation_list',
    current: 'operation_mode',
    service: 'water_heater.set_operation_mode',
    field: 'operation_mode',
  },
  modes: {
    icon: 'ph:drop-half',
    label: 'Mode',
    list: 'available_modes',
    current: 'mode',
    service: 'humidifier.set_mode',
    field: 'mode',
  },
}

export function ModeMenu({ env, entity, menu }: FeatureProps & { menu: Menu }) {
  const current = entity.attributes[menu.current]
  return (
    <MenuPill
      icon={menu.icon}
      label={menu.label}
      options={listOf(entity, menu.list)}
      current={typeof current === 'string' ? current : null}
      word={option => optionWord(env.hass, entity, option, menu.current)}
      onPick={option => callService(env.hass, menu.service, { entity_id: entity.entity_id, [menu.field]: option })}
    />
  )
}

// Minus and plus around the temperature it aims for.
export function TargetTemperature({ env, entity }: FeatureProps) {
  return (
    <Group label="Temperature">
      <TemperatureStepper env={env} entityId={entity.entity_id} />
    </Group>
  )
}

// Minus and plus around the humidity it aims for.
export function TargetHumidity({ env, entity }: FeatureProps) {
  const domain = domainOf(entity)
  return (
    <Stepper
      label="Humidity"
      value={numberOf(entity, 'humidity')}
      step={1}
      min={numberOf(entity, 'min_humidity') ?? 0}
      max={numberOf(entity, 'max_humidity') ?? 100}
      format={v => `${Math.round(v)}%`}
      onSend={v => callService(env.hass, `${domain}.set_humidity`, { entity_id: entity.entity_id, humidity: v })}
    />
  )
}
