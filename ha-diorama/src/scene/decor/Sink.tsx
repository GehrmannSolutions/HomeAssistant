import type { Fit } from '#/scene/decor/Kitchen.tsx'
import { Fill, Hollow, SEG, Slab, Stream, Tube } from '#/scene/decor/parts.tsx'
import { sinkPlan, type SinkStyle } from '#/scene/decor/sinkSpecs.ts'

// A kitchen sink in one of three styles, with the tap that goes with it. Its
// origin is the top of the worktop it is let into, and a counter it stands
// on cuts the holes it needs (see sinkSpecs.ts).

// The waste in a bowl's floor: a steel ring round a dark plug hole.
function Waste({ x, y, z, fit }: { x: number; y: number; z: number; fit: Fit }) {
  return (
    <group position={[x, y + 0.001, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <circleGeometry args={[0.045, SEG]} />
        {fit.M('tap')}
      </mesh>
      <mesh position={[0, 0, 0.0005]}>
        <circleGeometry args={[0.018, SEG]} />
        <meshStandardMaterial color="#1c1f21" roughness={0.6} />
      </mesh>
    </group>
  )
}

// The lever of a single lever mixer, on the column's right: a round
// cartridge hub let into its side and a slim flat lever rising from it,
// leaning a little away from the column, the way the Grohe Minta's does.
function SideLever({ y, r, fit }: { y: number; r: number; fit: Fit }) {
  const metal = fit.M('tap')
  return (
    <group position={[r, y, 0]}>
      <mesh position={[0.008, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.017, 0.017, 0.022, SEG]} />
        {metal}
      </mesh>
      <group position={[0.019, 0, 0]} rotation={[0, 0, -0.22]}>
        <Slab size={[0.009, 0.075, 0.014]} radius={0.004} bevel={0.002} position={[0, 0, 0]}>
          {metal}
        </Slab>
      </group>
    </group>
  )
}

// A single lever mixer after the Grohe Essence: a slim column turning over
// in a tight U, 30 cm tall and reaching 22 cm, a lever on its side.
function LeverTap({ fit }: { fit: Fit }) {
  const metal = fit.M('tap')
  return (
    <group>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.026, 0.026, 0.02, SEG]} />
        {metal}
      </mesh>
      <Tube
        radius={0.016}
        points={[
          [0, 0.01, 0],
          [0, 0.2, 0],
          [0, 0.27, 0.012],
          [0, 0.3, 0.1],
          [0, 0.27, 0.19],
          [0, 0.22, 0.205],
        ]}
      >
        {metal}
      </Tube>
      <SideLever y={0.1} r={0.014} fit={fit} />
    </group>
  )
}

// A bridge mixer after the Perrin & Rowe Ionian: two valves with cross
// handles joined by a bar, and a swan neck spout rising from its middle.
export function BridgeTap({ fit }: { fit: Fit }) {
  const metal = fit.M('tap')
  return (
    <group>
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.1, 0, 0]}>
          <mesh position={[0, 0.075, 0]}>
            <cylinderGeometry args={[0.016, 0.022, 0.15, SEG]} />
            {metal}
          </mesh>
          {/* The cross handle on top. */}
          <group position={[0, 0.165, 0]}>
            <mesh>
              <cylinderGeometry args={[0.012, 0.016, 0.03, 16]} />
              {metal}
            </mesh>
            {[0, Math.PI / 2].map(a => (
              <mesh key={a} position={[0, 0.012, 0]} rotation={[0, a, Math.PI / 2]}>
                <cylinderGeometry args={[0.006, 0.006, 0.09, 12]} />
                {metal}
              </mesh>
            ))}
          </group>
        </group>
      ))}
      <mesh position={[0, 0.09, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.013, 0.013, 0.2, 20]} />
        {metal}
      </mesh>
      <Tube
        radius={0.012}
        points={[
          [0, 0.09, 0],
          [0, 0.3, 0],
          [0, 0.4, 0.06],
          [0, 0.36, 0.17],
          [0, 0.28, 0.21],
        ]}
      >
        {metal}
      </Tube>
    </group>
  )
}

// A pull out tap after the Blanco Linus-S: a column curving over to a spray
// head that points down, 33 cm tall, and a lever on its side.
function PullOutTap({ fit }: { fit: Fit }) {
  const metal = fit.M('tap')
  return (
    <group>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.02, SEG]} />
        {metal}
      </mesh>
      <Tube
        radius={0.017}
        points={[
          [0, 0.01, 0],
          [0, 0.22, 0],
          [0, 0.31, 0.04],
          [0, 0.33, 0.12],
          [0, 0.3, 0.2],
        ]}
      >
        {metal}
      </Tube>
      {/* The spray head, docked at the end of the spout. */}
      <mesh position={[0, 0.265, 0.21]} rotation={[0.2, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.018, 0.08, SEG]} />
        {metal}
      </mesh>
      <SideLever y={0.1} r={0.015} fit={fit} />
    </group>
  )
}

export function Sink({ style, w, d, fit }: { style: SinkStyle; w: number; d: number; fit: Fit }) {
  const { M } = fit
  const plan = sinkPlan(style, w, d)
  const { wall } = plan
  const [tx, tz] = plan.tap
  if (style === 'belfast') {
    const b = plan.bowls[0]
    const body = b.depth + 0.03
    const top = 0.006
    return (
      <group>
        <Hollow size={[w, body, d]} wall={wall} radius={b.r} floor={0.03} position={[0, top - body, 0]}>
          {M('bowl')}
        </Hollow>
        <Waste x={0} y={top - b.depth} z={0} fit={fit} />
        {/* A little water stands in the bowl while the tap runs. */}
        <Fill on={fit.on} share={0.25} rate={0.8} floor={top - b.depth} top={top} w={b.w} l={b.d} r={b.r} />
        <group position={[tx, 0, tz]}>
          <BridgeTap fit={fit} />
        </group>
        <Stream on={fit.on} position={[tx, 0.264, tz + 0.21]} length={0.264 + b.depth - top} radius={0.008} />
      </group>
    )
  }
  if (style === 'inset') {
    const b = plan.bowls[0]
    const rim = 0.008
    // The drainer, the part of the rim right of the bowl, ribbed so water
    // runs to it.
    const from = b.x + b.w / 2 + 0.05
    const to = w / 2 - 0.05
    const ribs = Math.max(0, Math.floor((to - from) / 0.028))
    return (
      <group>
        <Slab
          size={[w, rim, d]}
          radius={0.02}
          bevel={0.003}
          holes={plan.bowls.map(o => ({ x: o.x, z: o.z, w: o.w, d: o.d, r: o.r }))}
        >
          {M('bowl')}
        </Slab>
        <Hollow
          size={[b.w + wall * 2, b.depth, b.d + wall * 2]}
          wall={wall}
          radius={b.r}
          floor={0.012}
          position={[b.x, -b.depth, b.z]}
        >
          {M('bowl')}
        </Hollow>
        <Waste x={b.x} y={-b.depth + 0.012} z={b.z} fit={fit} />
        <group position={[b.x, 0, b.z]}>
          <Fill on={fit.on} share={0.25} rate={0.8} floor={-b.depth + 0.012} top={0} w={b.w} l={b.d} r={b.r} />
        </group>
        {Array.from({ length: ribs }, (_, i) => (
          <mesh key={i} position={[from + 0.014 + i * 0.028, rim + 0.001, b.z]}>
            <boxGeometry args={[0.01, 0.002, b.d * 0.8]} />
            {M('bowl')}
          </mesh>
        ))}
        <group position={[tx, rim, tz]}>
          <PullOutTap fit={fit} />
        </group>
        <Stream
          on={fit.on}
          position={[tx, rim + 0.225, tz + 0.218]}
          length={rim + 0.225 + b.depth - 0.012}
          radius={0.008}
        />
      </group>
    )
  }
  return (
    <group>
      {plan.bowls.map((b, i) => (
        <group key={i}>
          <Hollow
            size={[b.w + wall * 2, b.depth, b.d + wall * 2]}
            wall={wall}
            radius={b.r}
            floor={0.01}
            position={[b.x, -0.004 - b.depth, b.z]}
          >
            {M('bowl')}
          </Hollow>
          <Waste x={b.x} y={-0.004 - b.depth + 0.01} z={b.z} fit={fit} />
          {/* Only the bowl under the tap holds water. */}
          {i === 0 && (
            <group position={[b.x, 0, b.z]}>
              <Fill
                on={fit.on}
                share={0.25}
                rate={0.8}
                floor={-0.004 - b.depth + 0.01}
                top={-0.004}
                w={b.w}
                l={b.d}
                r={b.r}
              />
            </group>
          )}
        </group>
      ))}
      <group position={[tx, 0, tz]}>
        <LeverTap fit={fit} />
      </group>
      <Stream
        on={fit.on}
        position={[tx, 0.21, tz + 0.205]}
        length={0.21 + plan.bowls[0].depth - 0.006}
        radius={0.008}
      />
    </group>
  )
}
