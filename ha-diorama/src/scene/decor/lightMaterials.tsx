import { useEased } from '#/scene/decor/ease.ts'
import { Material } from '#/scene/decor/parts.tsx'
import type { ItemState } from '#/scene/decor/state.ts'
import { useMemo } from 'react'
import { Color } from 'three'

export type LightState = ItemState

// Materials of the light family. The shade glows when on: an emissive tint
// scaled by level, plus a point light so the room picks it up.
export function ShadeMaterial({
  color,
  material = 'matte',
  state,
  solid = false,
}: {
  color: string
  material?: string
  state: LightState | null
  // Painted metal glows with the light it catches but never turns see
  // through.
  solid?: boolean
}) {
  const glow = state?.glow ?? [1, 1, 1]
  // Eased, so a lamp fades up and down and follows a dimmer smoothly
  // instead of stepping with each update.
  const lit = useEased(state?.on ? (state.level ?? 1) : 0, 9)
  // A colored light on a chalky shade was barely a tint, since the shade's
  // own color carried the surface. The shade takes the light's color as it
  // comes up, so a green lamp reads green from across the room.
  const [gr, gg, gb] = glow
  const tint = useMemo(
    () => new Color(color).lerp(new Color(gr, gg, gb), 0.85 * lit).getStyle(),
    [color, gr, gg, gb, lit],
  )
  return (
    <Material
      material={material}
      color={tint}
      doubleSide
      // Parchment and opal glass are not walls. A lit shade turns slightly
      // translucent, so the bulb shows through it, and it still stops enough
      // of the light to throw a shadow.
      opacity={solid ? 1 : 1 - 0.22 * lit}
      emissive={[glow[0], glow[1], glow[2]]}
      // Kept under one: past that the tone mapping rolls a bright color off
      // toward white, which is what made a colored lamp read as pale.
      emissiveIntensity={lit * (0.15 + lit * 0.35)}
    />
  )
}

// Colored glass the bulb shines through, like a banker's lamp's green shade.
// It glows its own color when on rather than taking the light's, so a lit
// shade still reads green instead of going dark against the lit inside.
export function TintedGlassMaterial({
  color,
  material = 'ceramic',
  state,
}: {
  color: string
  material?: string
  state: LightState | null
}) {
  const lit = useEased(state?.on ? (state.level ?? 1) : 0, 9)
  const glow = useMemo(() => new Color(color), [color])
  return (
    <Material material={material} color={color} emissive={[glow.r, glow.g, glow.b]} emissiveIntensity={lit * 0.6} />
  )
}

export function BaseMaterial({ color, material = 'matte' }: { color: string; material?: string }) {
  return <Material material={material} color={color} />
}
