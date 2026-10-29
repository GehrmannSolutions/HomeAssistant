import type { Point } from '#/types.ts'
import { BufferGeometry, Float32BufferAttribute } from 'three'

// A small convex piece rounded all over, the way a pebble is: every point
// of a flat core grown outward by the same amount in every direction. The
// core is the sharp convex outline `core`, counter clockwise, grown on the
// plan by `radius` and then by a ball of `fillet`, and as thick as `depth`
// between the two rounded rims. Since every part of the surface is the core
// pushed out along its own normal, the rounding of a side always runs into
// the rounding of a corner exactly, with nothing standing out. The top is at
// y = 0 and plan y maps to -z. Units are plan meters, and so are the uvs, so
// a floor's surface lies on it at the size it has on the floor.
export function pebbleGeometry(
  core: Point[],
  radius: number,
  fillet: number,
  depth: number,
  segments: number,
  shift = 0,
): BufferGeometry {
  const n = core.length
  // Round each corner of the core: points on the plan, each with the way out
  // from there. The arc sweeps from the normal of the edge coming in to that
  // of the edge going out.
  const outline: { p: Point; n: Point }[] = []
  for (let i = 0; i < n; i++) {
    const c = core[i]
    const prev = core[(i - 1 + n) % n]
    const next = core[(i + 1) % n]
    const from = Math.atan2(-(c[0] - prev[0]), c[1] - prev[1])
    let to = Math.atan2(-(next[0] - c[0]), next[1] - c[1])
    while (to < from) to += Math.PI * 2
    const steps = Math.max(1, Math.ceil(((to - from) / (Math.PI / 2)) * segments))
    for (let k = 0; k <= steps; k++) {
      const a = from + ((to - from) * k) / steps
      const dir: Point = [Math.cos(a), Math.sin(a)]
      outline.push({ p: [c[0] + dir[0] * radius, c[1] + dir[1] * radius], n: dir })
    }
  }

  // The profile of the rim, top to bottom: how far out, how far down, and
  // the normal's lean, a quarter turn over the top, the straight side, and a
  // quarter turn under.
  type Ring = { out: number; y: number; s: number; c: number }
  const rings: Ring[] = []
  for (let j = 0; j <= segments; j++) {
    const a = (j / segments) * (Math.PI / 2)
    rings.push({ out: fillet * Math.sin(a), y: -fillet * (1 - Math.cos(a)), s: Math.sin(a), c: Math.cos(a) })
  }
  for (let j = 0; j <= segments; j++) {
    const a = Math.PI / 2 + (j / segments) * (Math.PI / 2)
    rings.push({ out: fillet * Math.sin(a), y: -fillet - depth + fillet * Math.cos(a), s: Math.sin(a), c: Math.cos(a) })
  }

  const position: number[] = []
  const normal: number[] = []
  const vertex = (p: Point, dir: Point, ring: Ring) => {
    position.push(p[0] + dir[0] * ring.out, ring.y, -(p[1] + dir[1] * ring.out))
    normal.push(dir[0] * ring.s, ring.c, -dir[1] * ring.s)
  }

  // The rim, ring to ring round the whole outline.
  const m = outline.length
  for (let i = 0; i < m; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % m]
    for (let j = 0; j < rings.length - 1; j++) {
      const high = rings[j]
      const low = rings[j + 1]
      vertex(a.p, a.n, high)
      vertex(a.p, a.n, low)
      vertex(b.p, b.n, low)
      vertex(a.p, a.n, high)
      vertex(b.p, b.n, low)
      vertex(b.p, b.n, high)
    }
  }

  // The flat top and underside inside the rims, a fan from the middle,
  // which a convex outline allows.
  const middle: Point = [
    outline.reduce((sum, v) => sum + v.p[0], 0) / m,
    outline.reduce((sum, v) => sum + v.p[1], 0) / m,
  ]
  const up = rings[0]
  const down = rings[rings.length - 1]
  for (let i = 0; i < m; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % m]
    vertex(middle, [0, 0], up)
    vertex(a.p, a.n, up)
    vertex(b.p, b.n, up)
    vertex(middle, [0, 0], down)
    vertex(b.p, b.n, down)
    vertex(a.p, a.n, down)
  }

  const uv: number[] = []
  for (let i = 0; i < position.length; i += 3) uv.push(position[i] + shift, -position[i + 2] + shift)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  return geometry
}
