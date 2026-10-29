import type { Vec3 } from '#/scene/decor/points.ts'
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Matrix4, TubeGeometry, Vector3 } from 'three'

// Plants are built from many small parts, so each is gathered into one
// geometry per color and drawn as a single mesh: a palm's few hundred
// leaflets cost one draw, not one each.

// A leaf blade, laid out from its base along +z, across x, with its face up
// +y. The outline is the half width along the length, from base to tip.
export type Blade = {
  length: number
  width: number
  // Half width over the full width, at t from 0 at the base to 1 at the tip.
  outline: (t: number) => number
  rows?: number
  // Columns each side of the midrib.
  cols?: number
  // The two halves lifted along the midrib, as a rise per unit across.
  fold?: number
  // How far the tip drops below the base, in meters. Negative lifts it.
  droop?: number
  // How far the edges drop below the midrib, in meters.
  curl?: number
  // A heart shaped base: how far back the lobes reach past the stalk, as a
  // share of the length.
  sinus?: number
  // A leaf held at its middle, like a pilea's, rather than at its base.
  centered?: boolean
  // The margin waves up and down this far, in meters.
  wave?: number
  // Turns about its length from base to tip, in radians.
  twist?: number
  // Keeps a cell by where its middle falls, u across from -1 to 1 and t
  // along. A monstera's splits and holes are the cells it leaves out.
  keep?: (u: number, t: number) => boolean
  // Lifts the whole blade off its face, to lay markings over another.
  lift?: number
}

// A small steady random, so a plant looks the same every time it is drawn.
export function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// An outline through points of t and half width, eased between them.
export function outline(points: [number, number][]) {
  return (t: number) => {
    for (let i = 1; i < points.length; i++) {
      const [t1, w1] = points[i]
      if (t <= t1) {
        const [t0, w0] = points[i - 1]
        const k = (t - t0) / (t1 - t0 || 1)
        const s = k * k * (3 - 2 * k)
        return w0 + (w1 - w0) * s
      }
    }
    return points[points.length - 1][1]
  }
}

const UP = new Vector3(0, 1, 0)

// A placement at `at`, with the part's +z along `forward` and its +y as
// near `up` as it can be.
export function place(at: Vec3 | Vector3, forward: Vector3, up: Vector3 = UP): Matrix4 {
  const z = forward.clone().normalize()
  let x = new Vector3().crossVectors(up, z)
  if (x.lengthSq() < 1e-8) x = new Vector3().crossVectors(new Vector3(1, 0, 0), z)
  x.normalize()
  const y = new Vector3().crossVectors(z, x)
  const m = new Matrix4().makeBasis(x, y, z)
  const p = at instanceof Vector3 ? at : new Vector3(...at)
  return m.setPosition(p)
}

// A direction from a compass turn about y, where 0 faces +z, and a rise
// above level, both in radians.
export function heading(turn: number, rise: number) {
  return new Vector3(Math.sin(turn) * Math.cos(rise), Math.sin(rise), Math.cos(turn) * Math.cos(rise))
}

// Where a blade's midrib ends and which way it points there, in the
// blade's own frame, for a part that carries on from its tip.
export function bladeTip(blade: Blade): Matrix4 {
  const droop = blade.droop ?? 0
  const slope = Math.atan2(-2 * droop, blade.length)
  return new Matrix4().makeRotationX(-slope).setPosition(0, -droop, blade.length)
}

export class Foliage {
  private positions: number[] = []
  private indices: number[] = []
  private at = new Vector3()

  private vertex(m: Matrix4, x: number, y: number, z: number) {
    this.at.set(x, y, z).applyMatrix4(m)
    this.positions.push(this.at.x, this.at.y, this.at.z)
    return this.positions.length / 3 - 1
  }

  blade(b: Blade, m: Matrix4) {
    const rows = b.rows ?? 12
    const cols = b.cols ?? 3
    const droop = b.droop ?? 0
    const fold = b.fold ?? 0
    const curl = b.curl ?? 0
    const sinus = b.sinus ?? 0
    const wave = b.wave ?? 0
    const twist = b.twist ?? 0
    const lift = b.lift ?? 0
    const shift = b.centered ? -b.length / 2 : 0
    const first = this.positions.length / 3
    const across = cols * 2 + 1
    for (let r = 0; r <= rows; r++) {
      const t = r / rows
      const half = (b.width / 2) * b.outline(t)
      const spin = twist * t
      for (let c = -cols; c <= cols; c++) {
        const u = c / cols
        let x = u * half
        let z = t * b.length + shift - sinus * b.length * Math.abs(u) ** 1.5 * (1 - t) ** 3
        let y = fold * Math.abs(x) - droop * t * t - curl * u * u + lift
        y += wave * u * u * Math.sin(t * 19 + u * 3)
        if (spin) {
          const cx = x * Math.cos(spin) - y * Math.sin(spin)
          y = x * Math.sin(spin) + y * Math.cos(spin)
          x = cx
        }
        z = Math.max(z, shift - sinus * b.length)
        this.vertex(m, x, y, z)
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < across - 1; c++) {
        if (b.keep) {
          const u = (c + 0.5 - cols) / cols
          const t = (r + 0.5) / rows
          if (!b.keep(u, t)) continue
        }
        const a = first + r * across + c
        const d = a + across
        this.indices.push(a, d, a + 1, a + 1, d, d + 1)
      }
    }
  }

  // Any geometry, placed by `m`.
  add(geometry: BufferGeometry, m?: Matrix4) {
    const g = geometry
    const pos = g.getAttribute('position')
    const first = this.positions.length / 3
    for (let i = 0; i < pos.count; i++) {
      this.at.fromBufferAttribute(pos, i)
      if (m) this.at.applyMatrix4(m)
      this.positions.push(this.at.x, this.at.y, this.at.z)
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.indices.push(first + g.index.getX(i))
    else for (let i = 0; i < pos.count; i++) this.indices.push(first + i)
    geometry.dispose()
  }

  // A stem through the points, tapering from r0 to r1.
  stem(points: Vec3[], r0: number, r1 = r0, m?: Matrix4, sides = 6) {
    const curve = new CatmullRomCurve3(points.map(p => new Vector3(...p)))
    const segments = Math.max(4, Math.round(curve.getLength() / 0.03))
    const tube = new TubeGeometry(curve, Math.min(segments, 48), 1, sides, false)
    const pos = tube.getAttribute('position')
    const center = new Vector3()
    const count = Math.min(segments, 48)
    for (let i = 0; i <= count; i++) {
      curve.getPointAt(i / count, center)
      const r = r0 + (r1 - r0) * (i / count)
      for (let j = 0; j <= sides; j++) {
        const k = i * (sides + 1) + j
        this.at.fromBufferAttribute(pos, k).sub(center).multiplyScalar(r).add(center)
        pos.setXYZ(k, this.at.x, this.at.y, this.at.z)
      }
    }
    this.add(tube, m)
  }

  get empty() {
    return this.indices.length === 0
  }

  geometry() {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    g.setIndex(this.indices)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}

// Turns a part about its own +z, the way a leaf rolls on its stalk.
export function roll(m: Matrix4, angle: number) {
  return m.clone().multiply(new Matrix4().makeRotationZ(angle))
}

// A frame moved along its own axes.
export function along(m: Matrix4, x: number, y: number, z: number) {
  return m.clone().multiply(new Matrix4().makeTranslation(x, y, z))
}

// A stalk that leaves at `from` radians above level, turning in the one
// vertical plane toward `to` at its end, the way a palm frond arches over.
// The bend says how late it turns: above one it rises straight for longer.
export function arch(start: Vector3, turn: number, from: number, to: number, length: number, bend = 1.3, steps = 16) {
  const points = [start.clone()]
  const tangents: Vector3[] = []
  let at = start.clone()
  for (let i = 0; i <= steps; i++) {
    const d = heading(turn, from + (to - from) * (i / steps) ** bend)
    tangents.push(d)
    if (i < steps) {
      at = at.clone().addScaledVector(d, length / steps)
      points.push(at)
    }
  }
  // The point and direction a share s of the way along.
  const sample = (s: number) => {
    const k = Math.min(Math.max(s, 0), 1) * steps
    const i = Math.min(Math.floor(k), steps - 1)
    const f = k - i
    return {
      at: points[i].clone().lerp(points[i + 1], f),
      toward: tangents[i]
        .clone()
        .lerp(tangents[i + 1], f)
        .normalize(),
    }
  }
  return { points, sample }
}
