// The modes a thermostat can run in, in the order its buttons go, each with
// its icon and its color, none for the ones that are plain like off, which its button takes while chosen and the
// thermostat's tiles take while it runs in it. One it names that
// is not here goes at the end.
export const HVAC_MODES: Record<string, { icon: string; color?: string }> = {
  auto: { icon: 'ph:sparkle' },
  heat_cool: { icon: 'ph:thermometer' },
  heat: { icon: 'ph:fire', color: 'var(--_mode-heat)' },
  cool: { icon: 'ph:snowflake', color: 'var(--_mode-cool)' },
  dry: { icon: 'ph:drop', color: 'var(--_mode-dry)' },
  fan_only: { icon: 'ph:fan', color: 'var(--_mode-fan)' },
  off: { icon: 'ph:power-bold' },
}
export const HVAC_ORDER = Object.keys(HVAC_MODES)

// The icon for each way a water heater can run, in the order Home
// Assistant lists them.
export const WATER_HEATER_MODES: Record<string, string> = {
  electric: 'ph:lightning',
  gas: 'ph:flame',
  heat_pump: 'ph:waves',
  eco: 'ph:leaf',
  performance: 'ph:rocket-launch',
  high_demand: 'ph:fire',
  off: 'ph:power-bold',
}

// The mode whose color each thing a thermostat does takes.
const ACTION_MODES: Record<string, string> = {
  heating: 'heat',
  preheating: 'heat',
  defrosting: 'heat',
  cooling: 'cool',
  drying: 'dry',
  fan: 'fan_only',
}

// The plain text color, for an icon with no color of its own.
export const NO_COLOR = 'currentColor'

// The modes that pick on their own whether to heat or cool.
const EITHER = ['auto', 'heat_cool']

// The mode whose color a thermostat shows: the one it runs in, or in a
// mode that heats or cools as it needs to, the one for what it is doing
// right now, like heat while it heats. Null while that one waits.
export const shownMode = (state: string, action: unknown) => {
  if (!EITHER.includes(state)) return state
  return (typeof action === 'string' && ACTION_MODES[action]) || null
}

// The color of a thermostat's tiles, for the mode it shows. No color while
// it waits.
export const climateColor = (state: string, action: unknown) => {
  const mode = shownMode(state, action)
  return mode ? HVAC_MODES[mode]?.color : NO_COLOR
}

// The same colors for the 3D model, which cannot read the tiles' CSS, so
// it keeps to their defaults.
export const MODE_HEX: Record<string, string> = {
  heat: '#ff6422',
  cool: '#5ab0ff',
  dry: '#ffc60a',
  fan_only: '#30c9a4',
}
