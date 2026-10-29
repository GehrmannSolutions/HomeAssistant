import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type { BufferGeometry, Mesh } from 'three'

// Most models build their shapes in code and hand them to a mesh as a value,
// and a slider builds a new one on every step. Three keeps what it uploaded
// for each one until it is disposed of, which nothing did, so every drag
// left a trail of buffers on the graphics card. A shape that has left the
// scene is disposed of here. One that comes back is simply uploaded again,
// so this can never take away a shape that is still drawn.
const SWEEP_S = 1

export default function Cleanup() {
  // When each shape was last seen in the scene, by frame.
  const [seen] = useState(() => new Map<BufferGeometry, number>())
  const frame = useRef(0)
  const since = useRef(0)
  useFrame(({ scene }, delta) => {
    // The scene is only walked when it is about to be swept. A shape that
    // came and went between two sweeps was never uploaded to begin with,
    // three uploads on first draw, so nothing is missed by looking less.
    since.current += delta
    if (since.current < SWEEP_S) return
    since.current = 0
    const now = ++frame.current
    scene.traverse(object => {
      const geometry = (object as Mesh).geometry
      if (geometry?.isBufferGeometry) seen.set(geometry, now)
    })
    for (const [geometry, at] of seen)
      if (at !== now) {
        geometry.dispose()
        seen.delete(geometry)
      }
  })
  return null
}
