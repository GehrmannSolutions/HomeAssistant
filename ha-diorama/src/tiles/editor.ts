import { featuresOf } from '#/tiles/features/index.tsx'
import { PHOSPHOR_ICONS, phosphor } from '#/tiles/icons.ts'

// The visual editors of the tiles, as forms Home Assistant draws itself
// from a schema.

type Field = { name: string; required?: boolean; selector?: Record<string, unknown>; [key: string]: unknown }
export type Extra =
  | 'invert'
  | 'battery_entity'
  | 'tap_behavior'
  | 'camera'
  | 'calendar'
  | 'graph'
  | 'gauge'
  | 'map'
  | 'forecast'
  | 'art'
  | 'confirm'
  | 'remote'

const LABELS: Record<string, string> = {
  entity: 'Entity',
  name: 'Name',
  icon: 'Icon',
  size: 'Size',
  area: 'Area',
  room_filter: 'With a room in view',
  never_hide: 'Never hide',
  tap_action: 'Tap action',
  hold_action: 'Hold action',
  haptic: 'Vibrate on tap',
  color: 'Color while on',
  state_text: 'State text',
  invert: 'Inverted',
  battery_entity: 'Battery sensor',
  tap_behavior: 'Tap opens',
  camera_view: 'Camera view',
  aspect_ratio: 'Aspect ratio',
  title: 'Title',
  appearance: 'Appearance',
  feature: 'Along the bottom',
  entities: 'More calendars',
  days: 'Days',
  chart: 'Chart',
  art: 'Cover art',
  hours: 'Hours',
  min: 'Minimum',
  max: 'Maximum',
  hours_to_show: 'Path of the last hours',
  layout: 'Layout',
  forecast_type: 'Forecast',
  interactions: 'Interactions',
  confirm: 'Two taps',
  volume_entity: 'Volume of',
  power_entity: 'Power turns',
}

const HELPERS: Record<string, string> = {
  area: 'The room filter uses the entity area when this is empty',
  room_filter: 'Only while a diorama card hides the widgets of other rooms',
  never_hide: 'Keeps it showing whatever room a diorama card is in',
  color: 'Any CSS color, like #ffb340',
  state_text: 'Replaces the line under the name',
  invert: 'For a screen that comes down to open',
  battery_entity: 'Found on the same device when empty',
  aspect_ratio: 'Width to height, like 16:9',
  title: 'The area name when empty',
  feature: 'A control beside the icon. Some only fit a wide widget and make it wide',
  confirm: 'Acts only on a second tap, so a stray one does nothing',
  volume_entity: 'The player the volume keys and mute change, like the TV a box is plugged into',
  power_entity: 'Turned on and off by power in its place, like a toggle that also sets the room',
}

const NEVER_HIDE: Field = { name: 'never_hide', selector: { boolean: {} } }

const ROOM_FILTER: Field = {
  name: 'room_filter',
  selector: {
    select: {
      mode: 'dropdown',
      options: [
        { value: 'hide', label: 'Show it only in its own area (or always, with no area)' },
        { value: 'room', label: 'Show it only in its own room' },
        { value: 'home', label: 'Show it only with the whole home in view' },
      ],
    },
  },
}

const EXTRAS: Record<Extra, Field[]> = {
  invert: [{ name: 'invert', selector: { boolean: {} } }],
  remote: [
    { name: 'volume_entity', selector: { entity: { filter: { domain: 'media_player' } } } },
    { name: 'power_entity', selector: { entity: {} } },
  ],
  // Asked with the other interactions instead.
  confirm: [],
  battery_entity: [
    { name: 'battery_entity', selector: { entity: { filter: { domain: 'sensor', device_class: 'battery' } } } },
  ],
  tap_behavior: [
    {
      name: 'tap_behavior',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'menu', label: 'A menu of the options' },
            { value: 'cycle', label: 'The next option' },
          ],
        },
      },
    },
  ],
  calendar: [
    { name: 'entities', selector: { entity: { multiple: true, filter: { domain: 'calendar' } } } },
    { name: 'days', selector: { number: { min: 1, max: 31, mode: 'box' } } },
  ],
  graph: [
    {
      name: 'chart',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'line', label: 'A line over the last hours' },
            { value: 'bar', label: 'A bar for each of the last days' },
          ],
        },
      },
    },
    { name: 'hours', selector: { number: { min: 1, max: 168, mode: 'box' } } },
    { name: 'days', selector: { number: { min: 2, max: 31, mode: 'box' } } },
  ],
  art: [
    {
      name: 'art',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'background', label: 'Blurred behind the whole card' },
            { value: 'icon', label: 'Square in place of the icon' },
          ],
        },
      },
    },
  ],
  gauge: [
    { name: 'min', selector: { number: { mode: 'box' } } },
    { name: 'max', selector: { number: { mode: 'box' } } },
  ],
  map: [
    {
      name: 'layout',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'full', label: 'Over the whole card, with the name on it' },
            { value: 'top', label: 'Across the top, over the name' },
          ],
        },
      },
    },
    { name: 'hours_to_show', selector: { number: { min: 0, max: 168, mode: 'box' } } },
  ],
  forecast: [
    {
      name: 'forecast_type',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'hourly', label: 'The next hours' },
            { value: 'daily', label: 'The next days' },
          ],
        },
      },
    },
  ],
  camera: [
    {
      name: 'camera_view',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'auto', label: 'Snapshots' },
            { value: 'live', label: 'Live' },
          ],
        },
      },
    },
    { name: 'aspect_ratio', selector: { text: {} } },
  ],
}

function form(schema: Field[]) {
  return {
    schema,
    computeLabel: (field: Field) => LABELS[field.name] ?? field.name,
    computeHelper: (field: Field) => HELPERS[field.name],
  }
}

// A panel, like the calendar, has a size of its own and no control along
// its bottom.
export function tileForm(domains: string[] | 'any', extras: Extra[] = [], panel = false) {
  const sized = !panel && !extras.includes('camera')
  const filter = domains === 'any' ? {} : { filter: { domain: domains } }
  return form([
    { name: 'entity', required: true, selector: { entity: filter } },
    {
      name: 'appearance',
      type: 'expandable',
      flatten: true,
      expanded: true,
      schema: [
        {
          name: '',
          type: 'grid',
          schema: [
            { name: 'name', selector: { text: {} } },
            { name: 'icon', selector: { icon: {} } },
            ...(sized
              ? [
                  {
                    name: 'size',
                    selector: {
                      select: {
                        mode: 'dropdown',
                        options: [
                          { value: 'small', label: 'Small' },
                          { value: 'wide', label: 'Wide' },
                          ...(extras.includes('forecast') ? [{ value: 'large', label: 'Large' }] : []),
                        ],
                      },
                    },
                  },
                ]
              : []),
            { name: 'color', selector: { text: {} } },
          ],
        },
        { name: 'state_text', selector: { text: {} } },
        ...(panel ? [] : featureField(domains)),
        ...extras.flatMap(extra => EXTRAS[extra]),
        { name: 'area', selector: { area: {} } },
        NEVER_HIDE,
        ROOM_FILTER,
      ],
    },
    {
      name: 'interactions',
      type: 'expandable',
      flatten: true,
      schema: [
        { name: 'tap_action', selector: { ui_action: {} } },
        { name: 'hold_action', selector: { ui_action: {} } },
        ...(extras.includes('confirm') ? [{ name: 'confirm', selector: { boolean: {} } }] : []),
        { name: 'haptic', selector: { boolean: {} } },
      ],
    },
  ])
}

// The controls a tile can show along its bottom, for the domains it shows.
function featureField(domains: string[] | 'any'): Field[] {
  const options = featuresOf(domains)
  if (options.length === 0) return []
  return [{ name: 'feature', selector: { select: { mode: 'dropdown', options } } }]
}

export function titleForm() {
  return form([
    { name: 'title', selector: { text: {} } },
    { name: 'area', selector: { area: {} } },
    NEVER_HIDE,
    ROOM_FILTER,
  ])
}

type IconSet = {
  getIcon: (name: string) => Promise<{ path: string; viewBox?: string }>
  getIconList?: () => Promise<{ name: string }[]>
}

declare global {
  interface Window {
    customIcons?: Record<string, IconSet>
  }
}

// The bundled Phosphor icons, offered as ph: in Home Assistant's icon
// picker and its own icon element, unless something else already took the
// name. Each is a single path, so it draws as Home Assistant draws its own.
export function registerIcons() {
  window.customIcons ??= {}
  if (window.customIcons.ph) return
  const path = (name: string) => phosphor(name, false)?.match(/ d="([^"]+)"/)?.[1] ?? ''
  window.customIcons.ph = {
    getIcon: async name => ({ path: path(name), viewBox: '0 0 256 256' }),
    getIconList: async () => PHOSPHOR_ICONS.map(name => ({ name })),
  }
}
