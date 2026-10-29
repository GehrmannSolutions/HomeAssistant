import {
  OFFICE_CHAIRS,
  RACER,
  RACER_STAR,
  SLING_HALF,
  SLING_PATH,
  SLING_STAR,
  TECK_ARM,
  TECK_BACK,
  TECK_SEAT,
  TECK_STAR,
  type Star,
} from '#/scene/decor/officeChairSpecs.ts'
import { Cushion, Slab } from '#/scene/decor/parts.tsx'
import { bendAround, plate, taperedOutline } from '#/scene/decor/plates.ts'
import type { Vec3 } from '#/scene/decor/points.ts'
import { Dowel } from '#/scene/decor/woodwork.tsx'
import { useMemo, type ReactNode } from 'react'
import { BoxGeometry, CatmullRomCurve3, Shape, SplineCurve, TubeGeometry, Vector2, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type Props = {
  style: string
  w: number
  d: number
  // The seat's height.
  h: number
  // The material of a named part.
  M: (slot: string) => ReactNode
}

// How far the seat rides above or below its height in the photos, and how
// much wider and deeper than in them the chair is.
type Part = { lift: number; kx: number; kz: number; M: Props['M'] }

// A twin wheeled castor standing at the origin, rolling along z.
function Castor({ wheel, M }: { wheel: number; M: Props['M'] }) {
  return (
    <group>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * wheel * 0.45, wheel, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[wheel, wheel, wheel * 0.42, 32]} />
          {M('castors')}
        </mesh>
      ))}
      <mesh position={[0, wheel * 1.5, -wheel * 0.3]}>
        <boxGeometry args={[wheel * 0.5, wheel * 1.3, wheel * 1.4]} />
        {M('castors')}
      </mesh>
    </group>
  )
}

// Five legs out from the column, one pointing forward, each on a castor.
// Round legs slope from the hub to their tips, and flat blades do on the
// Teck.
function FiveStar({ star, blades = false, M }: { star: Star; blades?: boolean; M: Props['M'] }) {
  const { reach, wheel, hub, tip } = star
  return (
    <group>
      {Array.from({ length: 5 }).map((_, i) => (
        <group key={i} rotation={[0, (-i * Math.PI * 2) / 5, 0]}>
          {blades ? (
            <mesh
              position={[0, (hub + tip) / 2 - 0.014, reach / 2 + 0.01]}
              rotation={[Math.atan2(hub - tip, reach), 0, 0]}
              castShadow
            >
              <boxGeometry args={[0.05, 0.028, reach + 0.02]} />
              {M('base')}
            </mesh>
          ) : (
            <Dowel from={[0, hub, 0.02]} to={[0, tip, reach]} r={[0.013, 0.01]}>
              {M('base')}
            </Dowel>
          )}
          <Dowel from={[0, tip, reach]} to={[0, wheel * 2, reach]} r={[0.008, 0.008]}>
            {M('castors')}
          </Dowel>
          <group position={[0, 0, reach]}>
            <Castor wheel={wheel} M={M} />
          </group>
        </group>
      ))}
    </group>
  )
}

// A bent tube through a list of points.
function Tube({ points, r, children }: { points: Vec3[]; r: number; children: ReactNode }) {
  const geometry = useMemo(
    () => new TubeGeometry(new CatmullRomCurve3(points.map(p => new Vector3(...p))), 96, r, 16, false),
    [points, r],
  )
  return (
    <mesh geometry={geometry} castShadow>
      {children}
    </mesh>
  )
}

// The loop the arms stand on, round behind the seat, and the arch rising
// from it to hold the back.
const TECK_LOOP: Vec3[] = [
  [-0.265, 0.44, 0.02],
  [-0.262, 0.415, -0.1],
  [-0.21, 0.4, -0.2],
  [-0.1, 0.395, -0.245],
  [0, 0.395, -0.25],
  [0.1, 0.395, -0.245],
  [0.21, 0.4, -0.2],
  [0.262, 0.415, -0.1],
  [0.265, 0.44, 0.02],
]
const TECK_ARCH: Vec3[] = [
  [-0.1, 0.395, -0.245],
  [-0.1, 0.55, -0.262],
  [-0.09, 0.69, -0.282],
  [0, 0.7, -0.284],
  [0.09, 0.69, -0.282],
  [0.1, 0.55, -0.262],
  [0.1, 0.395, -0.245],
]

function Teck({ lift, kx, kz, M }: Part) {
  const { height, seat } = OFFICE_CHAIRS.teck
  const [sw, st, sd] = [TECK_SEAT[0] * kx, TECK_SEAT[1], TECK_SEAT[2] * kz]
  const { lean, thick, bar } = TECK_BACK
  const [foot, head, y, z] = [TECK_BACK.foot * kx, TECK_BACK.head * kx, TECK_BACK.y, TECK_BACK.z * kz]
  // The base is round, so it grows with the chair's mean size.
  const star = { ...TECK_STAR, reach: (TECK_STAR.reach * (kx + kz)) / 2 }
  const { loop, arch } = useMemo(() => {
    const across = (points: Vec3[]) => points.map(([x, py, pz]): Vec3 => [x * kx, py, pz * kz])
    return { loop: across(TECK_LOOP), arch: across(TECK_ARCH) }
  }, [kx, kz])
  const armX = TECK_ARM.x * kx
  const under = seat - st
  const mech = 0.06
  const column = under - mech + lift
  const backH = (height - y) / Math.cos(lean)
  const bend = 0.9
  const { frame, mesh, lumbar } = useMemo(() => {
    const outline = (i: number) => {
      const s = taperedOutline(foot, head, backH, 0.05, 0.04, i)
      s.holes.push(taperedOutline(foot, head, backH, 0.05, 0.04, bar - i))
      return s
    }
    // The mesh, strands of black cord across the frame.
    const strands = []
    for (let s = bar + 0.004; s < backH - bar; s += 0.008) {
      const half = (foot + ((head - foot) * s) / backH) / 2 - bar + 0.003
      const g = new BoxGeometry(half * 2, 0.0035, 0.002, Math.ceil((half * 2) / 0.01), 1, 1)
      g.translate(0, s, thick / 2)
      strands.push(g)
    }
    return {
      frame: plate(outline, thick, bend),
      mesh: bendAround(mergeGeometries(strands), bend),
      lumbar: plate(i => taperedOutline(0.32, 0.3, 0.07, 0.02, 0.02, i), 0.01, bend),
    }
  }, [foot, head, backH, bar, thick])
  return (
    <group>
      <FiveStar star={star} blades M={M} />
      <mesh position={[0, TECK_STAR.hub - 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.06, 48]} />
        {M('base')}
      </mesh>
      <Dowel from={[0, TECK_STAR.hub, 0]} to={[0, Math.min(0.25, column - 0.02), 0]} r={[0.03, 0.03]}>
        {M('base')}
      </Dowel>
      <Dowel from={[0, TECK_STAR.hub, 0]} to={[0, column, 0]} r={[0.02, 0.02]}>
        {M('base')}
      </Dowel>
      <group position={[0, lift, 0]}>
        <Slab size={[0.22, mech, 0.28]} radius={0.03} bevel={0.01} position={[0, under - mech, -0.01]}>
          {M('frame')}
        </Slab>
        {[-1, 1].map(sx => (
          <group key={sx}>
            <Dowel from={[sx * 0.1, under - 0.03, 0.06]} to={[sx * 0.22 * kx, under - 0.03, 0.06]} r={[0.007, 0.007]}>
              {M('frame')}
            </Dowel>
            <mesh position={[sx * 0.235 * kx, under - 0.03, 0.06]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.014, 0.014, 0.04, 32]} />
              {M('frame')}
            </mesh>
            <mesh position={[sx * armX, (TECK_ARM.y + 0.43) / 2, 0.01]} castShadow>
              <boxGeometry args={[0.03, TECK_ARM.y - 0.43, 0.05]} />
              {M('frame')}
            </mesh>
            <Slab size={TECK_ARM.pad} radius={0.035} bevel={0.008} position={[sx * armX, TECK_ARM.y, 0.01]}>
              {M('frame')}
            </Slab>
          </group>
        ))}
        <Cushion size={[sw, st, sd]} position={[0, under, 0.02]}>
          {M('seat')}
        </Cushion>
        <Tube points={loop} r={0.011}>
          {M('base')}
        </Tube>
        <Tube points={arch} r={0.01}>
          {M('base')}
        </Tube>
        <group position={[0, y, z]} rotation={[-lean, 0, 0]}>
          <mesh geometry={frame} castShadow>
            {M('frame')}
          </mesh>
          <mesh geometry={mesh} castShadow>
            {M('back')}
          </mesh>
          <mesh geometry={lumbar} position={[0, 0.12, thick / 2 - 0.012]}>
            {M('frame')}
          </mesh>
        </group>
      </group>
    </group>
  )
}

// The column up from the hub of the base to the seat: a wide gas spring
// sleeve and the narrower rod out of it.
function Column({ star, top, M }: { star: Star; top: number; M: Props['M'] }) {
  return (
    <>
      <mesh position={[0, star.hub - 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.045, 0.05, 48]} />
        {M('base')}
      </mesh>
      <Dowel from={[0, star.hub, 0]} to={[0, Math.min(0.25, top - 0.02), 0]} r={[0.026, 0.026]}>
        {M('base')}
      </Dowel>
      <Dowel from={[0, star.hub, 0]} to={[0, top, 0]} r={[0.017, 0.017]}>
        {M('base')}
      </Dowel>
    </>
  )
}

// A side profile as a curve, stretched in depth by `kz`.
function profile(path: [number, number][], kz: number) {
  return new CatmullRomCurve3(path.map(([y, z]) => new Vector3(0, y, z * kz)))
}

function Sling({ lift, kx, kz, M }: Part) {
  const half = SLING_HALF * kx
  const star = { ...SLING_STAR, reach: (SLING_STAR.reach * (kx + kz)) / 2 }
  const { rail, pads, arm } = useMemo(() => {
    const curve = profile(SLING_PATH, kz)
    const length = curve.getLength()
    // The ribbed pads, one every few centimeters along the sling, each laid
    // along the curve with its thickness on the sitting side.
    const pitch = 0.058
    const count = Math.floor(length / pitch)
    const pads = Array.from({ length: count }, (_, i) => {
      const u = (i + 0.5) / count
      const at = curve.getPointAt(u)
      const t = curve.getTangentAt(u)
      return { at: at.toArray() as Vec3, angle: Math.atan2(t.z, t.y), len: (length / count) * 0.96 }
    })
    const rail = curve.getSpacedPoints(40).map(p => [0, p.y - 0.012, p.z] as Vec3)
    const arm: Vec3[] = [
      [0, 0.47, -0.2 * kz],
      [0, 0.6, -0.175 * kz],
      [0, 0.655, -0.1 * kz],
      [0, 0.66, 0.02 * kz],
      [0, 0.655, 0.15 * kz],
    ]
    return { rail, pads, arm }
  }, [kz])
  const under = SLING_PATH[2][0] - 0.03
  return (
    <group>
      <FiveStar star={star} M={M} />
      <Column star={SLING_STAR} top={under - 0.05 + lift} M={M} />
      <group position={[0, lift, 0]}>
        {/* The spider under the seat, out from the column to the rails. */}
        <Slab size={[0.16, 0.05, 0.2]} radius={0.03} bevel={0.01} position={[0, under - 0.06, -0.03 * kz]}>
          {M('base')}
        </Slab>
        {[-1, 1].flatMap(sx =>
          [0.08, -0.12].map(z => (
            <Dowel
              key={`${sx}:${z}`}
              from={[0, under - 0.035, z * kz]}
              to={[sx * half, under + 0.005, z * kz]}
              r={[0.012, 0.009]}
            >
              {M('base')}
            </Dowel>
          )),
        )}
        {[-1, 1].map(sx => (
          <group key={sx}>
            <group position={[sx * half, 0, 0]}>
              <Tube points={rail} r={0.013}>
                {M('frame')}
              </Tube>
            </group>
            <group position={[sx * (half + 0.03), 0, 0]}>
              <Tube points={arm} r={0.011}>
                {M('frame')}
              </Tube>
            </group>
            <Slab
              size={[0.05, 0.02, 0.2 * kz]}
              radius={0.02}
              bevel={0.006}
              position={[sx * (half + 0.03), 0.66, 0.05 * kz]}
            >
              {M('seat')}
            </Slab>
          </group>
        ))}
        {pads.map(({ at, angle, len }, i) => (
          <group key={i} position={at} rotation={[angle, 0, 0]}>
            <Slab size={[half * 2 - 0.01, len, 0.024]} radius={0.01} bevel={0.01} position={[0, -len / 2, 0.012]}>
              {M('seat')}
            </Slab>
          </group>
        ))}
      </group>
    </group>
  )
}

// Racer: a gaming chair after the Secretlab TITAN Evo. A flat seat with a
// waterfall front edge and low sloping wings, a back widest at the
// shoulders, pinched at the waist and running up into a narrower head
// section with a flat top, padded bolsters down both sides of the back with
// piping in the accent color, the lumbar support built in with its knob on
// the side, and a magnetic pillow at the head. Four way arms stand on L
// brackets from under the seat, and the chair sits on a ribbed gas lift and
// a flat topped five star base.
const RACER_SIDE: [number, number][] = [
  [0.245, 0],
  [0.236, 0.12],
  [0.225, 0.28],
  [0.248, 0.45],
  [0.265, 0.55],
  [0.255, 0.61],
  [0.2, 0.648],
  [0.165, 0.675],
  [0.16, 0.78],
  [0.148, 0.835],
  [0.12, 0.85],
]
const RACER_BOLSTER: [number, number][] = [
  [0.198, 0.05],
  [0.19, 0.15],
  [0.18, 0.28],
  [0.2, 0.44],
  [0.214, 0.54],
  [0.19, 0.6],
]
const RACER_BEND = 0.6
const RACER_SHELL = 0.05

// The back's outline, rising from the middle of its foot, shrunk by `inset`.
function racerOutline(kx: number, inset: number) {
  const side = new SplineCurve(RACER_SIDE.map(([x, y]) => new Vector2(x * kx - inset, Math.max(inset, y - inset))))
  const right = side.getPoints(80)
  const top = right[right.length - 1].y
  const s = new Shape()
  s.moveTo(-right[0].x, inset)
  for (const p of right) s.lineTo(p.x, p.y)
  s.lineTo(0, top)
  for (const p of [...right].reverse()) s.lineTo(-p.x, p.y)
  return s
}

// Where a point laid out flat on the back ends up once it is bent round.
function bent(x: number, y: number, z: number): Vec3 {
  const t = x / RACER_BEND
  const r = RACER_BEND - z
  return [r * Math.sin(t), y, RACER_BEND - r * Math.cos(t)]
}

function Racer({ lift, kx, kz, M }: Part) {
  const star = { ...RACER_STAR, reach: (RACER_STAR.reach * (kx + kz)) / 2 }
  const { seat, lean } = RACER
  const [sw, sd] = [0.47 * kx, 0.46 * kz]
  const back = -0.24 * kz
  const shell = RACER_SHELL
  const { plateGeo, panel, bolsters, piping } = useMemo(() => {
    const along = (side: number, inward: number, z: number) =>
      RACER_BOLSTER.map(([x, y]) => bent(side * (x * kx - inward), y, z))
    return {
      plateGeo: plate(i => racerOutline(kx, i), shell, RACER_BEND, 0.012),
      panel: plate(i => taperedOutline(0.3 * kx, 0.3 * kx, 0.56, 0.03, 0.06, i), 0.022, RACER_BEND, 0.008),
      bolsters: [-1, 1].map(side => along(side, 0, shell - 0.004)),
      piping: [-1, 1].map(side => along(side, 0.036, shell + 0.018)),
    }
  }, [kx, shell])
  const hub = RACER_STAR.hub
  const column = seat - 0.19 + lift
  const knob = bent(0.232 * kx, 0.17, shell / 2)
  return (
    <group>
      <FiveStar star={star} blades M={M} />
      {/* The gas lift, a ribbed cover telescoping over the spring. */}
      <mesh position={[0, hub - 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.045, 0.05, 48]} />
        {M('base')}
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[0, hub + 0.012 + i * 0.026, 0]} castShadow>
          <cylinderGeometry args={[0.035 - i * 0.0012, 0.036 - i * 0.0012, 0.022, 40]} />
          {M('base')}
        </mesh>
      ))}
      <Dowel from={[0, hub, 0]} to={[0, column, 0]} r={[0.015, 0.015]}>
        {M('base')}
      </Dowel>
      <group position={[0, lift, 0]}>
        {/* The tilt mechanism, and its recline lever out on the right. */}
        <Slab size={[0.25, 0.06, 0.2]} radius={0.015} position={[0, seat - 0.19, -0.03]}>
          {M('base')}
        </Slab>
        <Dowel from={[0.1, seat - 0.16, -0.08]} to={[0.24 * kx, seat - 0.15, -0.11]} r={[0.006, 0.006]}>
          {M('base')}
        </Dowel>
        <Slab size={[0.05, 0.022, 0.03]} radius={0.01} position={[0.25 * kx, seat - 0.161, -0.112]}>
          {M('base')}
        </Slab>
        {/* The seat: a molded pan, the flat cushion rolling over its front
            edge, and a low wing sloping up on each side. */}
        <Slab size={[sw + 0.06, 0.05, sd - 0.02]} radius={0.04} bevel={0.01} position={[0, seat - 0.12, -0.005]}>
          {M('base')}
        </Slab>
        <Slab size={[sw, 0.06, sd - 0.03]} radius={0.03} bevel={0.02} position={[0, seat - 0.06, -0.005]}>
          {M('seat')}
        </Slab>
        <mesh position={[0, seat - 0.04, sd / 2 - 0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <capsuleGeometry args={[0.04, sw - 0.08, 8, 24]} />
          {M('seat')}
        </mesh>
        {[-1, 1].map(s => (
          <group key={s}>
            <Cushion
              size={[0.065, 0.1, sd]}
              position={[s * (sw / 2 + 0.02), seat - 0.075, 0.005]}
              rotation={[0, 0, -s * 0.22]}
            >
              {M('seat')}
            </Cushion>
            <Slab
              size={[0.006, 0.008, sd - 0.04]}
              radius={0.003}
              position={[s * (sw / 2 - 0.004), seat - 0.004, 0.005]}
            >
              {M('accent')}
            </Slab>
            {/* The back's bracket, from the tilt plate up behind the seat. */}
            <Slab size={[0.04, 0.2, 0.06]} radius={0.015} position={[s * (sw / 2 - 0.02), seat - 0.15, back + 0.02]}>
              {M('base')}
            </Slab>
            {/* An arm: an L bracket out from under the seat, a rectangular
                post up the side and a flat pad on top. */}
            <Slab size={[0.2 * kx, 0.025, 0.06]} radius={0.008} position={[s * 0.21 * kx, seat - 0.17, -0.05]}>
              {M('base')}
            </Slab>
            <Slab size={[0.05, 0.4, 0.04]} radius={0.012} position={[s * 0.31 * kx, seat - 0.17, -0.05]}>
              {M('base')}
            </Slab>
            <Slab size={[0.1, 0.03, 0.27]} radius={0.04} bevel={0.01} position={[s * 0.31 * kx, seat + 0.23, -0.02]}>
              {M('base')}
            </Slab>
          </group>
        ))}
        <group position={[0, seat - 0.04, back - shell]} rotation={[-lean, 0, 0]}>
          <mesh geometry={plateGeo} castShadow>
            {M('seat')}
          </mesh>
          <mesh geometry={panel} position={[0, 0.03, shell - 0.006]} castShadow>
            {M('seat')}
          </mesh>
          {bolsters.map((points, i) => (
            <Tube key={i} points={points} r={0.04}>
              {M('seat')}
            </Tube>
          ))}
          {piping.map((points, i) => (
            <Tube key={i} points={points} r={0.005}>
              {M('accent')}
            </Tube>
          ))}
          {/* The lumbar knob, on the right side of the back. */}
          <mesh position={knob} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, 0.03, 32]} />
            {M('base')}
          </mesh>
          <Cushion size={[0.28 * kx, 0.16, 0.08]} position={[0, 0.61, shell + 0.01]}>
            {M('pillows')}
          </Cushion>
        </group>
      </group>
    </group>
  )
}

// Each chair is laid out again at the width and depth the sliders give it,
// every part keeping its thickness, and its seat raised or lowered on the
// column.
export default function OfficeChair({ style, w, d, h, M }: Props) {
  const spec = OFFICE_CHAIRS[style] ?? OFFICE_CHAIRS.teck
  const part = { lift: h - spec.seat, kx: w / spec.width, kz: d / spec.depth, M }
  if (style === 'sling') return <Sling {...part} />
  if (style === 'racer') return <Racer {...part} />
  return <Teck {...part} />
}
