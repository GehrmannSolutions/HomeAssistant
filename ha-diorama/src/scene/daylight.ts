import type { HomeAssistant } from '#/types.ts'

const clamp = (v: number, min = 0, max = 1) => Math.min(Math.max(v, min), max)

// Where the sun is and what that does to the room.
//
// Home Assistant knows where the sun is, so the card asks it: `sun.sun`
// carries the elevation in degrees. Without that attribute the card falls
// back to the entity's state, and without the sun integration at all to the
// clock on the device showing the card. The editor passes an hour instead,
// which is how its time of day slider works.

// A plain day, for the clock fallback and for the editor's slider: the sun
// climbs from dawn, peaks around midday and sets at dusk.
const DAWN_H = 7
const DUSK_H = 21
const NOON_DEG = 60

export function elevationAtHour(hour: number) {
  const through = (hour - DAWN_H) / (DUSK_H - DAWN_H)
  return Math.sin(through * Math.PI) * NOON_DEG
}

export function sunElevation(hass: HomeAssistant | null, hour?: number): number {
  if (hour !== undefined) return elevationAtHour(hour)
  const sun = hass?.states['sun.sun']
  const elevation = Number(sun?.attributes?.elevation)
  if (Number.isFinite(elevation)) return elevation
  if (sun) return sun.state === 'above_horizon' ? NOON_DEG : -NOON_DEG
  const now = new Date()
  return elevationAtHour(now.getHours() + now.getMinutes() / 60)
}

// How bright the day is, and how high the sun is standing in it.
//
// The sun climbs roughly ten degrees in the hour after it rises and drops
// the same in the hour before it sets, so `level` is the hour long fade at
// each end of the day: the room starts dimming about an hour before sundown
// and is at night by sundown.
//
// `height` is the rest of the climb, which is what the light's color
// follows: golden along the horizon, near white overhead.
const FADE_DEG = 10
const HIGH_DEG = 40

export function daylight(elevation: number) {
  return { level: clamp(elevation / FADE_DEG), height: clamp(elevation / HIGH_DEG) }
}
