import { useFrame } from '@react-three/fiber'
import { screenTint, showingTint } from '#/scene/decor/tint.ts'
import { useLive } from '#/scene/live.ts'
import { useMemo, useRef } from 'react'
import type { MeshBasicMaterial } from 'three'

// The picture playing in a beam: its brightness cuts from scene to scene
// and it shimmers a little in between, in the colors a TV that is on goes
// through, at the same moment. `base` is the beam's full opacity, which the
// scene now on screen scales. `color`, when given, is the main color of
// what a player plays, which the beam takes instead. Returns the ref for
// the beam's material.
export function useBeamScene(base: number, color: string | null = null) {
  const material = useRef<MeshBasicMaterial>(null)
  const scene = useRef({ level: 1, target: 1, next: 0 })
  const rgb = useMemo<[number, number, number]>(() => [0, 0, 0], [])
  useLive(base > 0.001)
  useFrame(({ clock }, delta) => {
    const mat = material.current
    if (!mat) return
    const now = clock.elapsedTime
    const at = scene.current
    if (now >= at.next) {
      at.target = 0.55 + Math.random() * 0.45
      at.next = now + 0.25 + Math.random() * 0.9
    }
    // A cut lands fast, and the picture shimmers a little while it plays.
    at.level += (at.target - at.level) * Math.min(1, delta * 14)
    const shimmer = 1 + Math.sin(now * 23) * 0.03 + Math.sin(now * 37.3) * 0.02
    mat.opacity = base * at.level * shimmer
    if (color) showingTint(color, rgb)
    else screenTint(now, rgb)
    mat.color.setRGB(rgb[0], rgb[1], rgb[2])
  })
  return material
}
