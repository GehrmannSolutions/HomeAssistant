import { callService } from '#/tiles/actions.ts'
import { Control } from '#/tiles/Control.tsx'
import type { EntityState } from '#/types.ts'
import {
  domainOf,
  Group,
  listOf,
  MenuPill,
  numberOf,
  optionWord,
  Pill,
  supports,
  TogglePill,
  type FeatureProps,
} from '#/tiles/features/parts.tsx'

// The features of a cover, a valve and a fan.

// The bits of supported_features they share: covers and valves open, close,
// go to a position and stop with the same four.
export const OPEN = 1
export const CLOSE = 2
export const SET_POSITION = 4
export const STOP = 8
export const OPEN_TILT = 16
export const CLOSE_TILT = 32
export const STOP_TILT = 64
export const SET_TILT = 128

const FAN_SPEED = 1
const FAN_OSCILLATE = 2
const FAN_DIRECTION = 4
const FAN_PRESET = 8
export const FAN = { speed: FAN_SPEED, oscillate: FAN_OSCILLATE, direction: FAN_DIRECTION, preset: FAN_PRESET }

const percent = (v: number) => `${v}%`

// The services of a cover and of a valve, which only differ in their last
// word.
const service = (domain: string, verb: string) => (domain === 'valve' ? `valve.${verb}_valve` : `cover.${verb}_cover`)

// Up, stop and down. Stop only for a cover that can stop, so one that
// only opens and closes shows just the two arrows. Inverted, for a screen
// that comes down to open, up closes and down opens.
export function OpenClose({ env, config, entity }: FeatureProps) {
  const domain = domainOf(entity)
  const invert = (config as { invert?: boolean }).invert === true
  const run = (verb: string) => () => callService(env.hass, service(domain, verb), { entity_id: entity.entity_id })
  return (
    <Group label={domain === 'valve' ? 'Valve' : 'Cover'}>
      <Control icon="ph:caret-up" label={invert ? 'Close' : 'Open'} onPress={run(invert ? 'close' : 'open')} />
      {supports(entity, STOP) && <Control icon="ph:stop" label="Stop" onPress={run('stop')} />}
      <Control icon="ph:caret-down" label={invert ? 'Open' : 'Close'} onPress={run(invert ? 'open' : 'close')} />
    </Group>
  )
}

// Opens and closes the slats, and stops them where it can.
export function Tilt({ env, entity }: FeatureProps) {
  const run = (verb: string) => () => callService(env.hass, `cover.${verb}`, { entity_id: entity.entity_id })
  return (
    <Group label="Tilt">
      <Control icon="ph:arrow-line-up" label="Open the slats" onPress={run('open_cover_tilt')} />
      {supports(entity, STOP_TILT) && <Control icon="ph:stop" label="Stop" onPress={run('stop_cover_tilt')} />}
      <Control icon="ph:arrow-line-down" label="Close the slats" onPress={run('close_cover_tilt')} />
    </Group>
  )
}

const FAVORITES = [0, 25, 50, 75, 100]

// A few positions a press away, the one it is at picked out.
export function Favorites({ env, config, entity, tilt }: FeatureProps & { tilt?: boolean }) {
  const domain = domainOf(entity)
  const now = numberOf(entity, tilt ? 'current_tilt_position' : 'current_position')
  const favorites = (config.favorites?.length ? config.favorites : FAVORITES).slice(0, 6)
  const go = (position: number) => () =>
    tilt
      ? callService(env.hass, 'cover.set_cover_tilt_position', { entity_id: entity.entity_id, tilt_position: position })
      : callService(env.hass, domain === 'valve' ? 'valve.set_valve_position' : 'cover.set_cover_position', {
          entity_id: entity.entity_id,
          position,
        })
  return (
    <div className="dio-group" role="radiogroup" aria-label={tilt ? 'Favorite tilts' : 'Favorite positions'}>
      {favorites.map(position => (
        <Pill
          key={position}
          label={percent(position)}
          checked={now === position}
          onPress={go(position)}
          ariaLabel={`${tilt ? 'Tilt' : 'Position'} ${position}%`}
        />
      ))}
    </div>
  )
}

export function FanPreset({ env, entity }: FeatureProps) {
  const preset = typeof entity.attributes.preset_mode === 'string' ? entity.attributes.preset_mode : null
  return (
    <MenuPill
      icon="ph:sliders-horizontal"
      label="Preset"
      options={listOf(entity, 'preset_modes')}
      current={preset}
      word={option => optionWord(env.hass, entity, option, 'preset_mode')}
      onPick={option =>
        callService(env.hass, 'fan.set_preset_mode', { entity_id: entity.entity_id, preset_mode: option })
      }
    />
  )
}

// Which way it turns, forward or in reverse.
export function FanDirection({ env, entity }: FeatureProps) {
  const set = (direction: string) => () =>
    entity.attributes.direction !== direction &&
    callService(env.hass, 'fan.set_direction', { entity_id: entity.entity_id, direction })
  return (
    <Group label="Direction" radio>
      <Control
        icon="ph:arrow-clockwise"
        label="Forward"
        role="radio"
        checked={entity.attributes.direction === 'forward'}
        className="dio-mode"
        onPress={set('forward')}
      />
      <Control
        icon="ph:arrow-counter-clockwise"
        label="Reverse"
        role="radio"
        checked={entity.attributes.direction === 'reverse'}
        className="dio-mode"
        onPress={set('reverse')}
      />
    </Group>
  )
}

// How many speeds a fan has, from the step between them, or none for one
// that goes up by the percent.
export function speedCount(entity: EntityState) {
  const step = numberOf(entity, 'percentage_step')
  return step && step > 1 ? Math.round(100 / step) : 0
}

// The speed a fan runs at, from 1 up to its count, or 0 while it is off.
const speedOf = (entity: EntityState, count: number) =>
  entity.state === 'on' ? Math.max(1, Math.round(((numberOf(entity, 'percentage') ?? 100) * count) / 100)) : 0

const SPEED_WORDS: Record<number, string[]> = {
  1: ['On'],
  2: ['Low', 'High'],
  3: ['Low', 'Medium', 'High'],
  4: ['Low', 'Medium', 'High', 'Highest'],
}
const SPEED_ICONS = ['cell-signal-low', 'cell-signal-medium', 'cell-signal-high', 'cell-signal-full']

// What a speed is called, by its place among the fan's speeds or, for a
// fan with many, by its percent.
const speedWord = (speed: number, count: number) =>
  speed === 0 ? 'Off' : (SPEED_WORDS[count]?.[speed - 1] ?? percent(Math.round((speed * 100) / count)))

// Sets the fan to a speed, or turns it off for 0.
const setSpeed = (env: FeatureProps['env'], entity: EntityState, speed: number, count: number) =>
  speed === 0
    ? callService(env.hass, 'fan.turn_off', { entity_id: entity.entity_id })
    : callService(env.hass, 'fan.set_percentage', {
        entity_id: entity.entity_id,
        percentage: Math.min(100, Math.round((speed * 100) / count)),
      })

// A round button for off and for each of a few speeds, the one it runs at
// filled, the bars rising with the speed.
export function FanSpeeds({ env, entity }: FeatureProps) {
  const count = speedCount(entity)
  const current = speedOf(entity, count)
  const speeds = Array.from({ length: count + 1 }, (_, speed) => speed)
  return (
    <Group label="Speed" radio>
      {speeds.map(speed => (
        <Control
          key={speed}
          icon={
            speed === 0
              ? 'ph:power'
              : `ph:${SPEED_ICONS[count === 1 ? 3 : Math.round(((speed - 1) * 3) / (count - 1))]}`
          }
          label={speedWord(speed, count)}
          role="radio"
          checked={current === speed}
          className="dio-mode"
          onPress={() => current !== speed && setSpeed(env, entity, speed, count)}
        />
      ))}
    </Group>
  )
}

// The same speeds as a menu, for a fan with too many for buttons.
export function FanSpeedMenu({ env, entity }: FeatureProps) {
  const count = speedCount(entity)
  const options = Array.from({ length: count + 1 }, (_, speed) => String(speed))
  return (
    <MenuPill
      icon="ph:fan"
      label="Speed"
      options={options}
      current={String(speedOf(entity, count))}
      word={option => speedWord(Number(option), count)}
      onPick={option => setSpeed(env, entity, Number(option), count)}
    />
  )
}

export function FanOscillate({ env, entity }: FeatureProps) {
  const oscillating = entity.attributes.oscillating === true
  return (
    <TogglePill
      icon="ph:arrows-left-right"
      label="Oscillate"
      on={oscillating}
      onToggle={() =>
        callService(env.hass, 'fan.oscillate', { entity_id: entity.entity_id, oscillating: !oscillating })
      }
    />
  )
}
