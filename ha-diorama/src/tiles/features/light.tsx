import { callService, formatState } from '#/tiles/actions.ts'
import {
  domainOf,
  listOf,
  MenuPill,
  numberOf,
  optionWord,
  press,
  SlimSlider,
  TogglePill,
  type FeatureProps,
} from '#/tiles/features/parts.tsx'
import { kelvinToRgb } from '#/signals.ts'
import type { EntityState } from '#/types.ts'
import type { CSSProperties } from 'react'

// The features of a light, and the switch any on and off entity can have.

const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww']

const colorModes = (entity: EntityState) => listOf(entity, 'supported_color_modes')
export const dims = (entity: EntityState) => colorModes(entity).some(mode => mode !== 'onoff')
export const warms = (entity: EntityState) => colorModes(entity).includes('color_temp')
export const colors = (entity: EntityState) => colorModes(entity).some(mode => COLOR_MODES.includes(mode))

// Whether the light shines in a color or in a white right now. Home
// Assistant still gives a hue for a white, and a white for some colors, so
// only the mode says which one it is in.
const mode = (entity: EntityState) => entity.attributes.color_mode
export const inColor = (entity: EntityState) => COLOR_MODES.includes(mode(entity) as string)
export const inWhite = (entity: EntityState) => mode(entity) === 'color_temp'

// The color a white of so many kelvin looks like.
export const rgb = (kelvin: number) => `rgb(${kelvinToRgb(kelvin).map(c => Math.round(c * 255))})`

// How warm or cool its white is, along a slim bar beside the icon that
// runs from candle light to daylight.
export function ColorTemp({ env, entity, onPreview }: FeatureProps) {
  const min = numberOf(entity, 'min_color_temp_kelvin') ?? 2000
  const max = numberOf(entity, 'max_color_temp_kelvin') ?? 6500
  const kelvin = numberOf(entity, 'color_temp_kelvin') ?? Math.round((min + max) / 2)
  const stops = [0, 0.25, 0.5, 0.75, 1].map(t => `${rgb(min + (max - min) * t)} ${t * 100}%`)
  const format = kelvinText
  return (
    <SlimSlider
      label="Color temperature"
      value={kelvin}
      min={min}
      max={max}
      step={50}
      track={`linear-gradient(90deg, ${stops.join(', ')})`}
      format={format}
      idle={inColor(entity)}
      onMove={(v, sent) => onPreview?.(v === null ? null : { state: format(v), color: rgb(v), sent })}
      onChange={v => callService(env.hass, 'light.turn_on', { entity_id: entity.entity_id, color_temp_kelvin: v })}
    />
  )
}

// What a light's white says on its tile, in kelvin.
export const kelvinText = (v: number) => `${Math.round(v / 50) * 50} K`

const NAMES: [number, string][] = [
  [15, 'Red'],
  [40, 'Orange'],
  [65, 'Yellow'],
  [150, 'Green'],
  [195, 'Cyan'],
  [255, 'Blue'],
  [290, 'Purple'],
  [335, 'Pink'],
  [360, 'Red'],
]

// The name of the hue a light shines in, for its tile.
export const hueText = (hue: number) => NAMES.find(([upTo]) => hue <= upTo)?.[1] ?? 'Red'

// What a light's white or color reads on its tile, while it shines in it.
export const tempState = (entity: EntityState) => {
  const kelvin = numberOf(entity, 'color_temp_kelvin')
  return kelvin == null || inColor(entity) ? undefined : kelvinText(kelvin)
}
export const hueState = (entity: EntityState) => {
  const hs = entity.attributes.hs_color
  return Array.isArray(hs) && typeof hs[0] === 'number' && !inWhite(entity) ? hueText(hs[0]) : undefined
}

// The hue a light's hue looks like, as the angle of the color in OKLCH.
function perceivedHue(hue: number) {
  const [r, g, b] = [0, 8, 4].map(n => {
    const k = (n + hue / 30) % 12
    const c = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return (Math.atan2(bb, a) * 180) / Math.PI
}

// A hue drawn at the same lightness and a moderate strength as every
// other, so none, like the greens and yellows, glares brighter than the rest.
const soft = (hue: number) => `oklch(0.71 0.175 ${perceivedHue(hue).toFixed(1)})`

const HUES = Array.from({ length: 13 }, (_, i) => i * 30)
  .map(h => `${soft(h)} ${(h / 360) * 100}%`)
  .join(', ')

// The hue it shines in, along a slim rainbow beside the icon.
export function Hue({ env, entity, onPreview }: FeatureProps) {
  const hs = entity.attributes.hs_color
  const hue = Array.isArray(hs) ? Math.round(hs[0]) : 0
  const saturation = Array.isArray(hs) && hs[1] > 20 ? hs[1] : 100
  const format = hueText
  return (
    <SlimSlider
      label="Color"
      value={hue}
      min={0}
      max={360}
      track={`linear-gradient(90deg, ${HUES})`}
      format={format}
      idle={inWhite(entity)}
      onMove={(v, sent) =>
        onPreview?.(v === null ? null : { state: format(v), color: `hsl(${v} 100% ${100 - saturation / 2}%)`, sent })
      }
      onChange={v => callService(env.hass, 'light.turn_on', { entity_id: entity.entity_id, hs_color: [v, saturation] })}
    />
  )
}

type Swatch = { label: string; color: string; data: Record<string, unknown> }

// A few colors a press away: warm, neutral and cool white for a light that
// has whites, and a handful of hues for one that has colors.
export function ColorFavorites({ env, entity }: FeatureProps) {
  const whites: Swatch[] = warms(entity)
    ? [2700, 4000, 6000].map(k => ({ label: `${k} K`, color: rgb(k), data: { color_temp_kelvin: k } }))
    : []
  const hues: Swatch[] = colors(entity)
    ? [
        ['Red', 0],
        ['Orange', 30],
        ['Green', 130],
        ['Blue', 220],
        ['Purple', 280],
      ].map(([label, h]) => ({
        label: label as string,
        color: soft(h as number),
        data: { hs_color: [h, 100] },
      }))
    : []
  const swatches = [...whites, ...hues].slice(0, 7)
  return (
    <div className="dio-swatches" role="group" aria-label="Favorite colors">
      {swatches.map(swatch => (
        <button
          key={swatch.label}
          type="button"
          aria-label={swatch.label}
          title={swatch.label}
          className="dio-swatch"
          style={{ '--_swatch': swatch.color } as CSSProperties}
          {...press(() => callService(env.hass, 'light.turn_on', { entity_id: entity.entity_id, ...swatch.data }))}
        />
      ))}
    </div>
  )
}

// One of the light's effects, from a menu.
export function Effect({ env, entity }: FeatureProps) {
  const effect = typeof entity.attributes.effect === 'string' ? entity.attributes.effect : null
  return (
    <MenuPill
      icon="ph:magic-wand"
      label="Effect"
      options={listOf(entity, 'effect_list')}
      current={effect}
      word={option => optionWord(env.hass, entity, option, 'effect')}
      onPick={option => callService(env.hass, 'light.turn_on', { entity_id: entity.entity_id, effect: option })}
    />
  )
}

const ON_STATES = ['on', 'open', 'opening']

// A pill to turn it on or off, under the dial, pressed while it is on.
export function Toggle({ env, entity }: FeatureProps) {
  const domain = domainOf(entity)
  const on = ON_STATES.includes(entity.state)
  const service = domain === 'valve' ? (on ? 'close_valve' : 'open_valve') : on ? 'turn_off' : 'turn_on'
  return (
    <TogglePill
      icon="ph:power"
      label={formatState(env.hass, entity)}
      on={on}
      onToggle={() => callService(env.hass, `${domain}.${service}`, { entity_id: entity.entity_id })}
    />
  )
}
