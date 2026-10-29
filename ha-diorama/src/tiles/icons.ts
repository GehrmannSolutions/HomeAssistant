// The Phosphor icons the tiles can show, as `ph:<name>`. Only these are
// bundled: the whole set would weigh several megabytes. Each comes in its
// regular weight, for a tile that is off, and filled, for one that is on.
// To add one, add its name to both lists below.
const REGULAR = import.meta.glob<string>(
  '/node_modules/@phosphor-icons/core/assets/regular/{airplane,alarm,armchair,arrow-clockwise,arrow-counter-clockwise,arrow-line-down,arrow-line-up,arrow-u-up-left,arrows-horizontal,arrows-left-right,arrows-vertical,backspace,bathtub,battery-charging,battery-empty,battery-full,battery-high,battery-low,battery-medium,bed,bell,broom,calendar-blank,calendar-check,calendar-dots,camera,caret-down,caret-left,caret-right,caret-up,cat,cell-signal-full,cell-signal-high,cell-signal-low,cell-signal-medium,chart-bar,chart-line,chat-circle,check,check-circle,circle,clock,clock-countdown,cloud,cloud-fog,cloud-lightning,cloud-moon,cloud-rain,cloud-snow,cloud-sun,cooking-pot,couch,crosshair,cube,cursor-click,desktop,device-tablet,door,door-open,download,drop,drop-half,eject,eye,fan,fast-forward,film-strip,fire,flag-checkered,flame,fork-knife,garage,gauge,globe,hand-tap,hash,heart,hourglass,house,house-line,lamp,lamp-pendant,leaf,lightbulb,lightbulb-filament,lightning,list,list-bullets,list-checks,lock,lock-key,lock-key-open,lock-open,magic-wand,map-pin,map-trifold,minus,monitor,moon,moon-stars,music-note,music-notes,oven,palette,pause,paw-print,person,person-simple-walk,pipe,plant,play,play-pause,plug,plugs,plus,plus-circle,popcorn,potted-plant,power,projector-screen,pulse,question,repeat,repeat-once,robot,rocket-launch,rows,security-camera,shield,shield-check,shield-slash,shield-star,shield-warning,shower,shuffle,siren,skip-back,skip-forward,sliders,sliders-horizontal,snowflake,sparkle,speaker-high,speaker-low,speaker-none,speaker-x,spray-bottle,square-half-bottom,squares-four,star,stop,sun,sun-dim,target,television,textbox,thermometer,thermometer-hot,thermometer-simple,timer,toggle-left,toggle-right,toilet,trash,tree,user,video-camera,warning,waveform,waves,wifi-high,wind,x,x-circle}.svg',
  { query: '?raw', import: 'default', eager: true },
)
const FILL = import.meta.glob<string>(
  '/node_modules/@phosphor-icons/core/assets/fill/{airplane,alarm,armchair,arrow-clockwise,arrow-counter-clockwise,arrow-line-down,arrow-line-up,arrow-u-up-left,arrows-horizontal,arrows-left-right,arrows-vertical,backspace,bathtub,battery-charging,battery-empty,battery-full,battery-high,battery-low,battery-medium,bed,bell,broom,calendar-blank,calendar-check,calendar-dots,camera,caret-down,caret-left,caret-right,caret-up,cat,cell-signal-full,cell-signal-high,cell-signal-low,cell-signal-medium,chart-bar,chart-line,chat-circle,check,check-circle,circle,clock,clock-countdown,cloud,cloud-fog,cloud-lightning,cloud-moon,cloud-rain,cloud-snow,cloud-sun,cooking-pot,couch,crosshair,cube,cursor-click,desktop,device-tablet,door,door-open,download,drop,drop-half,eject,eye,fan,fast-forward,film-strip,fire,flag-checkered,flame,fork-knife,garage,gauge,globe,hand-tap,hash,heart,hourglass,house,house-line,lamp,lamp-pendant,leaf,lightbulb,lightbulb-filament,lightning,list,list-bullets,list-checks,lock,lock-key,lock-key-open,lock-open,magic-wand,map-pin,map-trifold,minus,monitor,moon,moon-stars,music-note,music-notes,oven,palette,pause,paw-print,person,person-simple-walk,pipe,plant,play,play-pause,plug,plugs,plus,plus-circle,popcorn,potted-plant,power,projector-screen,pulse,question,repeat,repeat-once,robot,rocket-launch,rows,security-camera,shield,shield-check,shield-slash,shield-star,shield-warning,shower,shuffle,siren,skip-back,skip-forward,sliders,sliders-horizontal,snowflake,sparkle,speaker-high,speaker-low,speaker-none,speaker-x,spray-bottle,square-half-bottom,squares-four,star,stop,sun,sun-dim,target,television,textbox,thermometer,thermometer-hot,thermometer-simple,timer,toggle-left,toggle-right,toilet,trash,tree,user,video-camera,warning,waveform,waves,wifi-high,wind,x,x-circle}-fill.svg',
  { query: '?raw', import: 'default', eager: true },
)

// The few drawn heavier, as `ph:<name>-bold`, for a button that is only
// its sign, where the filled weight would put it in a box.
const BOLD = import.meta.glob<string>(
  '/node_modules/@phosphor-icons/core/assets/bold/{check,minus,plus,power,x}-bold.svg',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)

// Icons the set lacks, drawn on its grid and in its two weights.
const svg = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="${d}"/></svg>`
const OWN: Record<string, { regular: string; fill: string }> = {
  // A round robot vacuum from above: its bumper across the front and the
  // dome of its laser in the middle.
  'robot-vacuum': {
    regular: svg(
      'M128,24A104,104,0,1,0,232,128A104,104,0,0,0,128,24Zm0,16a88,88,0,1,1,0,176a88,88,0,1,1,0-176ZM54.2,80H201.8L210,96H46ZM148,148a20,20,0,1,1-20-20A20,20,0,0,1,148,148Z',
    ),
    fill: svg(
      'M128,24A104,104,0,1,0,232,128A104,104,0,0,0,128,24ZM54.2,80H201.8L210,96H46ZM128,128a20,20,0,1,1,0,40a20,20,0,1,1,0-40Z',
    ),
  },
}

const byName = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, svg]) => [path.replace(/^.*\/|(-fill|-bold)?\.svg$/g, ''), svg]))
const regular = byName(REGULAR)
const fill = byName(FILL)
const bold = byName(BOLD)
for (const [name, own] of Object.entries(OWN)) {
  regular.set(name, own.regular)
  fill.set(name, own.fill)
}

// Every name that can be written after `ph:`.
export const PHOSPHOR_ICONS = [...regular.keys()].sort()

// The SVG for a Phosphor icon, filled while its tile is on.
export function phosphor(name: string, on: boolean) {
  // A name that asks for a weight itself keeps it whatever the state.
  if (name.endsWith('-fill')) return fill.get(name.slice(0, -5))
  if (name.endsWith('-bold')) return bold.get(name.slice(0, -5))
  return (on ? fill : regular).get(name)
}

// Sensors by what they measure.
const SENSOR_ICONS: Record<string, string> = {
  temperature: 'ph:thermometer-simple',
  humidity: 'ph:drop-half',
  moisture: 'ph:drop',
  battery: 'ph:battery-high',
  battery_charging: 'ph:battery-charging',
  power: 'ph:lightning',
  energy: 'ph:lightning',
  current: 'ph:lightning',
  voltage: 'ph:lightning',
  illuminance: 'ph:sun',
  motion: 'ph:person-simple-walk',
  occupancy: 'ph:person-simple-walk',
  presence: 'ph:person-simple-walk',
  door: 'ph:door',
  garage_door: 'ph:garage',
  window: 'ph:square-half-bottom',
  opening: 'ph:door-open',
  smoke: 'ph:warning',
  gas: 'ph:warning',
  carbon_monoxide: 'ph:warning',
  safety: 'ph:warning',
  problem: 'ph:warning',
  connectivity: 'ph:wifi-high',
  signal_strength: 'ph:wifi-high',
  pressure: 'ph:gauge',
  atmospheric_pressure: 'ph:gauge',
  wind_speed: 'ph:wind',
  pm25: 'ph:wind',
  pm10: 'ph:wind',
  aqi: 'ph:wind',
  carbon_dioxide: 'ph:wind',
  volatile_organic_compounds: 'ph:wind',
  timestamp: 'ph:clock',
  duration: 'ph:timer',
  sound: 'ph:speaker-high',
  plug: 'ph:plug',
  outlet: 'ph:plug',
  lock: 'ph:lock',
  update: 'ph:download',
  running: 'ph:play',
}

// Weather by its condition. A few have their own look at night, named with
// `-night` after the condition.
const WEATHER_ICONS: Record<string, string> = {
  'clear-night': 'ph:moon-stars',
  cloudy: 'ph:cloud',
  fog: 'ph:cloud-fog',
  hail: 'ph:cloud-snow',
  lightning: 'ph:cloud-lightning',
  'lightning-rainy': 'ph:cloud-lightning',
  partlycloudy: 'ph:cloud-sun',
  'partlycloudy-night': 'ph:cloud-moon',
  pouring: 'ph:cloud-rain',
  rainy: 'ph:cloud-rain',
  snowy: 'ph:cloud-snow',
  'snowy-rainy': 'ph:cloud-snow',
  sunny: 'ph:sun',
  windy: 'ph:wind',
  'windy-variant': 'ph:wind',
}

// The icon a tile shows when its config names none. The state picks it
// where it says more, like a lock that is open or the weather outside.
export function defaultIcon(entityId: string | undefined, deviceClass?: unknown, state?: string) {
  const domain = entityId?.split('.')[0]
  const byClass = typeof deviceClass === 'string' ? SENSOR_ICONS[deviceClass] : undefined
  switch (domain) {
    case 'light':
      return 'ph:lightbulb'
    case 'switch':
      return deviceClass === 'outlet' ? 'ph:plug' : 'ph:power'
    case 'input_boolean':
      return 'ph:toggle-right'
    case 'fan':
      return 'ph:fan'
    case 'button':
    case 'input_button':
      return 'ph:hand-tap'
    case 'script':
      return 'ph:play'
    case 'scene':
      return 'ph:sparkle'
    case 'automation':
      return 'ph:robot'
    case 'cover':
      if (deviceClass === 'garage') return 'ph:garage'
      if (deviceClass === 'door' || deviceClass === 'gate') return 'ph:door'
      return 'ph:rows'
    case 'vacuum':
      return 'ph:robot-vacuum'
    case 'select':
    case 'input_select':
      return 'ph:list-bullets'
    case 'camera':
      return 'ph:video-camera'
    case 'climate':
      return 'ph:thermometer-simple'
    case 'water_heater':
      return 'ph:fire'
    case 'humidifier':
      return 'ph:drop-half'
    case 'media_player':
      return deviceClass === 'tv' ? 'ph:television' : 'ph:speaker-high'
    case 'remote':
      return 'ph:sliders-horizontal'
    case 'lock':
      return state === 'unlocked' || state === 'open' || state === 'opening' ? 'ph:lock-open' : 'ph:lock'
    case 'siren':
      return 'ph:siren'
    case 'valve':
      return 'ph:pipe'
    case 'alarm_control_panel':
      return state === 'disarmed' ? 'ph:shield' : 'ph:shield-check'
    case 'person':
    case 'device_tracker':
      return 'ph:user'
    case 'weather':
      return WEATHER_ICONS[state ?? ''] ?? 'ph:cloud-sun'
    case 'update':
      return 'ph:download'
    case 'calendar':
      return 'ph:calendar-blank'
    case 'todo':
      return 'ph:list-checks'
    case 'number':
    case 'input_number':
      return 'ph:hash'
    case 'text':
    case 'input_text':
      return 'ph:textbox'
    case 'date':
    case 'time':
    case 'datetime':
    case 'input_datetime':
      return 'ph:clock'
    case 'timer':
      return 'ph:timer'
    case 'sun':
      return state === 'below_horizon' ? 'ph:moon' : 'ph:sun'
    case 'zone':
      return 'ph:map-pin'
    case 'geo_location':
      return 'ph:globe'
    case 'air_quality':
      return 'ph:wind'
    case 'image_processing':
      return 'ph:eye'
    case 'conversation':
      return 'ph:chat-circle'
    case 'event':
      return byClass ?? 'ph:pulse'
    case 'sensor':
    case 'binary_sensor':
      return byClass ?? (domain === 'sensor' ? 'ph:gauge' : 'ph:circle')
    default:
      return 'ph:circle'
  }
}
