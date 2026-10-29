// Every card the card picker would suggest for an entity of each kind, on
// a mock dashboard whose mock Home Assistant answers the actions, so each
// one can be tried, hovered and pressed without a real one. Served by the
// dev server, never built into the card:
//
//   http://localhost:5173/src/dev/cards.html
//
// light=1 shows the light dashboard, and card=dio-dial one kind of card.
import { registerTiles } from '#/tiles/index.tsx'
import type { EntityState, HomeAssistant } from '#/types.ts'

registerTiles()

const light = new URLSearchParams(location.search).get('light') === '1'
const HOUR = 3_600_000
const DAY = 24 * HOUR
const iso = (time = Date.now()) => new Date(time).toISOString()
const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}): EntityState => ({
  entity_id,
  state: value,
  attributes,
  last_changed: iso(),
  last_updated: iso(),
})

// Cover art without the network: a gradient drawn as an image.
const art = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff375f"/><stop offset="0.5" stop-color="#bf5af2"/><stop offset="1" stop-color="#0a84ff"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="210" cy="90" r="50" fill="#ffd60a" opacity="0.85"/></svg>',
)}`

const ALARM_ALL = 1 | 2 | 4 | 8 | 16 | 32
const MEDIA_ALL = 1 | 2 | 4 | 8 | 16 | 32 | 128 | 256 | 1024 | 2048 | 4096 | 16384 | 32768 | 65536 | 262144

const ENTITIES: EntityState[] = [
  state('light.living_room', 'on', {
    friendly_name: 'Living Room Lights',
    brightness: 180,
    color_mode: 'hs',
    hs_color: [30, 60],
    color_temp_kelvin: 3000,
    min_color_temp_kelvin: 2000,
    max_color_temp_kelvin: 6500,
    supported_color_modes: ['color_temp', 'hs'],
    effect_list: ['None', 'Colorloop', 'Candle'],
    effect: 'None',
  }),
  state('light.desk', 'off', { friendly_name: 'Desk Lamp', supported_color_modes: ['brightness'] }),
  state('switch.coffee', 'off', { friendly_name: 'Coffee Machine' }),
  state('input_boolean.guests', 'on', { friendly_name: 'Guest Mode' }),
  state('fan.ceiling', 'on', {
    friendly_name: 'Ceiling Fan',
    supported_features: 1 | 2 | 4 | 8 | 16 | 32,
    percentage: 66,
    percentage_step: 33.33,
    oscillating: false,
    direction: 'forward',
    preset_modes: ['auto', 'smart', 'sleep'],
    preset_mode: null,
  }),
  state('cover.living_blinds', 'open', {
    friendly_name: 'Living Room Blinds',
    supported_features: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128,
    current_position: 70,
    current_tilt_position: 50,
  }),
  // Rolls down to open, so its tiles are inverted and fill from the top.
  state('cover.projector_screen', 'open', {
    friendly_name: 'Projector Screen',
    device_class: 'shade',
    supported_features: 1 | 2 | 4 | 8,
    current_position: 40,
  }),
  state('cover.garage', 'closed', { friendly_name: 'Garage Door', device_class: 'garage', supported_features: 1 | 2 }),
  state('valve.garden', 'closed', { friendly_name: 'Garden Valve', supported_features: 1 | 2 | 4 | 8 }),
  state('climate.living', 'heat', {
    friendly_name: 'Thermostat',
    hvac_action: 'heating',
    current_temperature: 20.5,
    temperature: 22,
    min_temp: 7,
    max_temp: 35,
    target_temp_step: 0.5,
    hvac_modes: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only', 'heat_cool'],
    preset_modes: ['home', 'eco', 'away'],
    preset_mode: 'home',
    fan_modes: ['auto', 'low', 'high'],
    fan_mode: 'auto',
    swing_modes: ['off', 'vertical', 'both'],
    swing_mode: 'off',
  }),
  state('climate.ecobee', 'heat_cool', {
    friendly_name: 'Air Conditioner',
    hvac_action: 'idle',
    current_temperature: 23,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 35,
    hvac_modes: ['off', 'cool', 'heat_cool', 'heat'],
    supported_features: 4,
    humidity: 50,
    current_humidity: 46,
  }),
  state('water_heater.tank', 'eco', {
    friendly_name: 'Water Heater',
    current_temperature: 48,
    temperature: 50,
    min_temp: 35,
    max_temp: 65,
    operation_mode: 'eco',
    operation_list: ['eco', 'electric', 'performance', 'off'],
  }),
  state('humidifier.bedroom', 'on', {
    friendly_name: 'Humidifier',
    humidity: 54,
    current_humidity: 41,
    min_humidity: 30,
    max_humidity: 80,
    mode: 'normal',
    available_modes: ['normal', 'eco', 'boost', 'sleep'],
  }),
  state('media_player.living', 'playing', {
    friendly_name: 'Living Room Speaker',
    supported_features: MEDIA_ALL,
    media_title: 'Night Drive',
    media_artist: 'Some Band',
    media_album_name: 'Late Roads',
    media_duration: 245,
    media_position: 61,
    media_position_updated_at: iso(),
    entity_picture: art,
    volume_level: 0.4,
    is_volume_muted: false,
    shuffle: false,
    repeat: 'off',
    source: 'Radio',
    source_list: ['Radio', 'Bluetooth', 'TV', 'Line in'],
    sound_mode: 'Music',
    sound_mode_list: ['Music', 'Movie', 'Night'],
  }),
  state('lock.front', 'locked', { friendly_name: 'Front Door', supported_features: 1 }),
  state('alarm_control_panel.security', 'disarmed', {
    friendly_name: 'Security',
    supported_features: ALARM_ALL,
    code_format: 'number',
    code_arm_required: true,
  }),
  state('vacuum.robot', 'docked', {
    friendly_name: 'Robot Vacuum',
    supported_features: 4 | 8 | 16 | 32 | 512 | 1024 | 8192,
    fan_speed: 'Standard',
    fan_speed_list: ['Quiet', 'Standard', 'Max'],
    battery_level: 87,
  }),
  state('lawn_mower.garden', 'docked', { friendly_name: 'Lawn Mower', supported_features: 1 | 2 | 4 }),
  state('sensor.outside_temperature', '14.2', {
    friendly_name: 'Outside Temperature',
    device_class: 'temperature',
    state_class: 'measurement',
    unit_of_measurement: '°C',
  }),
  state('sensor.phone_battery', '64', {
    friendly_name: 'Phone Battery',
    device_class: 'battery',
    state_class: 'measurement',
    unit_of_measurement: '%',
  }),
  state('sensor.energy', '1284.6', {
    friendly_name: 'Energy Used',
    device_class: 'energy',
    state_class: 'total_increasing',
    unit_of_measurement: 'kWh',
  }),
  state('binary_sensor.front_door', 'off', { friendly_name: 'Front Door Contact', device_class: 'door' }),
  state('counter.coffees', '3', { friendly_name: 'Coffees Today', step: 1, minimum: 0, maximum: 20 }),
  state('timer.laundry', 'active', {
    friendly_name: 'Laundry',
    duration: '0:45:00',
    remaining: '0:21:30',
    finishes_at: iso(Date.now() + 21.5 * 60_000),
  }),
  state('input_number.volume', '35', {
    friendly_name: 'Night Volume',
    min: 0,
    max: 100,
    step: 5,
    mode: 'slider',
    unit_of_measurement: '%',
  }),
  state('number.target_speed', '3', { friendly_name: 'Pump Speed', min: 1, max: 5, step: 1, mode: 'box' }),
  state('select.speed', 'Ridiculous', {
    friendly_name: 'Speed',
    options: ['Light', 'Ridiculous', 'Ludicrous', 'Plaid'],
  }),
  state('input_datetime.wake', '2026-10-12', { friendly_name: 'Wake Up Day', has_date: true, has_time: false }),
  state('update.firmware', 'on', {
    friendly_name: 'Hub Firmware',
    installed_version: '1.4.2',
    latest_version: '1.5.0',
    supported_features: 1 | 4,
  }),
  state('button.doorbell', iso(Date.now() - 2 * HOUR), { friendly_name: 'Ring Doorbell' }),
  state('scene.movie', iso(Date.now() - DAY), { friendly_name: 'Movie Night' }),
  state('script.goodnight', 'off', { friendly_name: 'Good Night' }),
  state('weather.home', 'partlycloudy', {
    friendly_name: 'Home',
    temperature: 18,
    temperature_unit: '°C',
    humidity: 60,
    supported_features: 1 | 2,
  }),
  state('calendar.family', 'off', { friendly_name: 'Family', message: 'Dentist' }),
  state('todo.shopping', '2', { friendly_name: 'Shopping List', supported_features: 1 | 2 | 4 | 8 | 16 | 32 | 64 }),
  state('person.alex', 'home', { friendly_name: 'Alex', latitude: 41.39, longitude: 2.17 }),
  state('image.doorbell', iso(), { friendly_name: 'Doorbell Snapshot', entity_picture: art }),
]

const states: Record<string, EntityState> = Object.fromEntries(ENTITIES.map(s => [s.entity_id, s]))
const cards: HTMLElement[] = []
let hass: HomeAssistant

function update(id: string, value: string, attributes: Record<string, unknown> = {}) {
  const old = states[id]
  states[id] = {
    ...old,
    state: value,
    attributes: { ...old.attributes, ...attributes },
    last_changed: value === old.state ? old.last_changed : iso(),
    last_updated: iso(),
  }
  hass = { ...hass, states: { ...states } }
  for (const card of cards) (card as unknown as { hass: HomeAssistant }).hass = hass
}

// The to-do items, sent again to every list that listens when they change.
type Item = { uid: string; summary: string; status: 'needs_action' | 'completed'; due?: string }
let items: Item[] = [
  { uid: '1', summary: 'Oat milk', status: 'needs_action' },
  { uid: '2', summary: 'Coffee beans', status: 'needs_action', due: iso(Date.now() + DAY).slice(0, 10) },
  { uid: '3', summary: 'Bread', status: 'completed' },
]
const listeners = new Set<(message: { items: Item[] }) => void>()
const sendItems = () => {
  for (const listen of listeners) listen({ items })
  update('todo.shopping', String(items.filter(item => item.status === 'needs_action').length))
}

const on = (id: string) => states[id].state !== 'off'
const flip = (id: string, service: string) =>
  service === 'toggle' ? !on(id) : service === 'turn_on' ? true : service === 'turn_off' ? false : on(id)

const last: Record<string, unknown> = {}

// The mock services, enough of each domain for every card to answer.
const SERVICES: Record<string, (id: string, service: string, data: Record<string, unknown>) => void> = {
  light: (id, service, data) => {
    const { entity_id: _, brightness_pct, ...rest } = data
    const now = flip(id, service)
    // Like Home Assistant, a light that comes on keeps the brightness it had,
    // and one that is off has none.
    if (typeof states[id].attributes.brightness === 'number') last[id] = states[id].attributes.brightness
    const brightness = !now
      ? null
      : typeof brightness_pct === 'number'
        ? Math.round(brightness_pct * 2.55)
        : (last[id] ?? 255)
    // Like Home Assistant, a white or a color puts the light in its mode.
    const mode =
      'color_temp_kelvin' in rest
        ? { color_mode: 'color_temp' }
        : 'hs_color' in rest
          ? { color_mode: 'hs', color_temp_kelvin: null }
          : {}
    update(id, now ? 'on' : 'off', { ...rest, ...mode, brightness })
  },
  switch: (id, service) => update(id, flip(id, service) ? 'on' : 'off'),
  input_boolean: (id, service) => update(id, flip(id, service) ? 'on' : 'off'),
  humidifier: (id, service, data) => {
    if (service === 'set_humidity') update(id, states[id].state, { humidity: data.humidity })
    else if (service === 'set_mode') update(id, states[id].state, { mode: data.mode })
    else update(id, flip(id, service) ? 'on' : 'off')
  },
  fan: (id, service, data) => {
    if (service === 'set_percentage') update(id, data.percentage ? 'on' : 'off', { percentage: data.percentage })
    else if (service === 'oscillate') update(id, states[id].state, { oscillating: data.oscillating })
    else if (service === 'set_direction') update(id, states[id].state, { direction: data.direction })
    else if (service === 'set_preset_mode') update(id, 'on', { preset_mode: data.preset_mode })
    else update(id, flip(id, service) ? 'on' : 'off')
  },
  cover: (id, service, data) => {
    if (service === 'open_cover') update(id, 'open', { current_position: 100 })
    if (service === 'close_cover') update(id, 'closed', { current_position: 0 })
    if (service === 'toggle') update(id, on(id) && states[id].state !== 'closed' ? 'closed' : 'open')
    if (service === 'set_cover_position')
      update(id, data.position ? 'open' : 'closed', { current_position: data.position })
    if (service === 'open_cover_tilt') update(id, states[id].state, { current_tilt_position: 100 })
    if (service === 'close_cover_tilt') update(id, states[id].state, { current_tilt_position: 0 })
    if (service === 'set_cover_tilt_position')
      update(id, states[id].state, { current_tilt_position: data.tilt_position })
  },
  valve: (id, service, data) => {
    if (service === 'open_valve') update(id, 'open', { current_position: 100 })
    if (service === 'close_valve') update(id, 'closed', { current_position: 0 })
    if (service === 'set_valve_position')
      update(id, data.position ? 'open' : 'closed', { current_position: data.position })
  },
  climate: (id, service, data) => {
    const { entity_id: _, ...rest } = data
    if (service === 'set_hvac_mode') update(id, data.hvac_mode as string)
    else if (service === 'turn_off') update(id, 'off')
    else if (service === 'turn_on') update(id, 'heat')
    else update(id, states[id].state, rest)
  },
  water_heater: (id, service, data) => {
    const { entity_id: _, ...rest } = data
    if (service === 'set_operation_mode') update(id, data.operation_mode as string, rest)
    else update(id, states[id].state, rest)
  },
  media_player: (id, service, data) => {
    const s = states[id]
    // Where the song is now, so pausing or playing keeps it there.
    const since = Date.parse(String(s.attributes.media_position_updated_at))
    const now = Number(s.attributes.media_position) + (s.state === 'playing' && since ? (Date.now() - since) / 1000 : 0)
    const at = { media_position_updated_at: iso(), media_position: now }
    if (service === 'media_play_pause') update(id, s.state === 'playing' ? 'paused' : 'playing', at)
    if (service === 'media_play') update(id, 'playing', at)
    if (service === 'media_pause') update(id, 'paused', at)
    if (service === 'media_stop') update(id, 'idle')
    if (service === 'media_seek') update(id, s.state, { ...at, media_position: data.seek_position })
    if (service === 'media_next_track' || service === 'media_previous_track')
      update(id, 'playing', { ...at, media_position: 0 })
    if (service === 'volume_set') update(id, s.state, { volume_level: data.volume_level })
    if (service === 'volume_up')
      update(id, s.state, { volume_level: Math.min(1, Number(s.attributes.volume_level) + 0.05) })
    if (service === 'volume_down')
      update(id, s.state, { volume_level: Math.max(0, Number(s.attributes.volume_level) - 0.05) })
    if (service === 'volume_mute') update(id, s.state, { is_volume_muted: data.is_volume_muted })
    if (service === 'select_source') update(id, s.state, { source: data.source })
    if (service === 'select_sound_mode') update(id, s.state, { sound_mode: data.sound_mode })
    if (service === 'shuffle_set') update(id, s.state, { shuffle: data.shuffle })
    if (service === 'repeat_set') update(id, s.state, { repeat: data.repeat })
    if (service === 'turn_off') update(id, 'off')
    if (service === 'turn_on') update(id, 'idle')
  },
  lock: (id, service) => {
    update(id, service === 'lock' ? 'locked' : service === 'open' ? 'open' : 'unlocked')
    // A door that was opened latches again a moment later, but stays open
    // in the showcase so the recording ends on it.
    if (service === 'open' && !params.has('showcase')) setTimeout(() => update(id, 'locked'), 3000)
  },
  alarm_control_panel: (id, service, data) => {
    if (states[id].attributes.code_format && data.code !== '1234' && service !== 'alarm_disarm' && !data.code) return
    update(id, service === 'alarm_disarm' ? 'disarmed' : service.replace('alarm_arm_', 'armed_'))
  },
  vacuum: (id, service, data) => {
    const next: Record<string, string> = {
      start: 'cleaning',
      pause: 'paused',
      stop: 'idle',
      return_to_base: 'returning',
      clean_spot: 'cleaning',
    }
    if (service === 'set_fan_speed') update(id, states[id].state, { fan_speed: data.fan_speed })
    else update(id, next[service] ?? states[id].state)
  },
  lawn_mower: (id, service) =>
    update(id, { start_mowing: 'mowing', pause: 'paused', dock: 'returning' }[service] ?? states[id].state),
  counter: (id, service) => {
    const value = Number(states[id].state)
    update(id, String(service === 'increment' ? value + 1 : service === 'decrement' ? Math.max(0, value - 1) : 0))
  },
  timer: (id, service) => {
    const next: Record<string, string> = { start: 'active', pause: 'paused', cancel: 'idle', finish: 'idle' }
    update(
      id,
      next[service] ?? states[id].state,
      service === 'start' ? { finishes_at: iso(Date.now() + 20 * 60_000) } : {},
    )
  },
  select: (id, _service, data) => update(id, data.option as string),
  input_select: (id, _service, data) => update(id, data.option as string),
  number: (id, _service, data) => update(id, String(data.value)),
  input_number: (id, _service, data) => update(id, String(data.value)),
  input_datetime: (id, _service, data) => update(id, String(data.date ?? data.datetime ?? states[id].state)),
  date: (id, _service, data) => update(id, String(data.date)),
  update: id => {
    update(id, 'on', { in_progress: true })
    setTimeout(() => update(id, 'off', { in_progress: false, installed_version: '1.5.0' }), 2500)
  },
  button: id => update(id, iso()),
  input_button: id => update(id, iso()),
  scene: id => update(id, iso()),
  script: id => {
    update(id, 'on')
    setTimeout(() => update(id, 'off'), 1500)
  },
  todo: (_id, service, data) => {
    if (service === 'add_item')
      items = [...items, { uid: String(Date.now()), summary: data.item as string, status: 'needs_action' }]
    if (service === 'update_item')
      items = items.map(item =>
        item.uid === data.item || item.summary === data.item
          ? { ...item, status: (data.status as Item['status']) ?? item.status }
          : item,
      )
    if (service === 'remove_completed_items') items = items.filter(item => item.status !== 'completed')
    sendItems()
  },
}

// A reading that wanders over the hours, and a door that opens now and then.
function history(id: string, hours: number) {
  const s = states[id]
  const start = Date.now() - hours * HOUR
  const value = Number(s.state)
  if (Number.isFinite(value)) {
    const rows = []
    for (let t = start; t < Date.now(); t += 15 * 60_000) {
      const phase = (t / DAY) * Math.PI * 2
      rows.push({
        s: String(value + Math.sin(phase) * value * 0.15 + Math.sin(phase * 5) * value * 0.03),
        lu: t / 1000,
      })
    }
    return rows
  }
  const rows = []
  let open = false
  for (let t = start; t < Date.now(); t += (0.5 + ((t / HOUR) % 3)) * HOUR) {
    rows.push({ s: open ? 'on' : 'off', lc: t / 1000, lu: t / 1000 })
    open = !open
  }
  return rows
}

function statistics(id: string, days: number) {
  const base = Number(states[id].state) || 10
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: days }, (_, i) => {
    const start = today.getTime() - (days - 1 - i) * DAY
    const swing = 0.6 + 0.4 * Math.abs(Math.sin(i * 1.7))
    return { start, end: start + DAY, mean: base * swing, change: 6 + 8 * swing }
  })
}

function forecast(kind: string) {
  const conditions = ['sunny', 'partlycloudy', 'cloudy', 'rainy', 'partlycloudy', 'sunny', 'clear-night']
  const step = kind === 'hourly' ? HOUR : DAY
  return Array.from({ length: 12 }, (_, i) => ({
    datetime: iso(Date.now() + (i + 1) * step),
    condition: conditions[i % conditions.length],
    temperature: 18 + Math.round(Math.sin(i / 2) * 4),
    templow: 11 + Math.round(Math.cos(i / 2) * 2),
    is_daytime: true,
  }))
}

function events() {
  const day = (offset: number, hour: number) => {
    const time = new Date()
    time.setDate(time.getDate() + offset)
    time.setHours(hour, 0, 0, 0)
    return time
  }
  const at = (offset: number, from: number, to: number, summary: string, location?: string) => ({
    summary,
    location,
    start: { dateTime: day(offset, from).toISOString() },
    end: { dateTime: day(offset, to).toISOString() },
  })
  const allDay = (offset: number, summary: string) => ({
    summary,
    start: { date: day(offset, 0).toISOString().slice(0, 10) },
    end: {
      date: day(offset + 1, 0)
        .toISOString()
        .slice(0, 10),
    },
  })
  const hour = new Date().getHours()
  return [
    at(0, hour, hour + 1, 'Team call'),
    at(0, Math.min(hour + 3, 22), Math.min(hour + 4, 23), 'Dentist', 'Main Street 12'),
    allDay(1, 'Grandma visits'),
    at(1, 18, 19, 'Swimming'),
    at(3, 9, 12, 'Car service', 'Garage'),
    at(5, 20, 23, 'Dinner with friends'),
  ]
}

hass = {
  states,
  areas: {},
  entities: {},
  devices: {},
  themes: { darkMode: !light },
  locale: { language: 'en' },
  // Home Assistant's words for an attribute, near enough: 20.5 °C for a
  // temperature and Heating for heating.
  formatEntityAttributeValue: (entity, attribute, value = entity.attributes[attribute]) => {
    if (typeof value === 'number') return /temp/.test(attribute) ? `${value} °C` : String(value)
    if (typeof value !== 'string') return String(value)
    const words = value.replace(/_/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  },
  // Home Assistant's words for a state, near enough: Heat cool for heat_cool.
  formatEntityState: (entity, value = entity.state) => {
    const unit = entity.attributes.unit_of_measurement
    if (Number.isFinite(Number(value)) && value !== '') return unit ? `${value} ${unit}` : value
    if (!Number.isNaN(Date.parse(value)) && value.includes('T')) return new Date(value).toLocaleString('en')
    const words = value.replace(/_/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  },
  callService: async (domain, service, data = {}) => {
    console.info('callService', domain, service, data)
    const ids = data.entity_id
    for (const id of Array.isArray(ids) ? ids : [ids])
      if (states[id as string]) SERVICES[domain]?.(id as string, service, data)
  },
  callWS: async <T,>(message: Record<string, unknown>) => {
    const ids = (message.entity_ids ?? message.statistic_ids) as string[]
    if (message.type === 'history/history_during_period')
      return Object.fromEntries(
        ids.map(id => [id, history(id, (Date.now() - Date.parse(message.start_time as string)) / HOUR)]),
      ) as T
    if (message.type === 'recorder/statistics_during_period')
      return Object.fromEntries(ids.map(id => [id, statistics(id, 7)])) as T
    return {} as T
  },
  callApi: async <T,>(_method: string, path: string) => (path.startsWith('calendars/') ? events() : []) as T,
  connection: {
    subscribeMessage: async <T,>(callback: (message: T) => void, message: Record<string, unknown>) => {
      if (message.type === 'todo/item/subscribe') {
        const listen = callback as unknown as (message: { items: Item[] }) => void
        listeners.add(listen)
        listen({ items })
        return () => listeners.delete(listen)
      }
      if (message.type === 'weather/subscribe_forecast')
        callback({ type: message.forecast_type, forecast: forecast(message.forecast_type as string) } as T)
      return () => {}
    },
  },
} as HomeAssistant

// Stand ins for the parts of Home Assistant a card borrows: the picture
// element and the map card.
customElements.define(
  'hui-image',
  class extends HTMLElement {
    connectedCallback() {
      this.style.cssText = `display:block;width:100%;height:100%;background:url("${art}") center/cover`
    }
  },
)
;(window as unknown as { loadCardHelpers: () => Promise<unknown> }).loadCardHelpers = async () => ({
  createCardElement: () => {
    const map = document.createElement('div')
    map.style.cssText =
      'height:100%;background:#cfe3d4 repeating-linear-gradient(0deg,transparent 0 38px,#fff 38px 40px),repeating-linear-gradient(90deg,transparent 0 58px,#fff 58px 60px);position:relative'
    map.innerHTML =
      '<div style="position:absolute;left:50%;top:55%;width:36px;height:36px;margin:-18px;border-radius:50%;background:#0a84ff;border:3px solid #fff;box-shadow:0 2px 8px #0005"></div>'
    return map
  },
})

type Card = HTMLElement & {
  setConfig(c: unknown): void
  hass: HomeAssistant
  getGridOptions(): { columns?: number | string; rows?: number | string }
}
type Suggestion = { label?: string; config: Record<string, unknown> }
type Custom = {
  type: string
  name: string
  getEntitySuggestion?: (hass: HomeAssistant, entityId: string) => Suggestion | Suggestion[] | null
}

const params = new URLSearchParams(location.search)
const link = (changes: Record<string, string | null>) => {
  const next = new URLSearchParams(params)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }
  return `?${next}`
}

// Every card that some entity suggests, in the order they register.
const customCards = (window as unknown as { customCards: Custom[] }).customCards
const offered = customCards
  .map(custom => ({
    custom,
    found: ENTITIES.flatMap(entity => {
      const found = custom.getEntitySuggestion?.(hass, entity.entity_id)
      return (found ? (Array.isArray(found) ? found : [found]) : []).map(suggestion => ({ entity, suggestion }))
    }),
  }))
  .filter(({ found }) => found.length > 0)
const picked = offered.find(({ custom }) => custom.type === params.get('card')) ?? offered[0]
const short = (name: string) => name.replace('Diorama ', '')

const ink = light ? '#1c1c1e' : '#fff'
document.body.style.cssText = `margin:0;min-height:100vh;font-family:system-ui;background:${
  light ? 'linear-gradient(160deg,#e9e4dc,#cfd8e3)' : 'linear-gradient(160deg,#2b2f3a,#151821 60%,#0e0f14)'
} fixed;color:${ink};--primary-text-color:${ink}`

const pill = (href: string, text: string, on: boolean) =>
  `<a href="${href}" style="padding:7px 14px;border-radius:999px;text-decoration:none;font:500 13px system-ui;color:${
    on ? (light ? '#fff' : '#1c1c1e') : 'inherit'
  };background:${on ? ink : light ? '#0000000f' : '#ffffff14'}">${text}</a>`

const bar = document.createElement('header')
bar.style.cssText = `position:sticky;top:0;z-index:10;padding:14px 20px;backdrop-filter:blur(20px);background:${
  light ? '#f2f2f7b8' : '#1c1c1eb8'
};border-bottom:1px solid ${light ? '#0000001a' : '#ffffff1a'}`
bar.innerHTML = `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
    <strong style="font-size:20px">${short(picked.custom.name)}</strong>
    <span style="opacity:.55;font-size:13px">${picked.custom.type}</span>
    <span style="flex:1"></span>
    <span style="opacity:.55;font-size:12px">Any number is the alarm code. Actions go to a mock and change the state.</span>
    <span style="display:flex;gap:4px">${pill(link({ light: null }), 'Dark', !light)}${pill(
      link({ light: '1' }),
      'Light',
      light,
    )}</span>
  </div>
  <nav style="display:flex;gap:6px;flex-wrap:wrap">${offered
    .map(({ custom }) => pill(link({ card: custom.type }), short(custom.name), custom === picked.custom))
    .join('')}</nav>`
document.body.appendChild(bar)

const main = document.createElement('main')
main.style.cssText = 'padding:8px 20px 64px'
document.body.appendChild(main)

// Home Assistant's grid section: twelve columns of a section about 500 px
// wide, 56 px rows and 8 px gaps.
const SECTION = 492
const GAP = 8
const COLUMN = (SECTION - 11 * GAP) / 12
const span = (count: number) => count * COLUMN + (count - 1) * GAP
const ROW = 56

const make = (config: Record<string, unknown>) => {
  const card = document.createElement((config.type as string).replace('custom:', '')) as Card
  card.setConfig(config)
  card.hass = hass
  return card
}

const gridOf = (card: Card, config: Record<string, unknown>) => ({
  ...card.getGridOptions(),
  ...(config.grid_options as Record<string, number | string> | undefined),
})

// The sizes a style comes in: a tile is small or wide, and a card with a
// grid of its own, like the calendar, has only that one.
const sizesOf = (config: Record<string, unknown>) => {
  const { size: _, ...small } = config
  const wide = { ...small, size: 'wide' }
  const one = gridOf(make(small), small)
  const other = gridOf(make(wide), wide)
  if (one.columns === other.columns && one.rows === other.rows) return [{ name: '', config: small }]
  return [
    { name: 'Small', config: small },
    { name: 'Wide', config: wide },
  ]
}

// The styles of the picked card, each with every entity that offers it. A
// card offered small and wide as two suggestions is one style here, since
// each style is shown at every size.
const styles = new Map<string, { entity: EntityState; config: Record<string, unknown> }[]>()
for (const { entity, suggestion } of picked.found) {
  if (suggestion.label === 'Small') continue
  const style = suggestion.label ?? 'Default'
  if (!styles.has(style)) styles.set(style, [])
  // A projector screen is a cover set to inverted, as a piece of that kind is.
  const config =
    entity.entity_id === 'cover.projector_screen' ? { ...suggestion.config, invert: true } : suggestion.config
  styles.get(style)!.push({ entity, config })
}

// The shape of a rendered card: its elements and their classes, without
// the words, the colors or what is drawn inside an icon. Two entities with
// the same shape show the same card, like two lamps, one on and one off.
const shapeOf = (node: Element): string => {
  if (node.tagName === 'svg' && !node.classList.length) return 'svg'
  // Where a fill grows from, so a projector screen filling from the top shows
  // beside blinds filling from the bottom.
  const from = node.getAttribute('data-from')
  const own = `${node.tagName.toLowerCase()}.${[...node.classList].sort().join('.')}${from ? `[${from}]` : ''}`
  // A span with no elements in it only holds words, like a unit that one
  // reading has and another does not.
  const parts = [...node.children].filter(child => child.tagName !== 'SPAN' || child.children.length > 0)
  return `${own}(${parts.map(shapeOf).join(',')})`
}

// Keeps the first card of each shape on the whole page, once React has
// drawn them, so every card that looks different shows once. A style whose
// cards all look like an earlier one is left out, and the earlier one
// names it, like a fan's speed that is a light's brightness.
type Shown = { style: string; section: HTMLElement; group: HTMLElement[]; made: Card[]; keep: boolean }
const shown: Shown[] = []
const dedupe = () =>
  setTimeout(() => {
    const first = new Map<string, Shown>()
    const also = new Map<HTMLElement, string[]>()
    for (const one of shown) {
      const shape = one.made.map(card => [...(card.shadowRoot?.children ?? [])].map(shapeOf).join()).join('|')
      const earlier = first.get(shape)
      if (one.keep) continue
      if (!earlier) {
        first.set(shape, one)
        continue
      }
      for (const cell of one.group) cell.remove()
      if (earlier.style !== one.style) {
        const names = also.get(earlier.section) ?? []
        if (!names.includes(one.style)) names.push(one.style)
        also.set(earlier.section, names)
      }
    }
    for (const { section } of shown) {
      if (!section.querySelector('[data-cell]')) section.remove()
    }
    for (const [section, names] of also) {
      const note = document.createElement('div')
      note.textContent = `Also ${names.join(', ')}, which look the same.`
      note.style.cssText = 'font:500 12px system-ui;opacity:.55'
      section.querySelector('h2')!.after(note)
    }
  }, 400)

// showcase=1 shows a few cards that look nothing alike instead, laid out in
// two sections the way a dashboard does, for the README.
const SHOWCASE: Record<string, unknown>[][] = [
  [
    { type: 'dio-title', title: 'Living Room' },
    { type: 'custom:dio-dial', entity: 'climate.living', grid_options: { rows: 5 } },
    { type: 'custom:dio-toggle', entity: 'light.living_room', feature: 'brightness', size: 'wide' },
  ],
  [
    { type: 'dio-title', title: 'Home' },
    { type: 'custom:dio-weather', entity: 'weather.home', forecast_type: 'hourly', grid_options: { rows: 3 } },
    { type: 'custom:dio-lock', entity: 'lock.front', feature: 'open-door' },
    { type: 'custom:dio-toggle', entity: 'light.all' },
    { type: 'custom:dio-vacuum', entity: 'vacuum.robot', size: 'wide' },
  ],
]
if (params.get('showcase')) {
  styles.clear()
  // Cooling, so the dial shows its blue side.
  const thermostat = states['climate.living']
  thermostat.state = 'cool'
  Object.assign(thermostat.attributes, { hvac_action: 'cooling', current_temperature: 25.5, temperature: 23 })
  // A light group with most of the flat's lights on.
  for (const [id, name] of [['light.kitchen', 'Kitchen'], ['light.hall', 'Hall'], ['light.bedroom', 'Bedroom']])
    states[id] = state(id, 'on', { friendly_name: name, brightness: 200, supported_color_modes: ['brightness'] })
  states['light.all'] = state('light.all', 'on', {
    friendly_name: 'All Lights',
    entity_id: ['light.living_room', 'light.kitchen', 'light.hall', 'light.bedroom', 'light.desk'],
    supported_color_modes: ['brightness'],
    brightness: 200,
  })
  bar.style.display = 'none'
  main.style.cssText = 'display:flex;gap:32px;align-items:flex-start;padding:24px;width:max-content'
  for (const configs of SHOWCASE) {
    const section = document.createElement('div')
    section.style.cssText = `display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:minmax(${ROW}px,auto);gap:${GAP}px;width:${SECTION}px`
    for (const config of configs) {
      const card = make(config)
      cards.push(card)
      const { columns = 12, rows = 'auto' } = gridOf(card, config)
      const cell = document.createElement('div')
      cell.style.gridColumn = `span ${columns === 'full' ? 12 : columns}`
      // A dashboard gives a card the height of its rows and no more.
      if (rows !== 'auto') {
        cell.style.gridRow = `span ${rows}`
        cell.style.height = `${Number(rows) * (ROW + GAP) - GAP}px`
      }
      cell.appendChild(card)
      section.appendChild(cell)
    }
    main.appendChild(section)
  }
}

for (const [style, uses] of styles) {
  const section = document.createElement('section')
  section.style.cssText = 'margin-top:28px'
  section.innerHTML = `<h2 style="margin:0 0 4px;font:600 17px system-ui">${style}</h2>`
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:24px 32px;align-items:flex-start'
  // One card of the style, at one size, with what it shows under it.
  const place = (into: HTMLElement, entity: EntityState, size: { name: string; config: Record<string, unknown> }) => {
    const card = make(size.config)
    cards.push(card)
    const { columns = 6, rows = 2 } = gridOf(card, size.config)
    const cell = document.createElement('div')
    cell.dataset.cell = ''
    cell.style.cssText = `width:${span(columns === 'full' ? 12 : Number(columns))}px`
    const caption = document.createElement('div')
    caption.textContent = [
      entity.attributes.friendly_name ?? entity.entity_id,
      size.name,
      `${columns === 'full' ? 12 : columns} × ${rows}`,
    ]
      .filter(Boolean)
      .join(' · ')
    caption.style.cssText = 'margin:14px 4px 6px;font:500 11px system-ui;opacity:.55;white-space:nowrap'
    const box = document.createElement('div')
    box.style.cssText = rows === 'auto' ? '' : `height:${Number(rows) * ROW + (Number(rows) - 1) * GAP}px`
    box.appendChild(card)
    cell.append(caption, box)
    into.appendChild(cell)
    return { cell, card }
  }
  for (const { entity, config } of uses) {
    const group: HTMLElement[] = []
    const made: Card[] = []
    for (const size of sizesOf(config)) {
      const { cell, card } = place(row, entity, size)
      group.push(cell)
      made.push(card)
    }
    // The projector screen always shows, inverted beside the blinds, to
    // try that its arrows and its fill go the other way.
    shown.push({ style, section, group, made, keep: entity.entity_id === 'cover.projector_screen' })
  }
  section.appendChild(row)
  main.appendChild(section)
}

dedupe()

window.addEventListener('hass-more-info', e => console.info('more-info', (e as CustomEvent).detail))
