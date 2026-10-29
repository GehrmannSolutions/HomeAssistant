import { useMemo, type ReactNode } from 'react'
import { CylinderGeometry, ExtrudeGeometry, Quaternion, Shape, Vector3 } from 'three'
import type { Vec3 } from '#/scene/decor/points.ts'

// Parts shared by the chairs, stools and benches: tapered legs and curved
// seats and backs.

// A leg or a post between two points, its radius running from `r[0]` at
// `from` to `r[1]` at `to`. A square one is a four sided cylinder turned so
// its faces line up with the piece, `r` then being half its side.
export function Dowel({
  from,
  to,
  r,
  square = false,
  children,
}: {
  from: Vec3
  to: Vec3
  r: [number, number]
  square?: boolean
  children: ReactNode
}) {
  const { mid, length, turn } = useMemo(() => {
    const a = new Vector3(...from)
    const b = new Vector3(...to)
    return {
      mid: a.clone().add(b).multiplyScalar(0.5),
      length: a.distanceTo(b),
      turn: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()),
    }
  }, [from, to])
  const [r0, r1] = r
  const geometry = useMemo(() => {
    const k = square ? Math.SQRT2 : 1
    const geo = new CylinderGeometry(r1 * k, r0 * k, length, square ? 4 : 32)
    if (square) geo.rotateY(Math.PI / 4)
    return geo
  }, [r0, r1, length, square])
  return (
    <mesh geometry={geometry} position={mid} quaternion={turn} castShadow>
      {children}
    </mesh>
  )
}

// A curved panel: a slice of a tube `thick` deep and `width` across, bent
// round `radius`, running `length` along z and centered on it. Its outer
// face touches y 0 in the middle and curves up toward its edges.
function arc(width: number, radius: number, thick: number, length: number) {
  const b = Math.min(0.006, thick / 3)
  const half = Math.asin(Math.min((width / 2 - b) / radius, 0.99))
  const s = new Shape()
  const [from, to] = [-Math.PI / 2 - half, -Math.PI / 2 + half]
  s.absarc(0, radius, radius - b, from, to, false)
  s.absarc(0, radius, radius - thick + b, to, from, true)
  s.closePath()
  const geo = new ExtrudeGeometry(s, {
    depth: length - b * 2,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 4,
    curveSegments: 48,
  })
  geo.translate(0, 0, b - length / 2)
  return geo
}

// A seat that curves up at its sides: its underside at the middle is the
// group's origin.
export function ArcSeat({ size, radius, children }: { size: Vec3; radius: number; children: ReactNode }) {
  const [w, t, d] = size
  const geometry = useMemo(() => arc(w, radius, t, d), [w, t, d, radius])
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      {children}
    </mesh>
  )
}

// A back that wraps round the sitter: its outer face at the middle of its
// foot is the group's origin, and it rises from there along +y.
export function ArcBack({ size, radius, children }: { size: Vec3; radius: number; children: ReactNode }) {
  const [w, h, t] = size
  const geometry = useMemo(() => {
    const geo = arc(w, radius, t, h)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(Math.PI)
    geo.translate(0, h / 2, 0)
    return geo
  }, [w, h, t, radius])
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      {children}
    </mesh>
  )
}

// A round end on a leg that stops at or above the seat.
export function Cap({ at, r, children }: { at: Vec3; r: number; children: ReactNode }) {
  return (
    <mesh position={at} scale={[1, 0.45, 1]}>
      <sphereGeometry args={[r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      {children}
    </mesh>
  )
}
