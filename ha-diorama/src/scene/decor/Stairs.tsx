import { Slab } from '#/scene/decor/parts.tsx'
import { useMemo, type ReactNode } from 'react'
import { ExtrudeGeometry, Shape } from 'three'

type Paint = (slot: string, both?: boolean) => ReactNode

type Props = {
  style: string
  // The flight's width, how far it runs across the floor, how far it climbs
  // and, for a quarter turn, how far its second flight runs out to the side.
  w: number
  l: number
  h: number
  reach: number
  // Turns left, or has its rail on the left.
  flip: boolean
  paint: Paint
}

// Stairs that climb a whole storey, from the floor at the front, toward +z,
// up to the next floor at the back. They are laid out again at whatever
// size the sliders give them: the risers share out the rise as close to
// 18 cm each as a whole number of them comes, and the treads share out the
// run between them.

// The rise a riser aims at, the most comfortable one in most building
// codes, and how far a tread's nosing reaches over the one below it.
const RISE = 0.18
const NOSING = 0.025
// A handrail's height over the nosings, and its round bar.
const RAIL_H = 0.9
const RAIL_R = 0.022

type YZ = [number, number]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// A flat shape in the stair's side view, `y` up and `z` toward the front,
// given as points round it, extruded `t` thick across x from `x`. The
// strings of a flight and the walls beside it.
function Side({ points, x, t, children }: { points: YZ[]; x: number; t: number; children: ReactNode }) {
  const key = points.flat().join(',')
  const geometry = useMemo(() => {
    const at = key.split(',').map(Number)
    const shape = new Shape()
    // Drawn on a plane with -z along its x, so that turned a quarter round
    // y the shape stands in the side view the right way round.
    for (let i = 0; i < at.length; i += 2) {
      if (i === 0) shape.moveTo(-at[i + 1], at[i])
      else shape.lineTo(-at[i + 1], at[i])
    }
    shape.closePath()
    const geo = new ExtrudeGeometry(shape, { depth: t, bevelEnabled: false })
    geo.rotateY(Math.PI / 2)
    return geo
  }, [key, t])
  return (
    <mesh geometry={geometry} position={[x, 0, 0]} castShadow receiveShadow>
      {children}
    </mesh>
  )
}

// A round bar from one point to another in the side view, at `x`.
function Rail({ from, to, x, r, children }: { from: YZ; to: YZ; x: number; r: number; children: ReactNode }) {
  const dy = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dy, dz)
  return (
    <mesh position={[x, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2]} rotation={[Math.atan2(dz, dy), 0, 0]} castShadow>
      <capsuleGeometry args={[r, Math.max(length - r * 2, 0.001), 6, 16]} />
      {children}
    </mesh>
  )
}

// A post standing straight up from `y` to `top`, at `x`, `z`.
function Post({
  x,
  z,
  y,
  top,
  r,
  children,
}: {
  x: number
  z: number
  y: number
  top: number
  r: number
  children: ReactNode
}) {
  return (
    <mesh position={[x, (y + top) / 2, z]} castShadow>
      <cylinderGeometry args={[r, r, Math.max(top - y, 0.001), 12]} />
      {children}
    </mesh>
  )
}

// How many risers climb `h`, and how high each one is.
function risers(h: number, least: number) {
  const count = Math.max(least, Math.round(h / RISE))
  return { count, rise: h / count }
}

// A straight flight, `w` wide and `l` long. Its treads lie between two
// strings, open between them on the open riser style, or closed by risers
// and boarded underneath, with a white wall up its open side for a
// balustrade.
function Straight({ style, w, l, h, flip, paint }: Omit<Props, 'reach'>) {
  const { count, rise } = risers(h, 2)
  const treads = count - 1
  const going = l / treads
  const front = l / 2
  // Where the nosing of each tread is, and the line through them all that
  // climbs from the floor at the front to the next floor at the back.
  const nosing = (i: number): YZ => [(i + 1) * rise, front - i * going]
  const pitch = (z: number) => rise + ((front - z) * rise) / going
  // The rail runs on the right, or on the left with its switch.
  const side = flip ? -1 : 1
  const open = style === 'open'
  const string = open ? 0.015 : 0.03
  const tread = open ? 0.04 : 0.028
  const inner = w - string * 2
  // The strings run along the pitch, a hand above the nosings and a deep
  // board below them, cut level at the floor and at the floor above.
  const below = open ? 0.24 : 0.2
  const band = (above: number, under: number, thick = 0): YZ[] => {
    // Where the top edge reaches the floor above, if it does before the
    // back, and where the underside meets the floor below.
    const level = Math.max(-front + (above * going) / rise, -front)
    const foot = Math.min(front - ((under - rise) * going) / rise, front - 0.01)
    const bottom = (z: number) => pitch(z) - under
    if (thick > 0) {
      // A thin board along the underside, from the floor to the back.
      return [
        [0, foot],
        [0.0001, front - ((under - thick - rise) * going) / rise],
        [h - under + thick, -front],
        [bottom(-front), -front],
      ]
    }
    return [
      [0, front],
      [pitch(front) + above, front],
      [Math.min(h, pitch(level) + above), level],
      [Math.min(h, pitch(-front) + above), -front],
      [bottom(-front), -front],
      [0, foot],
    ]
  }
  const sides = [-1, 1].map(s => (s * (w - string)) / 2 - string / 2)
  return (
    <group>
      {Array.from({ length: treads }, (_, i) => {
        const [y, z] = nosing(i)
        const deep = going + (open ? NOSING * 1.2 : NOSING)
        return (
          <group key={i}>
            <Slab
              size={[inner, tread, deep]}
              radius={0.006}
              bevel={0.004}
              position={[0, y - tread, z - deep / 2 + (open ? 0 : NOSING)]}
            >
              {paint('treads')}
            </Slab>
            {!open && (
              <Slab size={[inner, rise - tread, 0.02]} radius={0.002} bevel={0.002} position={[0, y - rise, z - 0.01]}>
                {paint('risers')}
              </Slab>
            )}
          </group>
        )
      })}
      {/* The last riser, up to the floor above at the back. */}
      {!open && (
        <Slab size={[inner, rise, 0.02]} radius={0.002} bevel={0.002} position={[0, h - rise, -front + 0.01]}>
          {paint('risers')}
        </Slab>
      )}
      {sides.map((x, i) => (
        <Side key={i} points={band(0.05, below)} x={x} t={string}>
          {paint(open ? 'strings' : 'sides')}
        </Side>
      ))}
      {open ? (
        <OpenRail side={side} w={w} h={h} front={front} treads={treads} nosing={nosing} pitch={pitch} paint={paint} />
      ) : (
        <>
          {/* The underside is boarded over between the strings. */}
          <Side points={band(0, below, 0.02)} x={-inner / 2} t={inner}>
            {paint('sides')}
          </Side>
          {/* The open side carries on up as a white wall as high as a
              handrail, a balustrade capped with an oak rail. */}
          <Side points={band(RAIL_H - 0.03, below)} x={side > 0 ? w / 2 : -w / 2 - 0.06} t={0.06}>
            {paint('sides')}
          </Side>
          <Rail
            from={[pitch(front) + RAIL_H - 0.01, front]}
            to={[h + RAIL_H - 0.01, -front]}
            x={side > 0 ? w / 2 + 0.03 : -w / 2 - 0.03}
            r={0.035}
          >
            {paint('rail')}
          </Rail>
        </>
      )}
    </group>
  )
}

// A black steel balustrade on the open riser flight: a post at each end,
// a slim bar up from every tread and the round handrail over them.
function OpenRail({
  side,
  w,
  h,
  front,
  treads,
  nosing,
  pitch,
  paint,
}: {
  side: number
  w: number
  h: number
  front: number
  treads: number
  nosing: (i: number) => YZ
  pitch: (z: number) => number
  paint: Paint
}) {
  const x = side * (w / 2 - 0.035)
  const start: YZ = [pitch(front) + RAIL_H, front - 0.04]
  const end: YZ = [Math.min(pitch(-front), h) + RAIL_H, -front + 0.04]
  const metal = paint('rail')
  return (
    <group>
      <Post x={x} z={start[1]} y={0} top={start[0]} r={0.022}>
        {metal}
      </Post>
      <Post x={x} z={end[1]} y={h} top={end[0]} r={0.022}>
        {metal}
      </Post>
      {Array.from({ length: treads }, (_, i) => {
        const [y, z] = nosing(i)
        const at = z - (front - nosing(1)[1]) / 2
        return (
          <Post key={i} x={x} z={at} y={y} top={pitch(at) + RAIL_H} r={0.007}>
            {metal}
          </Post>
        )
      })}
      <Rail from={start} to={end} x={x} r={RAIL_R}>
        {metal}
      </Rail>
    </group>
  )
}

// A quarter turn: a first flight up from the front, a square landing in
// the back corner and a second flight across the back to the side. Each
// step is a solid white block with an oak tread on it, the way a stair
// built into a hall is closed underneath, and a black steel rail runs up
// the open inside of the turn.
function Quarter({ w, l, h, reach, flip, paint }: Omit<Props, 'style'>) {
  const { count, rise } = risers(h, 4)
  // One step is the landing, and the last riser climbs onto the floor above.
  const steps = count - 2
  const first = Math.max(l - w, 0.2)
  const going = (first + reach) / steps
  const n1 = Math.min(Math.max(Math.round(first / going), 1), steps - 1)
  const n2 = steps - n1
  const g1 = first / n1
  const g2 = reach / n2
  // 1 turns right, out toward +x, and -1 left.
  const s = flip ? -1 : 1
  const X = w + reach
  const left = -X / 2
  const back = -l / 2
  const cap = 0.03
  // Every step as a rectangle on the plan, in the unturned layout, with the
  // edge its nosing is on: x0 to x1, z0 to z1, and its height.
  type Step = { x0: number; x1: number; z0: number; z1: number; y: number; nose: 'z' | 'x' | null }
  const all: Step[] = []
  for (let i = 0; i < n1; i++) {
    const z1 = l / 2 - i * g1
    all.push({ x0: left, x1: left + w, z0: z1 - g1, z1, y: (i + 1) * rise, nose: 'z' })
  }
  all.push({ x0: left, x1: left + w, z0: back, z1: back + w, y: (n1 + 1) * rise, nose: null })
  for (let i = 0; i < n2; i++) {
    const x0 = left + w + i * g2
    all.push({ x0, x1: x0 + g2, z0: back, z1: back + w, y: (n1 + 2 + i) * rise, nose: 'x' })
  }
  const mid = (a: number, b: number) => (a + b) / 2
  // The inside of the turn: up the first flight's right hand edge and along
  // the front of the second.
  const innerX = left + w - 0.035
  const innerZ = back + w - 0.035
  const metal = paint('rail')
  const railY = (y: number) => y + RAIL_H
  const corner: [number, number, number] = [innerX, railY((n1 + 1) * rise), innerZ]
  const bottom: [number, number, number] = [innerX, railY(rise), l / 2 - 0.04]
  const topEnd: [number, number, number] = [X / 2 - 0.04, railY(h), innerZ]
  return (
    <group scale={[s, 1, 1]}>
      {all.map((step, i) => {
        const sw = step.x1 - step.x0
        const sd = step.z1 - step.z0
        // The tread reaches a nosing's width over the step below.
        const over = step.nose === 'z' ? NOSING : 0
        const overX = step.nose === 'x' ? NOSING : 0
        return (
          <group key={i}>
            <Slab
              size={[sw, step.y - cap, sd]}
              radius={0.004}
              bevel={0.003}
              position={[mid(step.x0, step.x1), 0, mid(step.z0, step.z1)]}
            >
              {paint('risers')}
            </Slab>
            <Slab
              size={[sw + overX, cap, sd + over]}
              radius={0.006}
              bevel={0.004}
              position={[mid(step.x0, step.x1) - overX / 2, step.y - cap, mid(step.z0, step.z1) + over / 2]}
            >
              {paint('treads')}
            </Slab>
          </group>
        )
      })}
      {/* The rail: a post at the foot, one at the corner of the landing and
          one at the top, a slim bar on every step between them. */}
      <Post x={bottom[0]} z={bottom[2]} y={0} top={bottom[1]} r={0.022}>
        {metal}
      </Post>
      <Post x={corner[0]} z={corner[2]} y={(n1 + 1) * rise} top={corner[1] + 0.05} r={0.024}>
        {metal}
      </Post>
      <Post x={topEnd[0]} z={topEnd[2]} y={h} top={topEnd[1]} r={0.022}>
        {metal}
      </Post>
      {all.map((step, i) => {
        if (step.nose === null) return null
        const x = step.nose === 'z' ? innerX : mid(step.x0, step.x1)
        const z = step.nose === 'z' ? mid(step.z0, step.z1) : innerZ
        // Up to the rail over it, which runs straight from post to post.
        const top =
          step.nose === 'z'
            ? lerp(bottom[1], corner[1], (bottom[2] - z) / (bottom[2] - corner[2]))
            : lerp(corner[1], topEnd[1], (x - corner[0]) / (topEnd[0] - corner[0]))
        return (
          <Post key={i} x={x} z={z} y={step.y} top={top} r={0.007}>
            {metal}
          </Post>
        )
      })}
      <mesh
        position={[innerX, (bottom[1] + corner[1]) / 2, (bottom[2] + corner[2]) / 2]}
        rotation={[Math.atan2(corner[2] - bottom[2], corner[1] - bottom[1]), 0, 0]}
        castShadow
      >
        <capsuleGeometry args={[RAIL_R, Math.hypot(corner[1] - bottom[1], corner[2] - bottom[2]), 6, 16]} />
        {metal}
      </mesh>
      <mesh
        position={[(corner[0] + topEnd[0]) / 2, (corner[1] + topEnd[1]) / 2, innerZ]}
        rotation={[0, 0, -Math.atan2(topEnd[0] - corner[0], topEnd[1] - corner[1])]}
        castShadow
      >
        <capsuleGeometry args={[RAIL_R, Math.hypot(topEnd[0] - corner[0], topEnd[1] - corner[1]), 6, 16]} />
        {metal}
      </mesh>
    </group>
  )
}

export default function Stairs(props: Props) {
  if (props.style === 'quarter') return <Quarter {...props} />
  return <Straight {...props} />
}
