import { Foliage, arch, heading, outline, place, random, roll, type Blade } from '#/scene/decor/foliage.ts'
import { SEG } from '#/scene/decor/parts.tsx'
import type { Vec3 } from '#/scene/decor/points.ts'
import { useEffect, useMemo, type ReactNode } from 'react'
import { BufferGeometry, CatmullRomCurve3, IcosahedronGeometry, LatheGeometry, Matrix4, Vector2, Vector3 } from 'three'

// Houseplants, each after a real one at its usual size indoors. The leaves
// are real outlines bent along the midrib, and every part is built for the
// size asked: a taller fig gets a longer trunk and bigger leaves, not a
// stretched one.

// The color slot a part takes, and whether both its faces show.
export type Paint = (slot: string, both?: boolean) => ReactNode

type Parts = Record<string, Foliage>
type Grown = Record<string, BufferGeometry>

const UP = new Vector3(0, 1, 0)
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

function grow(parts: Parts): Grown {
  const out: Grown = {}
  for (const [slot, f] of Object.entries(parts)) if (!f.empty) out[slot] = f.geometry()
  return out
}

// The meshes of a plant, one per color, freed once the plant changes.
function Growth({ grown, paint, flat = [] }: { grown: Grown; paint: Paint; flat?: string[] }) {
  useEffect(() => () => Object.values(grown).forEach(g => g.dispose()), [grown])
  return (
    <>
      {Object.entries(grown).map(([slot, geometry]) => (
        <mesh key={slot} geometry={geometry} castShadow>
          {paint(slot, !flat.includes(slot))}
        </mesh>
      ))}
    </>
  )
}

type PotShape = 'straight' | 'terracotta' | 'basket'

// A turned pot with the soil sunk just below its rim.
function Pot({ r, h, shape, paint }: { r: number; h: number; shape: PotShape; paint: Paint }) {
  const wall = clamp(r * 0.06, 0.005, 0.012)
  const geometry = useMemo(() => {
    const points: [number, number][] =
      shape === 'terracotta'
        ? [
            [0.001, 0],
            [r * 0.72, 0],
            [r * 0.74, h * 0.02],
            [r * 0.88, h * 0.8],
            [r, h * 0.81],
            [r, h],
            [r - wall, h],
            [r - wall, h * 0.84],
            [r * 0.88 - wall, h * 0.8],
          ]
        : shape === 'basket'
          ? [
              [0.001, 0],
              [r * 0.82, 0],
              ...Array.from({ length: 120 }, (_, i): [number, number] => {
                const y = (h * (i + 1)) / 121
                // Woven: a gentle belly with a rib every few centimeters.
                const belly = 0.86 + 0.14 * Math.sin((y / h) * Math.PI * 0.8)
                return [r * belly + 0.0015 * Math.sin((y / 0.012) * Math.PI * 2), y]
              }),
              [r, h],
              [r - wall, h],
            ]
          : [
              [0.001, 0],
              [r * 0.9, 0],
              [r * 0.93, h * 0.03],
              [r, h],
              [r - wall, h],
              [r - wall, h * 0.9],
            ]
    return new LatheGeometry(
      points.map(([x, y]) => new Vector2(x, y)),
      SEG * 2,
    )
  }, [r, h, shape, wall])
  useEffect(() => () => geometry.dispose(), [geometry])
  const soil = h * 0.9
  return (
    <group>
      <mesh geometry={geometry} castShadow>
        {paint('pot', true)}
      </mesh>
      <mesh position={[0, soil - 0.005, 0]}>
        <cylinderGeometry args={[r * (shape === 'terracotta' ? 0.9 : 0.97) - wall, r * 0.8, 0.01, SEG]} />
        {paint('soil')}
      </mesh>
    </group>
  )
}

// Leaf outlines, half width along the length.
const FIDDLE = outline([
  [0, 0.2],
  [0.1, 0.5],
  [0.3, 0.62],
  [0.45, 0.66],
  [0.7, 0.97],
  [0.85, 0.93],
  [0.96, 0.55],
  [1, 0],
])
const HEART = outline([
  [0, 0.62],
  [0.18, 0.95],
  [0.42, 0.98],
  [0.7, 0.66],
  [0.9, 0.24],
  [1, 0],
])
const LANCE = outline([
  [0, 0.25],
  [0.2, 0.9],
  [0.45, 1],
  [0.8, 0.6],
  [1, 0],
])
const PINNULE = outline([
  [0, 0.55],
  [0.3, 1],
  [0.8, 0.6],
  [1, 0],
])
const SWORD = outline([
  [0, 0.45],
  [0.15, 0.72],
  [0.5, 1],
  [0.78, 0.78],
  [0.94, 0.3],
  [1, 0],
])
const OVAL = outline([
  [0, 0.3],
  [0.25, 0.9],
  [0.55, 1],
  [0.85, 0.7],
  [0.97, 0.25],
  [1, 0],
])
const PADDLE = outline([
  [0, 0.3],
  [0.12, 0.85],
  [0.3, 1],
  [0.8, 0.95],
  [0.95, 0.55],
  [1, 0],
])
const ROUND = (t: number) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * (t > 0.92 ? 1 - (t - 0.92) * 2 : 1)

// A monstera leaf's splits run in from the margin along the side veins, and
// a row of holes opens between them near the midrib.
function monsteraCut(splits: number) {
  return (u: number, t: number) => {
    const a = Math.abs(u)
    const v = (t - 0.2 * a) * splits
    const f = v - Math.floor(v)
    if (a > 0.3 && t > 0.1 && t < 0.9 && f < 0.3) return false
    if (a > 0.1 && a < 0.24 && t > 0.2 && t < 0.78 && f > 0.45 && f < 0.8) return false
    return true
  }
}

// A leaf on a short stalk from `at`, its blade pointing `toward`.
function leaf(f: Parts, blade: Blade, at: Vector3, toward: Vector3, stalk: number, face = UP, turn = 0) {
  const end = at.clone().addScaledVector(toward, stalk)
  if (stalk > 0.005) f.stems.stem([at.toArray() as Vec3, end.toArray() as Vec3], 0.003, 0.0025)
  f.leaves.blade(blade, roll(place(end, toward, face), turn))
}

// Fiddle leaf fig, Ficus lyrata, grown as a standard: a bare trunk to a
// crown of three branches, the big fiddle shaped leaves spiralling up them.
function fiddle(size: number, height: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage() }
  const rnd = random(7)
  const soil = potH * 0.9
  const L = clamp(height * 0.2, 0.14, 0.38)
  const W = L * 0.62
  const fork = soil + (height - soil) * 0.42
  const trunkR = clamp(height * 0.012, 0.012, 0.028)
  f.stems.stem(
    [
      [0, soil - 0.03, 0],
      [0.012, soil + (fork - soil) * 0.5, 0],
      [-0.008, fork, 0.008],
    ],
    trunkR,
    trunkR * 0.8,
  )
  const top = new Vector3(-0.008, fork, 0.008)
  const leader = Math.max(0.1, height - fork - L * 0.55)
  const reach = Math.max(0.08, Math.min(leader * 0.75, (size / 2 - L * 0.75) / 0.6))
  const shoots: { from: Vector3; toward: Vector3; length: number }[] = [
    { from: top, toward: new Vector3(0.05, 1, 0).normalize(), length: leader },
    ...[0.4, 2.5, 4.6].map(a => ({ from: top, toward: heading(a, 0.93), length: reach })),
  ]
  let k = 0
  for (const shoot of shoots) {
    const end = shoot.from.clone().addScaledVector(shoot.toward, shoot.length)
    f.stems.stem([shoot.from.toArray() as Vec3, end.toArray() as Vec3], trunkR * 0.6, trunkR * 0.35)
    const count = Math.max(4, Math.round(shoot.length / 0.07) + 3)
    for (let i = 0; i < count; i++) {
      const s = 0.15 + (0.85 * (i + 1)) / count
      const at = shoot.from.clone().addScaledVector(shoot.toward, shoot.length * s)
      const young = s > 0.9 ? 0.75 : 1
      const rise = -0.15 + s * 0.8 + rnd() * 0.2
      const size = L * young * (0.85 + rnd() * 0.25)
      leaf(
        f,
        {
          length: size,
          width: W * young,
          outline: FIDDLE,
          sinus: 0.05,
          fold: 0.18,
          droop: size * (0.14 - s * 0.08),
          wave: size * 0.02,
          rows: 14,
          cols: 4,
        },
        at,
        heading(k++ * 2.4 + rnd() * 0.4, rise),
        0.035,
        UP,
        (rnd() - 0.5) * 0.4,
      )
    }
  }
  return f
}

// Monstera deliciosa on a moss pole: long stalks from the soil, each ending
// in a broad heart shaped leaf split to the midrib and holed along it.
function monstera(size: number, height: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage(), soil: new Foliage() }
  const rnd = random(11)
  const soil = potH * 0.9
  const L = clamp(Math.min(height * 0.34, size * 0.36), 0.16, 0.55)
  const count = 11
  // How far up the pole the highest stalk sets off from.
  let climbed = soil
  for (let i = 0; i < count; i++) {
    const a = i * 2.4 + rnd() * 0.3
    const rise = 1.25 - (i % 4) * 0.14 - rnd() * 0.08
    const tall = (height - soil - L * 0.25) / Math.sin(rise)
    const wide = (size / 2 - L * 0.85) / Math.cos(rise)
    // A stalk only reaches as far out as the plant is wide. Whatever height
    // that leaves it short of, the plant makes up by climbing: the stalks set
    // off from up the moss pole, spread between the soil and the top.
    const up = Math.max(0, tall - wide) * Math.sin(rise) * (((i * 5) % count) / (count - 1))
    const base = new Vector3(Math.sin(a) * 0.03, soil + up, Math.cos(a) * 0.03)
    climbed = Math.max(climbed, base.y)
    const stalk = Math.max(0.1, Math.min(tall, wide) * (0.62 + (0.38 * ((i * 7) % count)) / count))
    const toward = heading(a, rise)
    const end = base.clone().addScaledVector(toward, stalk)
    const mid = base
      .clone()
      .addScaledVector(toward, stalk * 0.5)
      .add(heading(a, 0).multiplyScalar(stalk * 0.06))
    f.stems.stem([base.toArray() as Vec3, mid.toArray() as Vec3, end.toArray() as Vec3], 0.009, 0.006)
    const small = 0.7 + 0.3 * (stalk / Math.max(tall, 0.1))
    const leafL = L * Math.min(1, small)
    f.leaves.blade(
      {
        length: leafL,
        width: leafL * 0.92,
        outline: HEART,
        sinus: 0.14,
        droop: leafL * 0.12,
        curl: leafL * 0.07,
        rows: 60,
        cols: 14,
        keep: monsteraCut(leafL > 0.25 ? 7 : 5),
      },
      roll(place(end, heading(a + (rnd() - 0.5) * 0.3, -0.15 - rnd() * 0.35)), (rnd() - 0.5) * 0.3),
    )
    // A couple of aerial roots from the lower stalks down to the soil.
    if (i % 5 === 1) {
      const from = base.clone().addScaledVector(toward, stalk * 0.25)
      f.soil.stem(
        [from.toArray() as Vec3, [from.x * 1.8, (from.y + soil) / 2, from.z * 1.8], [from.x * 2.2, soil, from.z * 2.2]],
        0.004,
        0.003,
      )
    }
  }
  // The moss pole, up past the highest stalk that leaves it.
  f.soil.stem(
    [
      [0, soil - 0.05, 0],
      [0, Math.max(soil + (height - soil) * 0.36, climbed + L * 0.2), 0],
    ],
    clamp(height * 0.02, 0.018, 0.035),
    clamp(height * 0.02, 0.018, 0.035),
    undefined,
    10,
  )
  return f
}

// Kentia palm, Howea forsteriana, several seedlings to a pot as nurseries
// sell them: fronds that rise, arch over and hang their leaflets in a V.
function kentia(size: number, height: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage() }
  const rnd = random(5)
  const soil = potH * 0.9
  const count = 12
  for (let i = 0; i < count; i++) {
    const a = i * 2.4 + rnd() * 0.4
    const from = 1.45 - rnd() * 0.3
    const to = -0.1 - rnd() * 0.4
    // Fit the arch to the height and spread asked, measured on a unit one.
    const unit = arch(new Vector3(), a, from, to, 1, 1.8)
    const peak = Math.max(...unit.points.map(p => p.y))
    const last = unit.points[unit.points.length - 1]
    const out = Math.hypot(last.x, last.z)
    const stemH = clamp(height * 0.08, 0.04, 0.2)
    const length =
      Math.min((height - soil - stemH) / peak, size / 2 / (out + 0.1)) * (0.75 + (0.25 * ((i * 5) % count)) / count)
    const base = new Vector3(Math.sin(a) * 0.025, soil + stemH * (0.5 + rnd() * 0.5), Math.cos(a) * 0.025)
    f.stems.stem([[base.x * 0.5, soil - 0.02, base.z * 0.5], base.toArray() as Vec3], 0.012, 0.009)
    const frond = arch(base, a, from, to, length, 1.8)
    f.stems.stem(
      frond.points.map(p => p.toArray() as Vec3),
      0.007,
      0.002,
    )
    const pairs = clamp(Math.round((length * 0.7) / 0.028), 10, 40)
    const longest = clamp(length * 0.3, 0.1, 0.5)
    for (let j = 0; j < pairs; j++) {
      const s = 0.3 + (0.68 * (j + 0.5)) / pairs
      const { at, toward } = frond.sample(s)
      const side = new Vector3().crossVectors(toward, UP)
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
      side.normalize()
      const up = new Vector3().crossVectors(side, toward).normalize()
      const k = (s - 0.28) / 0.72
      const ll = longest * Math.sin(Math.PI * (0.08 + k * 0.88))
      for (const sign of [-1, 1]) {
        const hang = 0.45 + s * 0.45
        const dir = toward
          .clone()
          .multiplyScalar(Math.cos(1.2))
          .addScaledVector(side, sign * Math.sin(1.2))
          .multiplyScalar(Math.cos(hang))
          .addScaledVector(up, -Math.sin(hang))
        f.leaves.blade(
          {
            length: ll,
            width: clamp(ll * 0.09, 0.012, 0.035),
            outline: LANCE,
            fold: 0.55,
            droop: ll * 0.18,
            rows: 6,
            cols: 1,
          },
          place(at, dir, up),
        )
      }
    }
  }
  return f
}

// A pothos vine from `from` up over the rim at `rim`, heading `a`, then
// hanging `long` below it with a leaf at every node, alternating sides.
function vine(
  f: Parts,
  put: (length: number, m: Matrix4, seed: number) => void,
  L: number,
  from: Vector3,
  rim: Vector3,
  a: number,
  long: number,
  v: number,
) {
  const out = heading(a, 0)
  const side = heading(a + Math.PI / 2, 0)
  const points: Vec3[] = [
    from.toArray() as Vec3,
    rim.toArray() as Vec3,
    [rim.x + out.x * 0.03, rim.y - 0.045, rim.z + out.z * 0.03],
  ]
  const steps = Math.max(2, Math.round(long / 0.12))
  for (let s = 1; s <= steps; s++) {
    const sway = Math.sin(s * 1.7 + v) * 0.03
    points.push([
      rim.x + out.x * (0.035 + s * 0.01) + side.x * sway,
      rim.y - 0.045 - (long * s) / steps,
      rim.z + out.z * (0.035 + s * 0.01) + side.z * sway,
    ])
  }
  f.stems.stem(points, 0.0025)
  const nodes = Math.max(2, Math.round(long / 0.05))
  for (let n = 0; n < nodes; n++) {
    const i = Math.min(points.length - 1, 2 + Math.floor(((points.length - 3) * n) / nodes))
    const at = new Vector3(...points[i]).lerp(
      new Vector3(...points[Math.min(points.length - 1, i + 1)]),
      (((points.length - 3) * n) / nodes) % 1,
    )
    const alt = n % 2 ? 1 : -1
    const toward = out
      .clone()
      .multiplyScalar(0.6)
      .addScaledVector(UP, 0.45)
      .addScaledVector(side, alt * 0.55)
      .normalize()
    const face = out.clone().addScaledVector(UP, 0.6).normalize()
    const at2 = at.clone().addScaledVector(toward, L * 0.3)
    f.stems.stem([at.toArray() as Vec3, at2.toArray() as Vec3], 0.0018)
    put(L * (0.7 + 0.3 * (1 - n / nodes)), place(at2, toward, face), v * 10 + n)
  }
}

// A pothos leaf, heart shaped and streaked with gold, placed by `m`.
function pothosLeaf(f: Parts) {
  const streaks = (seed: number) => (u: number, t: number) =>
    Math.sin(u * 7 + t * 11 + seed) * Math.sin(t * 23 + u * 3 + seed * 2) > 0.45
  return (length: number, m: Matrix4, seed: number) => {
    const b: Blade = {
      length,
      width: length * 0.68,
      outline: HEART,
      sinus: 0.1,
      fold: 0.25,
      droop: length * 0.1,
      rows: 14,
      cols: 5,
    }
    f.leaves.blade(b, m)
    f.markings.blade({ ...b, lift: 0.0008, keep: streaks(seed) }, m)
  }
}

// Golden pothos, Epipremnum aureum: a mound of heart shaped leaves over the
// pot and vines trailing down over its rim, the leaves streaked with gold.
function pothos(size: number, height: number, trail: number, potR: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage(), markings: new Foliage() }
  const rnd = random(3)
  const soil = potH * 0.9
  const L = clamp(size * 0.22, 0.04, 0.09)
  const put = pothosLeaf(f)
  // The mound over the pot.
  const mound = Math.max(0.03, height - potH)
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4
    const rise = 0.6 + rnd() * 0.7
    const from = new Vector3(Math.sin(a) * potR * 0.3, soil, Math.cos(a) * potR * 0.3)
    const end = from.clone().addScaledVector(heading(a, rise), mound * (0.5 + rnd() * 0.5))
    f.stems.stem([from.toArray() as Vec3, end.toArray() as Vec3], 0.003)
    put(L * (0.8 + rnd() * 0.3), roll(place(end, heading(a + (rnd() - 0.5) * 0.6, 0.1 + rnd() * 0.4)), 0), i)
  }
  // The vines over the rim.
  const vines = 5
  for (let v = 0; v < vines; v++) {
    const a = v * ((Math.PI * 2) / vines) + rnd() * 0.5
    const rim = heading(a, 0)
      .multiplyScalar(potR * 1.05)
      .setY(potH + 0.015)
    vine(f, put, L, new Vector3(0, soil, 0).lerp(rim, 0.5).setY(soil), rim, a, trail * (0.55 + 0.45 * rnd()), v)
  }
  return f
}

// Chinese money plant, Pilea peperomioides: one upright stem with round,
// slightly cupped leaves held from their middles on long stalks.
function pilea(size: number, height: number, potH: number): Parts {
  const f: Parts = { markings: new Foliage(), leaves: new Foliage() }
  const rnd = random(9)
  const soil = potH * 0.9
  const top = soil + Math.max(0.03, (height - potH) * 0.55)
  f.markings.stem(
    [
      [0, soil - 0.01, 0],
      [0.004, (soil + top) / 2, 0],
      [0, top, 0.003],
    ],
    0.006,
    0.004,
  )
  const count = 22
  for (let k = 0; k < count; k++) {
    const t = 0.12 + (0.88 * k) / count
    const node = new Vector3(0, soil + (top - soil) * t, 0)
    const a = k * 2.4
    const rise = 0.15 + t * 0.95
    const stalk = size * 0.4 * (1 - t * 0.55)
    const end = node.clone().addScaledVector(heading(a, rise), stalk)
    const bow = node.clone().addScaledVector(heading(a, rise + 0.2), stalk * 0.5)
    f.markings.stem([node.toArray() as Vec3, bow.toArray() as Vec3, end.toArray() as Vec3], 0.0022, 0.0018)
    const d = clamp(size * 0.24, 0.035, 0.1) * (0.6 + 0.4 * (1 - t)) * (0.9 + rnd() * 0.2)
    const face = UP.clone()
      .addScaledVector(heading(a, 0), 0.25 + t * 0.4)
      .normalize()
    f.leaves.blade(
      {
        length: d,
        width: d,
        outline: ROUND,
        centered: true,
        curl: -d * 0.07,
        rows: 12,
        cols: 6,
        lift: 0.004,
      },
      place(end, heading(a, -0.1 + t * 0.35), face),
    )
  }
  return f
}

// Snake plant, Dracaena trifasciata: stiff sword leaves straight up from the
// soil, banded across with grey green.
function snake(size: number, height: number, potR: number, potH: number): Parts {
  const f: Parts = { leaves: new Foliage(), markings: new Foliage() }
  const rnd = random(13)
  const soil = potH * 0.9
  const W = clamp(size * 0.24, 0.03, 0.07)
  const count = 7
  for (let i = 0; i < count; i++) {
    const a = i * 2.4 + rnd() * 0.3
    const r = potR * (i === 0 ? 0 : 0.25 + rnd() * 0.3)
    const at = new Vector3(Math.sin(a) * r, soil - 0.01, Math.cos(a) * r)
    const long = Math.max(0.05, (height - soil) * (i === 0 ? 1 : 0.62 + rnd() * 0.36))
    const splay = i === 0 ? 0.03 : 0.08 + rnd() * 0.22
    const blade: Blade = {
      length: long,
      width: W * (0.8 + rnd() * 0.25),
      outline: SWORD,
      curl: -W * 0.16,
      droop: -long * 0.03,
      twist: (rnd() - 0.5) * 0.6,
      rows: clamp(Math.round(long / 0.004), 20, 160),
      cols: 3,
    }
    const m = place(at, heading(a, Math.PI / 2 - splay), heading(a, 0))
    f.leaves.blade(blade, m)
    const bands = (u: number, t: number) => {
      const v = (t * long) / 0.02 + 0.28 * Math.sin(u * 4 + t * 30 + i)
      return v - Math.floor(v) < 0.42
    }
    f.markings.blade({ ...blade, lift: 0.0007, keep: bands }, m)
    f.markings.blade({ ...blade, lift: -0.0007, keep: bands }, m)
  }
  return f
}

// Boston fern, Nephrolepis exaltata, in a wall pocket: a crown of fronds
// that rise, arch over and hang, each with rows of small leaflets.
function boston(width: number, top: number, reach: number): Parts {
  const f: Parts = { leaves: new Foliage(), stems: new Foliage() }
  const rnd = random(17)
  const count = 28
  const crown = new Vector3(0, top, reach)
  for (let i = 0; i < count; i++) {
    const a = (rnd() - 0.5) * Math.PI * 0.95
    const from = 0.35 + rnd() * 0.95
    const to = -1.15 - rnd() * 0.35
    const length = width * (1.3 + rnd() * 0.9)
    const start = crown.clone().add(new Vector3((rnd() - 0.5) * width * 0.35, 0, (rnd() - 0.5) * reach * 0.5))
    const frond = arch(start, a, from, to, length, 1.1)
    f.stems.stem(
      frond.points.map(p => p.toArray() as Vec3),
      0.0022,
      0.001,
      undefined,
      4,
    )
    const pairs = clamp(Math.round(length / 0.014), 18, 60)
    const longest = clamp(length * 0.075, 0.018, 0.05)
    for (let j = 0; j < pairs; j++) {
      const s = 0.1 + (0.89 * (j + 0.5)) / pairs
      const { at, toward } = frond.sample(s)
      const side = new Vector3().crossVectors(toward, UP)
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
      side.normalize()
      const up = new Vector3().crossVectors(side, toward).normalize()
      const ll = longest * Math.min(1, (s - 0.08) * 5) * (1 - 0.85 * s * s)
      if (ll < 0.004) continue
      for (const sign of [-1, 1]) {
        const dir = toward
          .clone()
          .multiplyScalar(Math.cos(1.35))
          .addScaledVector(side, sign * Math.sin(1.35))
        f.leaves.blade(
          { length: ll, width: ll * 0.3, outline: PINNULE, droop: ll * 0.12, fold: 0.2, rows: 3, cols: 1 },
          place(at, dir, up),
        )
      }
    }
  }
  return f
}

// A pothos in a wall pocket: a mound of leaves over the rim, and vines
// spilling over the front and sides and hanging `trail` below it.
function hangingPothos(width: number, top: number, reach: number, trail: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage(), markings: new Foliage() }
  const rnd = random(23)
  const L = clamp(width * 0.2, 0.045, 0.085)
  const put = pothosLeaf(f)
  const crown = new Vector3(0, top - 0.02, reach * 0.5)
  for (let i = 0; i < 10; i++) {
    const a = (rnd() - 0.5) * Math.PI * 0.9
    const from = crown.clone().add(new Vector3((rnd() - 0.5) * width * 0.4, 0, (rnd() - 0.5) * reach * 0.4))
    const end = from.clone().addScaledVector(heading(a, 0.5 + rnd() * 0.7), L * (0.8 + rnd() * 0.6))
    f.stems.stem([from.toArray() as Vec3, end.toArray() as Vec3], 0.003)
    put(L * (0.8 + rnd() * 0.3), place(end, heading(a + (rnd() - 0.5) * 0.6, 0.1 + rnd() * 0.4)), i)
  }
  const vines = 7
  for (let v = 0; v < vines; v++) {
    const a = (v / (vines - 1) - 0.5) * 2.5 + (rnd() - 0.5) * 0.2
    const rim = new Vector3(Math.sin(a) * width * 0.5, top + 0.01, Math.cos(a) * reach)
    vine(f, put, L, crown, rim, a, trail * (0.45 + 0.55 * rnd()), v)
  }
  return f
}

// String of pearls, Curio rowleyanus, in a wall pocket: thread thin stems
// strung with round green beads, spilling over the rim and hanging straight
// down, a few shorter ones still lying on top.
function pearls(width: number, top: number, reach: number, trail: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage() }
  const rnd = random(29)
  const bead = 0.0048
  const strands = 16
  for (let v = 0; v < strands; v++) {
    const a = (v / (strands - 1) - 0.5) * 2.6 + (rnd() - 0.5) * 0.15
    const out = heading(a, 0)
    const side = heading(a + Math.PI / 2, 0)
    const from = new Vector3((rnd() - 0.5) * width * 0.5, top - 0.01, reach * (0.3 + rnd() * 0.3))
    const rim = new Vector3(Math.sin(a) * width * 0.48, top + 0.006, Math.cos(a) * reach * 0.98)
    const long = v % 4 === 3 ? 0.04 : trail * (0.35 + 0.65 * rnd())
    const points: Vec3[] = [from.toArray() as Vec3, rim.toArray() as Vec3]
    const steps = Math.max(2, Math.round(long / 0.08))
    for (let s = 1; s <= steps; s++) {
      const sway = Math.sin(s * 1.3 + v * 2) * 0.012
      points.push([
        rim.x + out.x * 0.012 + side.x * sway,
        rim.y - 0.01 - (long * s) / steps,
        rim.z + out.z * 0.012 + side.z * sway,
      ])
    }
    f.stems.stem(points, 0.0012, 0.0012, undefined, 4)
    const curve = new CatmullRomCurve3(points.map(p => new Vector3(...p)))
    const count = Math.max(3, Math.round(curve.getLength() / 0.012))
    const at = new Vector3()
    for (let k = 1; k <= count; k++) {
      curve.getPointAt(k / count, at)
      const off = (k % 2 ? 1 : -1) * bead * 0.9
      const r = bead * (k > count - 3 ? 0.75 : 0.9 + rnd() * 0.2)
      f.leaves.add(
        new IcosahedronGeometry(r, 1),
        new Matrix4().makeTranslation(at.x + side.x * off, at.y, at.z + side.z * off),
      )
    }
  }
  return f
}

// Mango plant, Mangifera indica, young in a pot: five stems at different
// heights from the pot, leaning out a little, the big glossy leaves close
// together up them on short stalks and held up, all the way down to the pot.
function mango(size: number, height: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage() }
  const rnd = random(53)
  const soil = potH * 0.9
  const L = clamp(height * 0.13, 0.1, 0.3)
  const tops = [
    new Vector3(0.02, height - L * 0.3, 0.01),
    new Vector3(-size * 0.28, height * 0.84 - L * 0.3, -size * 0.05),
    new Vector3(size * 0.27, height * 0.76 - L * 0.3, -size * 0.08),
    new Vector3(size * 0.06, height * 0.64 - L * 0.3, size * 0.28),
    new Vector3(-size * 0.16, height * 0.56 - L * 0.3, size * 0.2),
  ]
  let k = 0
  tops.forEach((tip, n) => {
    const base = new Vector3(tip.x * 0.1, soil - 0.03, tip.z * 0.1)
    const r = clamp(height * 0.01, 0.008, 0.02) * (n ? 0.85 : 1)
    const bend = base
      .clone()
      .lerp(tip, 0.5)
      .add(new Vector3(n ? -0.02 : 0.02, 0, 0))
    f.stems.stem([base.toArray() as Vec3, bend.toArray() as Vec3, tip.toArray() as Vec3], r, r * 0.6)
    const curve = new CatmullRomCurve3([base, bend, tip])
    const count = Math.max(5, Math.round((tip.y - soil) / 0.055))
    const from = 0.08
    for (let i = 0; i < count; i++) {
      const s = from + ((1 - from) * (i + 1)) / count
      const at = curve.getPointAt(Math.min(s, 1))
      const young = s > 0.92 ? 0.6 : 1 - s * 0.15
      const length = L * young * (0.9 + rnd() * 0.2)
      const reach = Math.min(1, (size / 2 - Math.hypot(at.x, at.z)) / (length * 1.1))
      leaf(
        f,
        {
          length,
          width: length * 0.52,
          outline: OVAL,
          fold: 0.12,
          droop: length * (0.18 - s * 0.1),
          curl: length * 0.03,
          rows: 14,
          cols: 4,
        },
        at,
        heading(k++ * 2.4 + rnd() * 0.3, 0.3 + s * 0.8 - (1 - Math.max(reach, 0)) * 0.3),
        0.03,
        UP,
        (rnd() - 0.5) * 0.3,
      )
    }
    // The bud the next leaves open from, at the tip.
    f.stems.stem([tip.toArray() as Vec3, [tip.x, tip.y + L * 0.3, tip.z]], r * 0.6, r * 0.2)
  })
  return f
}

// Bird of paradise, Strelitzia nicolai: long upright stalks from the soil in
// a narrow fan, each ending in a big paddle shaped leaf held up.
function bird(size: number, height: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage() }
  const rnd = random(41)
  const soil = potH * 0.9
  const L = clamp(height * 0.34, 0.2, 0.7)
  const count = 9
  for (let i = 0; i < count; i++) {
    // A fan, mostly along x, the way a clump spreads.
    const a = (i % 2 ? Math.PI / 2 : -Math.PI / 2) + (rnd() - 0.5) * 1.2
    // Steep, so the clump stays narrow and the leaves stand tall.
    const rise = 1.48 - (i / count) * 0.28 - rnd() * 0.06
    const base = new Vector3((rnd() - 0.5) * 0.06, soil - 0.02, (rnd() - 0.5) * 0.06)
    const tall = (height - soil - L * 0.85) / Math.sin(rise)
    const wide = (size / 2 - L * 0.35) / Math.max(Math.cos(rise), 0.05)
    const stalk = Math.max(0.15, Math.min(tall, wide) * (0.7 + (0.3 * ((i * 5) % count)) / count))
    const toward = heading(a, rise)
    const end = base.clone().addScaledVector(toward, stalk)
    f.stems.stem([base.toArray() as Vec3, end.toArray() as Vec3], 0.011, 0.007)
    const long = L * (0.8 + rnd() * 0.25)
    f.leaves.blade(
      {
        length: long,
        width: long * 0.42,
        outline: PADDLE,
        fold: 0.1,
        droop: long * (0.04 + (1.5 - rise) * 0.15),
        curl: long * 0.03,
        rows: 16,
        cols: 5,
        twist: (rnd() - 0.5) * 0.4,
      },
      place(end, heading(a + (rnd() - 0.5) * 0.3, Math.min(rise + 0.05, 1.45)), heading(a, 0).negate()),
    )
  }
  return f
}

// Golden bamboo, Phyllostachys aurea, a clump of canes in a tall pot: straight
// canes ringed at every node, thin branches from the upper nodes, and sprays
// of narrow leaves hanging off them.
function bamboo(size: number, height: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage() }
  const rnd = random(61)
  const soil = potH * 0.9
  const canes = 7
  const r = clamp(height * 0.006, 0.006, 0.013)
  const L = clamp(height * 0.08, 0.08, 0.16)
  for (let i = 0; i < canes; i++) {
    const a = i * 2.4 + rnd() * 0.3
    const lean = 0.03 + rnd() * 0.07
    const tall = (height - soil - L * 0.3) * (0.72 + (0.28 * ((i * 3) % canes)) / (canes - 1))
    const base = new Vector3(Math.sin(a) * 0.045 * rnd(), soil - 0.03, Math.cos(a) * 0.045 * rnd())
    const up = heading(a, Math.PI / 2 - lean)
    const top = base.clone().addScaledVector(up, tall)
    f.stems.stem([base.toArray() as Vec3, top.toArray() as Vec3], r, r * 0.65)
    const nodes = Math.max(5, Math.round(tall / 0.15))
    for (let j = 1; j <= nodes; j++) {
      const s = j / nodes
      const at = base.clone().addScaledVector(up, tall * s)
      // The ring each node makes on the cane.
      if (j < nodes) {
        const below = at.clone().addScaledVector(up, -0.004)
        const above = at.clone().addScaledVector(up, 0.004)
        f.stems.stem([below.toArray() as Vec3, above.toArray() as Vec3], r * (1.2 - s * 0.3), r * (1.2 - s * 0.3))
      }
      if (s < 0.4) continue
      const out = heading(a + (j % 2 ? 1 : -1) * (0.9 + rnd() * 0.6), 0.25 + rnd() * 0.35)
      const room = size / 2 - Math.hypot(at.x, at.z)
      const long = clamp(room * 0.7, 0.05, 0.22) * (1.15 - s * 0.45)
      const end = at.clone().addScaledVector(out, long)
      f.stems.stem([at.toArray() as Vec3, end.toArray() as Vec3], r * 0.3, r * 0.15)
      const leaves = 3 + Math.floor(rnd() * 3)
      for (let q = 0; q < leaves; q++) {
        const from = at.clone().lerp(end, 0.35 + (0.65 * q) / Math.max(leaves - 1, 1))
        const length = L * (0.75 + rnd() * 0.4)
        f.leaves.blade(
          {
            length,
            width: length * 0.13,
            outline: LANCE,
            fold: 0.25,
            droop: length * 0.22,
            rows: 8,
            cols: 1,
          },
          place(from, heading(a + (rnd() - 0.5) * 2.4, -0.2 - rnd() * 0.6)),
        )
      }
    }
  }
  return f
}

// Weeping fig, Ficus benjamina, grown as a small standard: a slim trunk that
// splits low into arching branches, hung all over with small pointed glossy
// leaves that droop toward their tips.
function ficus(size: number, height: number, potH: number): Parts {
  const f: Parts = { stems: new Foliage(), leaves: new Foliage() }
  const rnd = random(67)
  const soil = potH * 0.9
  const trunkR = clamp(height * 0.01, 0.01, 0.022)
  const fork = soil + (height - soil) * 0.28
  f.stems.stem(
    [
      [0, soil - 0.03, 0],
      [0.012, (soil + fork) / 2, -0.006],
      [0, fork, 0],
    ],
    trunkR,
    trunkR * 0.8,
  )
  const top = new Vector3(0, fork, 0)
  const L = clamp(height * 0.04, 0.045, 0.08)
  const ficusLeaf = (at: Vector3, toward: Vector3, scale: number) => {
    const length = L * (0.8 + rnd() * 0.35) * scale
    leaf(
      f,
      {
        length,
        width: length * 0.42,
        outline: OVAL,
        fold: 0.15,
        droop: length * 0.2,
        curl: length * 0.03,
        rows: 7,
        cols: 2,
      },
      at,
      toward,
      0.01,
      UP,
      (rnd() - 0.5) * 0.5,
    )
  }
  const branches = 13
  let k = 0
  for (let i = 0; i < branches; i++) {
    const a = i * 2.4 + rnd() * 0.4
    // The first branches rise steeply to make the top of the crown, the
    // later ones spread wider and weep lower.
    const from = 1.4 - (i / branches) * 0.8 - rnd() * 0.1
    const to = from - 1.5
    // Fit the arch to the height and spread asked, measured on a unit one.
    const unit = arch(new Vector3(), a, from, to, 1, 1.4)
    const peak = Math.max(...unit.points.map(q => q.y))
    const out = Math.max(...unit.points.map(q => Math.hypot(q.x, q.z)))
    const length =
      Math.min((height - fork - L) / Math.max(peak, 0.2), (size / 2 - L * 1.5) / Math.max(out, 0.1)) *
      (0.75 + (0.25 * ((i * 3) % branches)) / branches)
    const branch = arch(top, a, from, to, length, 1.4)
    f.stems.stem(
      branch.points.map(q => q.toArray() as Vec3),
      trunkR * 0.45,
      trunkR * 0.12,
    )
    // Short twigs hang off the branch, each leafy along its length, which
    // fills the crown out into the soft weeping mass the tree is.
    const twigs = Math.max(4, Math.round(length / 0.05))
    for (let j = 0; j < twigs; j++) {
      const s = 0.25 + (0.75 * (j + 0.5)) / twigs
      const { at } = branch.sample(s)
      const out = heading(a + (j % 2 ? 1 : -1) * (0.6 + rnd() * 0.6), -0.3 - rnd() * 0.7)
      const long = L * (1.2 + rnd() * 0.8)
      const end = at.clone().addScaledVector(out, long)
      f.stems.stem([at.toArray() as Vec3, end.toArray() as Vec3], 0.0025, 0.0015)
      const count = 3 + Math.floor(rnd() * 3)
      for (let n = 0; n < count; n++) {
        const along = at.clone().lerp(end, (n + 1) / count)
        ficusLeaf(along, heading(k++ * 2.4 + rnd() * 0.5, -0.2 - rnd() * 0.8), n === count - 1 ? 0.75 : 1)
      }
      ficusLeaf(at, heading(k++ * 2.4, 0.1 - rnd() * 0.5), 1)
    }
  }
  return f
}

// A plant short of water sinks toward its soil and spreads, its leaves
// hanging lower and wider round it. Everything above the soil, at height
// `at`, is squashed down onto it, the pot left as it is.
function Wilt({ at, wilt, children }: { at: number; wilt: number; children: ReactNode }) {
  if (wilt <= 0) return children
  return (
    <group position={[0, at, 0]} scale={[1 + 0.15 * wilt, 1 - 0.35 * wilt, 1 + 0.15 * wilt]}>
      <group position={[0, -at, 0]}>{children}</group>
    </group>
  )
}

export function FloorPlant({
  style,
  wilt = 0,
  size,
  height,
  paint,
}: {
  style: string
  size: number
  height: number
  paint: Paint
  // 0 watered to 1 dry.
  wilt?: number
}) {
  const kind = (['monstera', 'kentia', 'mango', 'bird', 'bamboo', 'ficus'] as const).find(k => k === style) ?? 'fiddle'
  const potR = kind === 'kentia' ? clamp(size * 0.16, 0.14, 0.22) : clamp(size * 0.2, 0.1, 0.2)
  const potH = kind === 'kentia' ? clamp(height * 0.2, 0.2, 0.38) : clamp(height * 0.2, 0.16, 0.34)
  const grown = useMemo(
    () =>
      grow(
        kind === 'monstera'
          ? monstera(size, height, potH)
          : kind === 'kentia'
            ? kentia(size, height, potH)
            : kind === 'mango'
              ? mango(size, height, potH)
              : kind === 'bird'
                ? bird(size, height, potH)
                : kind === 'bamboo'
                  ? bamboo(size, height, potH)
                  : kind === 'ficus'
                    ? ficus(size, height, potH)
                    : fiddle(size, height, potH),
      ),
    [kind, size, height, potH],
  )
  return (
    <group>
      <Pot r={potR} h={potH} shape={kind === 'kentia' ? 'basket' : 'straight'} paint={paint} />
      <Wilt at={potH} wilt={wilt}>
        <Growth grown={grown} paint={paint} flat={['stems', 'soil']} />
      </Wilt>
    </group>
  )
}

export function ShelfPlant({
  style,
  wilt = 0,
  size,
  height,
  trail,
  paint,
}: {
  style: string
  size: number
  height: number
  trail: number
  paint: Paint
  // 0 watered to 1 dry.
  wilt?: number
}) {
  const kind = style === 'pilea' || style === 'snake' ? style : 'pothos'
  const potR = kind === 'snake' ? clamp(size * 0.35, 0.05, 0.1) : clamp(size * 0.22, 0.05, 0.09)
  const potH = kind === 'pilea' ? potR * 1.5 : potR * 1.7
  const grown = useMemo(
    () =>
      grow(
        kind === 'pilea'
          ? pilea(size, height, potH)
          : kind === 'snake'
            ? snake(size, height, potR, potH)
            : pothos(size, height, trail, potR, potH),
      ),
    [kind, size, height, trail, potR, potH],
  )
  return (
    <group>
      <Pot r={potR} h={potH} shape={kind === 'pilea' ? 'terracotta' : 'straight'} paint={paint} />
      <Wilt at={potH} wilt={wilt}>
        <Growth grown={grown} paint={paint} flat={kind === 'pilea' ? ['markings'] : ['stems']} />
      </Wilt>
    </group>
  )
}

// Wall plants hang from their middle at the height set, off the wall at z 0,
// each in a half round pocket open at the top.
export function WallPlant({
  style,
  wilt = 0,
  width,
  trail,
  paint,
}: {
  style: string
  width: number
  trail: number
  paint: Paint
  // 0 watered to 1 dry.
  wilt?: number
}) {
  const kind = style === 'boston' || style === 'pearls' ? style : 'pothos'
  const tall = width * 0.6
  const reach = width * 0.5
  const top = tall / 2 - 0.02
  const grown = useMemo(
    () =>
      grow(
        kind === 'boston'
          ? boston(width, top, reach * 0.45)
          : kind === 'pearls'
            ? pearls(width, top, reach, trail)
            : hangingPothos(width, top, reach, trail),
      ),
    [kind, width, top, reach, trail],
  )
  return (
    <group>
      <group scale={[1, 1, reach / (width / 2)]}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[width / 2, width * 0.42, tall, SEG, 1, true, -Math.PI / 2, Math.PI]} />
          {paint('pot', true)}
        </mesh>
        <mesh position={[0, -tall / 2 + 0.003, 0]}>
          <cylinderGeometry args={[width * 0.42, width * 0.42, 0.006, SEG, 1, false, -Math.PI / 2, Math.PI]} />
          {paint('pot')}
        </mesh>
        <mesh position={[0, tall / 2 - 0.025, 0]}>
          <cylinderGeometry args={[width * 0.49, width * 0.49, 0.01, SEG, 1, false, -Math.PI / 2, Math.PI]} />
          {paint('soil')}
        </mesh>
      </group>
      {/* The flat back plate it hangs by. */}
      <mesh position={[0, 0, 0.002]}>
        <boxGeometry args={[width, tall, 0.004]} />
        {paint('pot')}
      </mesh>
      <Wilt at={top - 0.025} wilt={wilt}>
        <Growth grown={grown} paint={paint} flat={kind === 'pearls' ? ['stems', 'leaves'] : ['stems']} />
      </Wilt>
    </group>
  )
}
