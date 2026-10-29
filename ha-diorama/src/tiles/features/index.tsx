import * as climate from '#/tiles/features/climate.tsx'
import * as cover from '#/tiles/features/cover.tsx'
import * as light from '#/tiles/features/light.tsx'
import * as media from '#/tiles/features/media.tsx'
import * as other from '#/tiles/features/other.tsx'
import { domainOf, listOf, numberOf, supports, type FeatureProps } from '#/tiles/features/parts.tsx'
import type { EntityState } from '#/types.ts'
import type { ComponentType } from 'react'

// The features a tile can show beside its icon, by the names Home
// Assistant gives its own tile features. Each says which domains it is
// for and whether an entity has what it needs, so the card picker offers
// only the ones that work.

export type FeatureDef = {
  id: string
  // How the editor names the choice.
  label: string
  // How the card pickers name the tile with it, after with, as in Toggle
  // with Color.
  name: string
  domains: string[]
  supports?: (entity: EntityState) => boolean
  // What it draws across from the icon, so the tile stays two rows tall.
  // A feature without one is the whole tile instead, drawn by the tile
  // itself.
  View?: ComponentType<FeatureProps>
  // Too big to sit beside the icon, so it goes along the bottom and makes
  // the tile a row taller.
  row?: boolean
  // Too many buttons to fit beside the icon of a small tile, so a tile
  // with it is always wide, or only for an entity it says.
  wide?: boolean | ((entity: EntityState) => boolean)
  // What the tile says under its name while it is on, in place of what it
  // would say without the feature, like a light's white in kelvin.
  state?: (entity: EntityState) => string | undefined
}

const has = (attribute: string) => (entity: EntityState) => listOf(entity, attribute).length > 0
const bit = (value: number) => (entity: EntityState) => supports(entity, value)
const numeric = (entity: EntityState) => Number.isFinite(Number(entity.state)) && entity.state !== ''
const menu = (id: keyof typeof climate.MENUS) => (props: FeatureProps) => (
  <climate.ModeMenu {...props} menu={climate.MENUS[id]} />
)

const COVERS = ['cover', 'valve']

export const FEATURES: FeatureDef[] = [
  {
    id: 'brightness',
    label: 'Brightness slider', name: 'Brightness',
    domains: ['light'],
    supports: light.dims,
  },
  {
    id: 'color-temp',
    label: 'White temperature bar', name: 'White Temperature',
    domains: ['light'],
    supports: light.warms,
    View: light.ColorTemp,
    state: light.tempState,
  },
  {
    id: 'color',
    label: 'Color bar', name: 'Color',
    domains: ['light'],
    supports: light.colors,
    View: light.Hue,
    state: light.hueState,
  },
  {
    id: 'color-favorites',
    label: 'Favorite color buttons', name: 'Favorite Colors',
    domains: ['light'],
    supports: e => light.warms(e) || light.colors(e),
    View: light.ColorFavorites,
  },
  { id: 'effect', label: 'Effect menu', name: 'Effects', domains: ['light'], supports: has('effect_list'), View: light.Effect },
  {
    id: 'open-close',
    label: 'Open, stop and close buttons', name: 'Buttons',
    domains: COVERS,
    supports: e => supports(e, cover.OPEN) || supports(e, cover.CLOSE),
    View: cover.OpenClose,
  },
  {
    id: 'position',
    label: 'Position slider', name: 'Position',
    domains: COVERS,
    supports: bit(cover.SET_POSITION),
  },
  {
    id: 'position-buttons',
    label: 'Position slider with buttons', name: 'Position with Buttons',
    domains: ['cover'],
    supports: bit(cover.SET_POSITION),
  },
  {
    id: 'position-favorite',
    label: 'Favorite position buttons', name: 'Favorite Positions',
    domains: COVERS,
    supports: bit(cover.SET_POSITION),
    View: cover.Favorites,
    wide: true,
  },
  {
    id: 'tilt',
    label: 'Slat open and close buttons', name: 'Slat Buttons',
    domains: ['cover'],
    supports: e => supports(e, cover.OPEN_TILT) || supports(e, cover.CLOSE_TILT),
    View: cover.Tilt,
  },
  {
    id: 'tilt-position',
    label: 'Slat tilt slider', name: 'Slat Tilt',
    domains: ['cover'],
    supports: bit(cover.SET_TILT),
  },
  {
    id: 'tilt-favorite',
    label: 'Favorite tilt buttons', name: 'Favorite Tilts',
    domains: ['cover'],
    supports: bit(cover.SET_TILT),
    View: props => <cover.Favorites {...props} tilt />,
    wide: true,
  },
  { id: 'speed', label: 'Speed slider', name: 'Speed', domains: ['fan'], supports: bit(cover.FAN.speed) },
  {
    id: 'speed-buttons',
    label: 'Speed buttons', name: 'Speed Buttons',
    domains: ['fan'],
    // Off and up to four speeds, like Home Assistant's own.
    supports: e => supports(e, cover.FAN.speed) && cover.speedCount(e) > 0 && cover.speedCount(e) <= 4,
    View: cover.FanSpeeds,
    wide: e => cover.speedCount(e) > 2,
  },
  {
    id: 'speed-menu',
    label: 'Speed menu', name: 'Speed Menu',
    domains: ['fan'],
    supports: e => supports(e, cover.FAN.speed) && cover.speedCount(e) > 0 && cover.speedCount(e) <= 10,
    View: cover.FanSpeedMenu,
  },
  {
    id: 'preset-modes',
    label: 'Preset menu', name: 'Presets',
    domains: ['fan'],
    supports: e => supports(e, cover.FAN.preset) && has('preset_modes')(e),
    View: cover.FanPreset,
  },
  {
    id: 'direction',
    label: 'Forward and reverse buttons', name: 'Direction',
    domains: ['fan'],
    supports: bit(cover.FAN.direction),
    View: cover.FanDirection,
  },
  {
    id: 'oscillate',
    label: 'Oscillate button', name: 'Oscillate',
    domains: ['fan'],
    supports: bit(cover.FAN.oscillate),
    View: cover.FanOscillate,
  },
  {
    id: 'hvac-modes',
    label: 'Mode buttons', name: 'Modes',
    domains: ['climate'],
    supports: has('hvac_modes'),
    View: climate.HvacModes,
    wide: true,
  },
  {
    id: 'target-temperature',
    label: 'Temperature minus and plus buttons', name: 'Temperature Buttons',
    domains: ['climate', 'water_heater'],
    supports: e => numberOf(e, 'temperature') !== null || numberOf(e, 'target_temp_low') !== null,
    View: climate.TargetTemperature,
    // A range is two temperatures with minus and plus around them.
    wide: e => numberOf(e, 'temperature') === null && numberOf(e, 'target_temp_low') !== null,
  },
  {
    id: 'preset-modes',
    label: 'Preset menu', name: 'Presets',
    domains: ['climate'],
    supports: has('preset_modes'),
    View: menu('preset-modes'),
  },
  { id: 'fan-modes', label: 'Fan menu', name: 'Fan Menu', domains: ['climate'], supports: has('fan_modes'), View: menu('fan-modes') },
  {
    id: 'swing-modes',
    label: 'Swing menu', name: 'Swing',
    domains: ['climate'],
    supports: has('swing_modes'),
    View: menu('swing-modes'),
  },
  {
    id: 'swing-horizontal-modes',
    label: 'Side to side swing menu', name: 'Side Swing',
    domains: ['climate'],
    supports: has('swing_horizontal_modes'),
    View: menu('swing-horizontal-modes'),
  },
  {
    id: 'humidity-slider',
    label: 'Humidity slider', name: 'Humidity',
    domains: ['humidifier'],
    supports: e => numberOf(e, 'humidity') !== null,
  },
  {
    id: 'target-humidity',
    label: 'Humidity minus and plus buttons', name: 'Humidity Buttons',
    domains: ['climate', 'humidifier'],
    supports: e => numberOf(e, 'humidity') !== null && (domainOf(e) === 'humidifier' || supports(e, 4)),
    View: climate.TargetHumidity,
  },
  {
    id: 'temperature-slider',
    label: 'Temperature slider', name: 'Temperature',
    domains: ['climate', 'water_heater'],
    supports: e => numberOf(e, 'temperature') !== null,
  },
  {
    id: 'operation-mode-buttons',
    label: 'Operation mode buttons', name: 'Modes',
    domains: ['water_heater'],
    supports: has('operation_list'),
    View: climate.OperationModes,
    wide: e => listOf(e, 'operation_list').length > 2,
  },
  {
    id: 'operation-modes',
    label: 'Operation mode menu', name: 'Mode Menu',
    domains: ['water_heater'],
    supports: has('operation_list'),
    View: menu('operation-modes'),
  },
  { id: 'modes', label: 'Mode menu', name: 'Mode Menu', domains: ['humidifier'], supports: has('available_modes'), View: menu('modes') },
  {
    id: 'playback',
    label: 'Play, pause and skip buttons', name: 'Playback',
    domains: ['media_player'],
    supports: e =>
      [media.MEDIA.pause, media.MEDIA.play, media.MEDIA.previous, media.MEDIA.next].some(b => supports(e, b)),
    View: media.Playback,
  },
  {
    id: 'volume-slider',
    label: 'Volume slider', name: 'Volume',
    domains: ['media_player'],
    supports: bit(media.MEDIA.volumeSet),
  },
  {
    id: 'volume-buttons',
    label: 'Volume down and up buttons', name: 'Volume Buttons',
    domains: ['media_player'],
    supports: e => supports(e, media.MEDIA.volumeStep) || supports(e, media.MEDIA.volumeSet),
    View: media.VolumeButtons,
  },
  {
    id: 'source',
    label: 'Source menu', name: 'Sources',
    domains: ['media_player'],
    supports: e => supports(e, media.MEDIA.source) && has('source_list')(e),
    View: media.Source,
  },
  {
    id: 'sound-mode',
    label: 'Sound mode menu', name: 'Sound Modes',
    domains: ['media_player'],
    supports: e => supports(e, media.MEDIA.soundMode) && has('sound_mode_list')(e),
    View: media.SoundMode,
  },
  {
    id: 'open-door',
    label: 'Two taps to open the door', name: 'Door Opener',
    domains: ['lock'],
    supports: bit(1),
  },
  {
    id: 'commands',
    label: 'Start, pause and dock buttons', name: 'Buttons',
    domains: ['vacuum'],
    View: other.VacuumCommands,
    wide: true,
  },
  {
    id: 'fan-speed',
    label: 'Suction menu', name: 'Suction',
    domains: ['vacuum'],
    supports: e => supports(e, other.VACUUM_FAN_SPEED) && has('fan_speed_list')(e),
    View: other.VacuumFanSpeed,
  },
  { id: 'commands', label: 'Mow, pause and dock buttons', name: 'Buttons', domains: ['lawn_mower'], View: other.MowerCommands },
  {
    id: 'alarm-modes',
    label: 'Arm and disarm buttons', name: 'Arm Buttons',
    domains: ['alarm_control_panel'],
    View: other.AlarmModes,
    wide: true,
  },
  { id: 'actions', label: 'Minus, reset and plus buttons', name: 'Buttons', domains: ['counter'], View: other.CounterActions },
  { id: 'actions', label: 'Start, pause and cancel buttons', name: 'Buttons', domains: ['timer'], View: other.TimerActions },
  {
    id: 'select-options',
    label: 'Option menu', name: 'Menu',
    domains: ['select', 'input_select'],
    supports: has('options'),
    View: other.SelectOptions,
  },
  {
    id: 'numeric-input',
    label: 'Value slider or minus and plus', name: 'Slider',
    domains: ['number', 'input_number'],
    supports: numeric,
    View: other.NumericInput,
  },
  { id: 'date-set', label: 'Date picker', name: 'Date Picker', domains: ['date', 'datetime', 'input_datetime'], View: other.DateSet },
  { id: 'update-actions', label: 'Install and skip buttons', name: 'Buttons', domains: ['update'], View: other.UpdateActions },
  {
    id: 'button',
    label: 'Press button', name: 'Press Button',
    domains: ['button', 'input_button', 'script', 'scene'],
    View: other.PressButton,
  },
  {
    id: 'trend-graph',
    label: 'Graph of the last day', name: 'Graph',
    domains: ['sensor'],
    supports: e => numeric(e) && typeof e.attributes.unit_of_measurement === 'string',
    View: other.TrendGraph,
  },
  {
    id: 'bar-gauge',
    label: 'Percentage fill', name: 'Fill',
    domains: ['sensor'],
    supports: e => numeric(e) && e.attributes.unit_of_measurement === '%',
  },
]

// The features an entity can have, in the order the card picker offers them.
export function featuresFor(entity: EntityState | undefined) {
  if (!entity) return []
  const domain = domainOf(entity)
  return FEATURES.filter(f => f.domains.includes(domain) && (f.supports?.(entity) ?? true))
}

// Whether a tile's feature goes along its bottom, making it a row taller.
export const addsRow = (feature: string | undefined) =>
  !!feature && !!FEATURES.find(f => f.id === feature && f.View && f.row)

// What a tile with the feature says under its name, when the feature
// has something to say.
export const featureState = (feature: string | undefined, entity: EntityState) =>
  FEATURES.find(f => f.id === feature && f.domains.includes(domainOf(entity)))?.state?.(entity)

// Whether a tile is wide, because its config says so or because its
// feature only fits a wide one, for its entity when it is known.
export const isWide = (config: { size?: string; entity?: string; feature?: string }, entity?: EntityState) =>
  config.size === 'wide' ||
  (!!config.feature &&
    FEATURES.some(
      f =>
        f.id === config.feature &&
        f.domains.includes(config.entity?.split('.')[0] ?? '') &&
        (typeof f.wide === 'function' ? !!entity && f.wide(entity) : !!f.wide),
    ))

// The modes a wide thermostat or water heater shows along its bottom.
export const MODE_LISTS: Record<string, string> = { climate: 'hvac_modes', water_heater: 'operation_list' }

// How many rows a tile takes: three for a feature along its bottom, or for
// a wide thermostat or water heater with its temperature in the top right
// corner and its modes along the bottom, and two for the rest.
export const tileRows = (config: { size?: string; entity?: string; feature?: string }, entity?: EntityState) => {
  const list = MODE_LISTS[config.entity?.split('.')[0] ?? '']
  return addsRow(config.feature) ||
    (config.size === 'wide' && !config.feature && !!list && (!entity || listOf(entity, list).length > 0))
    ? 3
    : 2
}

// Whether the feature is drawn across from the icon.
export const besideIcon = (feature: string | undefined) =>
  !!feature && !!FEATURES.find(f => f.id === feature && f.View && !f.row)

// The features of a domain, for the editor, whatever the entity has.
// What the editor calls a control that means something else for each
// domain, when it lists them for a tile of more than one.
const SHARED: Record<string, string> = { actions: 'Counter or timer buttons', commands: 'Vacuum or mower buttons' }

export function featuresOf(domains: string[] | 'any') {
  const seen = new Map<string, string>()
  for (const f of FEATURES)
    if (domains === 'any' || f.domains.some(d => domains.includes(d)))
      seen.set(f.id, seen.has(f.id) && seen.get(f.id) !== f.label ? (SHARED[f.id] ?? seen.get(f.id)!) : f.label)
  return [...seen].map(([value, label]) => ({ value, label }))
}

// The feature a tile's config names, drawn for its entity.
export function Feature(props: FeatureProps) {
  const domain = domainOf(props.entity)
  const def = FEATURES.find(f => f.id === props.config.feature && f.domains.includes(domain))
  if (!def?.View) return null
  const View = def.View
  return (
    <div className="dio-feature">
      <View {...props} />
    </div>
  )
}
