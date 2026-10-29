import { colorValue, decorationVariant, materialValue, paramValue, type DecorationKind } from '#/decoration/catalog.ts'
import { useEased } from '#/scene/decor/ease.ts'
import { Bubbles, Spray, Sweep } from '#/scene/decor/effects.tsx'
import { scatter } from '#/scene/decor/scatter.ts'
import { Halo, Hollow, Led, Material, SEG, Slab, Steam, Waves } from '#/scene/decor/parts.tsx'
import type { ItemState } from '#/scene/decor/state.ts'
import type { DecorationConfig } from '#/types.ts'
import { useMemo, type ReactNode } from 'react'

type Props = {
  kind: DecorationKind
  item: DecorationConfig
  state: ItemState | null
}

type Look = {
  p: (id: string) => number
  c: (slot: string) => string
  M: (slot: string) => ReactNode
  style: string
  on: boolean
}

type Vec3 = [number, number, number]

const WATER = '#4fb0d6'
const UNDERWATER = '#39c6ff'
// Water in the air, deeper than the drops indoors so it shows against grass
// and paving alike.
const SPRAY = '#5aa9e0'

// Things for the garden, the terrace and the balcony.
export default function OutdoorModel({ kind, item, state }: Props) {
  const p = (id: string) => paramValue(kind, item.params, id, item.variant)
  const c = (slot: string) => colorValue(kind, item.colors, slot, item.variant)
  const m = (slot: string) => materialValue(kind, slot, item.variant)
  const on = state?.on ?? false
  const look: Look = {
    p,
    c,
    M: (slot: string) => <Material color={c(slot)} material={m(slot)} />,
    style: decorationVariant(kind, item.variant)?.id ?? '',
    on,
  }
  switch (kind.id) {
    case 'hot_tub':
      return look.style === 'barrel' ? <BarrelTub {...look} /> : <SquareSpa {...look} />
    case 'pool':
      return look.style === 'frame' ? <FramePool {...look} /> : <DeckPool {...look} />
    case 'sprinkler':
      if (look.style === 'drip') return <DripLine {...look} />
      return look.style === 'oscillating' ? <ArcBar {...look} /> : <PopRotor {...look} />
    default:
      return null
  }
}

// The water in a tub or pool: a sheet at its surface that lights up from
// below while it runs, with round ripples spreading from a few spots on it,
// each set on its own beat, as if something stirred the water there.
function Surface({
  on,
  w,
  d,
  y,
  round = false,
  jets = false,
}: {
  on: boolean
  w: number
  d: number
  y: number
  round?: boolean
  jets?: boolean
}) {
  const lit = useEased(on ? 1 : 0, 2)
  const spots = useMemo(() => {
    const short = Math.min(w, d)
    const reach = short * (jets ? 0.22 : 0.26)
    // Spread over the water on a loose grid, each spot anywhere in its cell
    // and kept a ring's reach in from the edge; on a round basin, anywhere
    // round the middle inside its circle.
    if (round) {
      return Array.from({ length: 3 }, (_, i) => {
        const a = (i / 3) * Math.PI * 2 + (scatter(i, 51) - 0.5) * 1.8
        const rr = (w / 2 - reach) * (0.1 + scatter(i, 52) * 0.85)
        return { at: [Math.cos(a) * rr, 0.004, Math.sin(a) * rr] as Vec3, reach, phase: scatter(i, 55) }
      })
    }
    const cols = Math.max(1, Math.round((w - reach) / (reach * 2.4)))
    const rows = Math.max(1, Math.round((d - reach) / (reach * 2.4)))
    const out: { at: Vec3; reach: number; phase: number }[] = []
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const k = i * rows + j
        const x = -w / 2 + reach + ((w - reach * 2) * (i + 0.05 + scatter(k, 53) * 0.9)) / cols
        const z = -d / 2 + reach + ((d - reach * 2) * (j + 0.05 + scatter(k, 54) * 0.9)) / rows
        out.push({ at: [x, 0.004, z], reach, phase: scatter(k, 55) })
      }
    }
    return out
  }, [w, d, round, jets])
  return (
    <group position={[0, y, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        {round ? <circleGeometry args={[w / 2, SEG]} /> : <planeGeometry args={[w, d]} />}
        <meshStandardMaterial
          color={WATER}
          transparent
          opacity={0.82}
          roughness={0.08}
          metalness={0.1}
          emissive={UNDERWATER}
          emissiveIntensity={0.55 * lit}
        />
      </mesh>
      {spots.map((s, i) => (
        <Waves
          key={i}
          on={on}
          position={s.at}
          rotation={[-Math.PI / 2, 0, 0]}
          from={0.03}
          reach={s.reach}
          strength={0.32}
          speed={jets ? 0.8 : 0.3}
          phase={s.phase}
          color="#eaf8ff"
        />
      ))}
    </group>
  )
}

// Wisps of steam off a hot tub's water, sixteen small ones scattered over
// the surface instead of one plume from the middle.
function TubSteam({ on, y, r, round = false }: { on: boolean; y: number; r: number; round?: boolean }) {
  const spots = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i): [number, number] => {
        if (!round) return [(scatter(i, 21) - 0.5) * 1.7 * r, (scatter(i, 22) - 0.5) * 1.7 * r]
        const a = scatter(i, 21) * Math.PI * 2
        const d = Math.sqrt(scatter(i, 22)) * r * 0.85
        return [Math.cos(a) * d, Math.sin(a) * d]
      }),
    [r, round],
  )
  return spots.map(([x, z], i) => (
    <Steam
      key={i}
      on={on}
      position={[x, y, z]}
      radius={0.035 + scatter(i, 23) * 0.02}
      rise={0.22 + scatter(i, 24) * 0.12}
      count={3}
      strength={0.16}
      speed={0.25 + scatter(i, 25) * 0.12}
      phase={scatter(i, 26)}
    />
  ))
}

// A square acrylic spa in a panelled cabinet, after the Jacuzzi J-300: the
// water lit blue from underneath, bubbling and steaming while the jets run.
function SquareSpa({ p, M, on }: Look) {
  const s = p('size')
  const h = p('height')
  const lip = 0.12
  const inner = s - lip * 2
  const water = h - 0.12
  const boards = Math.max(8, Math.round(s / 0.09))
  return (
    <group>
      <Slab size={[s, h - 0.06, s]} radius={0.04} bevel={0.01} holes={[{ x: 0, z: 0, w: inner, d: inner, r: 0.1 }]}>
        {M('cabinet')}
      </Slab>
      {/* Vertical boards round the cabinet. */}
      {[0, 1, 2, 3].map(side => (
        <group key={side} rotation={[0, (side * Math.PI) / 2, 0]}>
          {Array.from({ length: boards - 1 }, (_, i) => (
            <mesh key={i} position={[-s / 2 + (s / boards) * (i + 1), (h - 0.06) / 2, s / 2 + 0.001]}>
              <boxGeometry args={[0.006, h - 0.1, 0.002]} />
              <meshStandardMaterial color="#000000" transparent opacity={0.25} />
            </mesh>
          ))}
        </group>
      ))}
      {/* The acrylic shell rim, and the shell's inside. */}
      <Slab
        size={[s + 0.02, 0.06, s + 0.02]}
        radius={0.05}
        bevel={0.02}
        position={[0, h - 0.06, 0]}
        holes={[{ x: 0, z: 0, w: inner, d: inner, r: 0.1 }]}
      >
        {M('shell')}
      </Slab>
      <Hollow size={[inner + 0.02, h - 0.1, inner + 0.02]} wall={0.02} radius={0.1} position={[0, 0.05, 0]}>
        {M('shell')}
      </Hollow>
      {/* Head rests in two corners. */}
      {[-1, 1].map(sx => (
        <mesh key={sx} position={[(sx * inner) / 2.4, h + 0.01, -inner / 2.4]} scale={[1, 0.4, 1]}>
          <sphereGeometry args={[0.07, 16, 10]} />
          <Material color="#3a3d40" material="matte" />
        </mesh>
      ))}
      <Surface on={on} w={inner} d={inner} y={water} jets />
      <Bubbles
        on={on}
        w={inner * 0.9}
        d={inner * 0.9}
        h={0.08}
        count={50}
        radius={0.01}
        speed={0.9}
        position={[0, water - 0.07, 0]}
      />
      <TubSteam on={on} y={water + 0.02} r={inner / 2} />
      <Led on={on} position={[s / 2 - 0.1, h + 0.001, s / 2 - 0.05]} radius={0.01} color="#8fd6ff" />
      <Halo on={on} position={[0, water + 0.2, 0]} color={UNDERWATER} intensity={0.5} distance={2.4} />
    </group>
  )
}

// A round cedar tub in staves held by two steel bands, after the Scandinavian
// wood fired kind, with steps up to its rim.
function BarrelTub({ p, M, on }: Look) {
  const s = p('size')
  const h = p('height')
  const R = s / 2
  const staves = Math.max(18, Math.round((Math.PI * s) / 0.09))
  const water = h - 0.14
  return (
    <group>
      {Array.from({ length: staves }, (_, i) => {
        const a = (i / staves) * Math.PI * 2
        return (
          <mesh
            key={i}
            position={[Math.sin(a) * (R - 0.02), h / 2, Math.cos(a) * (R - 0.02)]}
            rotation={[0, a, 0]}
            castShadow
          >
            <boxGeometry args={[((Math.PI * 2 * R) / staves) * 1.02, h, 0.04]} />
            {M('cabinet')}
          </mesh>
        )
      })}
      {[0.2, 0.8].map(k => (
        <mesh key={k} position={[0, h * k, 0]}>
          <cylinderGeometry args={[R + 0.014, R + 0.014, 0.04, 64, 1, true]} />
          <Material color="#2a2b2d" material="metal" doubleSide />
        </mesh>
      ))}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[R - 0.04, R - 0.04, 0.1, SEG]} />
        {M('cabinet')}
      </mesh>
      {/* A bench round the inside. */}
      <mesh position={[0, h * 0.45, 0]}>
        <cylinderGeometry args={[R - 0.04, R - 0.04, 0.04, SEG, 1, false]} />
        {M('shell')}
      </mesh>
      {/* Two steps up the front. */}
      {[0, 1].map(i => (
        <Slab
          key={i}
          size={[0.5, (h * (i + 1)) / 3, 0.22]}
          radius={0.01}
          bevel={0.004}
          position={[0, 0, R + 0.11 + (1 - i) * 0.22]}
        >
          {M('cabinet')}
        </Slab>
      ))}
      <Surface on={on} w={(R - 0.04) * 2} d={(R - 0.04) * 2} y={water} round jets />
      <Bubbles on={on} w={R} d={R} h={0.08} count={40} radius={0.01} speed={0.9} position={[0, water - 0.07, 0]} />
      <TubSteam on={on} y={water + 0.02} r={R - 0.08} round />
      <Halo on={on} position={[0, water + 0.2, 0]} color={UNDERWATER} intensity={0.45} distance={2.2} />
    </group>
  )
}

// A raised plunge pool boxed in decking, with a ladder over its side and
// lights under the water that come on with the switch.
function DeckPool({ p, M, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const edge = 0.3
  const inW = w - edge * 2
  const inD = d - edge * 2
  const water = h - 0.1
  const boards = Math.max(6, Math.round(d / 0.14))
  return (
    <group>
      {/* The deck frame, board by board round the rim. */}
      <Slab size={[w, h - 0.03, d]} radius={0.01} bevel={0.004} holes={[{ x: 0, z: 0, w: inW, d: inD, r: 0.03 }]}>
        {M('frame')}
      </Slab>
      {/* The deck boards round the rim, with a gap between each. */}
      {Array.from({ length: boards }, (_, i) => {
        const z = -d / 2 + (d / boards) * (i + 0.5)
        const across = Math.abs(z) > inD / 2
        return across ? (
          <mesh key={i} position={[0, h - 0.015, z]} castShadow>
            <boxGeometry args={[w + 0.02, 0.03, d / boards - 0.012]} />
            {M('frame')}
          </mesh>
        ) : (
          [-1, 1].map(sx => (
            <mesh key={`${i}${sx}`} position={[(sx * (w + inW)) / 4, h - 0.015, z]} castShadow>
              <boxGeometry args={[(w - inW) / 2 + 0.01, 0.03, d / boards - 0.012]} />
              {M('frame')}
            </mesh>
          ))
        )
      })}
      {/* The pool itself, sunk in the frame and lined. */}
      <Hollow size={[inW + 0.02, h - 0.05, inD + 0.02]} wall={0.02} radius={0.03} position={[0, 0.02, 0]}>
        {M('liner')}
      </Hollow>
      <Surface on={on} w={inW} d={inD} y={water} />
      <Ladder x={inW / 2 - 0.25} z={-inD / 2} h={h} />
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * inW * 0.25, water - 0.25, -inD / 2 + 0.002]}>
          <circleGeometry args={[0.05, 24]} />
          <meshStandardMaterial color="#dfe9ee" emissive="#bff0ff" emissiveIntensity={on ? 3 : 0} />
        </mesh>
      ))}
      <Halo on={on} position={[0, water + 0.3, 0]} color={UNDERWATER} intensity={0.6} distance={Math.max(w, d) * 1.2} />
    </group>
  )
}

// An above ground pool: a liner hung in a steel frame of legs and top rails.
function FramePool({ p, M, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const water = h - 0.12
  const legs = useMemo(() => {
    const out: Vec3[] = []
    const nx = Math.max(2, Math.round(w / 1.2))
    const nz = Math.max(2, Math.round(d / 1.2))
    for (let i = 0; i <= nx; i++) for (const sz of [-1, 1]) out.push([-w / 2 + (w / nx) * i, 0, (sz * d) / 2])
    for (let j = 1; j < nz; j++) for (const sx of [-1, 1]) out.push([(sx * w) / 2, 0, -d / 2 + (d / nz) * j])
    return out
  }, [w, d])
  return (
    <group>
      <Hollow size={[w - 0.04, h - 0.02, d - 0.04]} wall={0.015} radius={0.04}>
        {M('liner')}
      </Hollow>
      {legs.map((at, i) => (
        <mesh key={i} position={[at[0], h / 2, at[2]]} castShadow>
          <boxGeometry args={[0.05, h, 0.05]} />
          {M('frame')}
        </mesh>
      ))}
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[0, h, (s * d) / 2]}>
            <boxGeometry args={[w + 0.05, 0.05, 0.06]} />
            {M('frame')}
          </mesh>
          <mesh position={[(s * w) / 2, h, 0]}>
            <boxGeometry args={[0.06, 0.05, d + 0.05]} />
            {M('frame')}
          </mesh>
        </group>
      ))}
      <Surface on={on} w={w - 0.08} d={d - 0.08} y={water} />
      <Ladder x={w / 4} z={d / 2} h={h} outside />
      <Halo on={on} position={[0, water + 0.3, 0]} color={UNDERWATER} intensity={0.5} distance={Math.max(w, d)} />
    </group>
  )
}

// A steel pool ladder hooked over the edge at `z`.
function Ladder({ x, z, h, outside = false }: { x: number; z: number; h: number; outside?: boolean }) {
  const steel = <Material color="#c9ced2" material="metal" />
  const inward = outside ? 1 : -1
  return (
    <group position={[x, 0, z]}>
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.22, 0, 0]}>
          {/* Each handrail bows over the coping, from the rail in the water
              down to a foot anchored in the deck. */}
          <mesh position={[0, h + 0.15, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.1, 0.018, 8, 20, Math.PI]} />
            {steel}
          </mesh>
          <mesh position={[0, h + 0.075, 0.1 * inward]}>
            <cylinderGeometry args={[0.018, 0.018, 0.15, 12]} />
            {steel}
          </mesh>
          <mesh position={[0, h / 2 + 0.05, -0.1 * inward]}>
            <cylinderGeometry args={[0.018, 0.018, h + 0.2, 12]} />
            {steel}
          </mesh>
        </group>
      ))}
      {[0.3, 0.55, 0.8].map(k => (
        <mesh key={k} position={[0, h * k, -0.1 * inward]}>
          <boxGeometry args={[0.44, 0.02, 0.08]} />
          {steel}
        </mesh>
      ))}
    </group>
  )
}

// A pop up rotor set in the lawn: its riser climbs out of the ground while
// it waters, and it turns slowly round throwing one long jet.
function PopRotor({ p, M, on }: Look) {
  const reach = p('size')
  const up = useEased(on ? 1 : 0, 3)
  const riser = 0.1 * up
  return (
    <group>
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.01, SEG]} />
        {M('body')}
      </mesh>
      <mesh position={[0, 0.01 + riser / 2, 0]} visible={riser > 0.002}>
        <cylinderGeometry args={[0.02, 0.02, riser, 16]} />
        {M('nozzle')}
      </mesh>
      <group position={[0, 0.01 + riser, 0]}>
        <Sweep on={on} speed={0.35}>
          <mesh position={[0, 0.012, 0]}>
            <cylinderGeometry args={[0.03, 0.035, 0.024, 16]} />
            {M('body')}
          </mesh>
          <mesh position={[0, 0.018, 0.03]} rotation={[Math.PI / 2 - 0.4, 0, 0]}>
            <cylinderGeometry args={[0.006, 0.008, 0.02, 10]} />
            {M('nozzle')}
          </mesh>
          <Spray
            on={on}
            reach={reach}
            apex={reach * 0.28}
            from={0.02}
            spread={0.06}
            count={160}
            speed={0.9}
            size={0.018}
            color={SPRAY}
          />
        </Sweep>
      </group>
    </group>
  )
}

// An oscillating bar sprinkler on a sled: a row of jets along a tube that
// rocks from side to side, throwing a curtain of water.
function ArcBar({ p, M, on }: Look) {
  const reach = p('size')
  const bar = 0.36
  const lanes = useMemo(() => Array.from({ length: 11 }, (_, i) => -bar / 2 + (bar / 10) * i), [])
  return (
    <group>
      <Slab size={[bar + 0.08, 0.03, 0.12]} radius={0.015} bevel={0.005}>
        {M('body')}
      </Slab>
      {[-1, 1].map(s => (
        <mesh key={s} position={[(s * (bar + 0.02)) / 2, 0.05, 0]}>
          <boxGeometry args={[0.02, 0.05, 0.04]} />
          {M('body')}
        </mesh>
      ))}
      <group position={[0, 0.06, 0]}>
        <Sweep on={on} arc={1.2} speed={0.45} axis="x">
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.012, 0.012, bar, 16]} />
            {M('nozzle')}
          </mesh>
          {/* The jets leave along the bar and fan out as they fly, so the
              curtain lands wider than the sprinkler itself. */}
          <Spray
            on={on}
            reach={reach * 0.7}
            apex={reach * 0.2}
            from={0.012}
            lanes={lanes}
            fan={2.2}
            spread={0.06}
            count={16}
            speed={0.8}
            size={0.014}
            color={SPRAY}
          />
        </Sweep>
      </group>
    </group>
  )
}

// A drip line: a brown hose laid along the bed with an emitter every short
// step, each flicking out slow drops, one after another, to either side.
function DripLine({ p, M, on }: Look) {
  const len = p('size')
  const n = Math.max(3, Math.round(len / 0.3))
  const lanes = useMemo(() => Array.from({ length: n }, (_, i) => -len / 2 + (len / n) * (i + 0.5)), [n, len])
  return (
    <group>
      <mesh position={[0, 0.012, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.009, 0.009, len, 12]} />
        {M('body')}
      </mesh>
      {lanes.map(x => (
        <mesh key={x} position={[x, 0.02, 0]}>
          <cylinderGeometry args={[0.008, 0.01, 0.018, 10]} />
          {M('nozzle')}
        </mesh>
      ))}
      {/* Turned half round, the second throw runs the other way, so the
          lanes are mirrored to land on the same emitters. */}
      {[0, Math.PI].map(turn => (
        <group key={turn} rotation={[0, turn, 0]}>
          <Spray
            on={on}
            reach={0.16}
            apex={0.05}
            from={0.028}
            lanes={turn ? lanes.map(x => -x) : lanes}
            spread={0.03}
            count={2}
            speed={0.35}
            size={0.007}
            color={SPRAY}
          />
        </group>
      ))}
    </group>
  )
}
