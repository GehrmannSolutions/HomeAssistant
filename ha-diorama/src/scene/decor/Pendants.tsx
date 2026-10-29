import { cestitaGlobeProfile } from '#/scene/decor/cestitaGlobe.ts'
import { BaseMaterial, ShadeMaterial, type LightState } from '#/scene/decor/lightMaterials.tsx'
import { Material, Rod, SEG } from '#/scene/decor/parts.tsx'
import {
  CAPSULE_CANOPY,
  CAPSULE_FINS,
  CAPSULE_H,
  CAPSULE_R,
  CESTITA_PENDANT_CANOPY,
  CESTITA_PENDANT_CAP,
  CESTITA_PENDANT_GRIP,
  CESTITA_PENDANT_H,
  CESTITA_PENDANT_LIP,
  CESTITA_PENDANT_R,
  CIRIO_H,
  CIRIO_R,
  CIRIO_WALL,
  HEADHAT_H,
  HEADHAT_R,
  HEADHAT_SHOULDER,
  HEADHAT_TOP_R,
  HEADHAT_WALL,
  LED_CABLE_R,
  NAGOYA_H,
  NAGOYA_R,
  NAGOYA_SLATS,
  NAGOYA_THREADS,
  TEXTILE_CORD_R,
} from '#/scene/decor/pendantSpecs.ts'
import { CESTITA_GLOBE, CESTITA_GLOBE_R } from '#/scene/decor/tableLampSpecs.ts'
import { CEILING_HEIGHT_M } from '#/theme.ts'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { InstancedMesh, Matrix4, Quaternion, Vector2, Vector3 } from 'three'

// The pendant styles, each one a Santa & Cole lamp drawn from its technical
// drawing. Every part is in real meters, measured down from the top of the
// lamp, so the numbers here can be checked against the drawings. The size
// slider scales the lamp itself; the canopy and the cord stay their real
// size, since a bigger shade does not come with a thicker cable.

type ModelProps = {
  // How much bigger than the real lamp this one is drawn.
  k: number
  // The height of the top of the lamp, where the cord ends.
  top: number
  c: (slot: string) => string
  m: (slot: string) => string
  state: LightState | null
}

// The cord straight up from the lamp to the canopy.
function Cord({ from, to, r, c, m }: { from: number; to: number; r: number; c: string; m: string }) {
  const [a, b] = useMemo(() => [new Vector3(0, from, 0), new Vector3(0, to, 0)], [from, to])
  return (
    <Rod from={a} to={b} r={r}>
      <BaseMaterial color={c} material={m} />
    </Rod>
  )
}

// A round surface canopy on the ceiling, the black one all three capsule and
// glass lamps come with.
function Canopy({ diameter, height, c, m }: { diameter: number; height: number; c: string; m: string }) {
  return (
    <mesh position={[0, CEILING_HEIGHT_M - height / 2, 0]}>
      <cylinderGeometry args={[diameter / 2, diameter / 2, height, SEG * 2]} />
      <BaseMaterial color={c} material={m} />
    </mesh>
  )
}

// A lathe profile as three wants it.
function lathe(points: [number, number][]) {
  return points.map(([x, y]) => new Vector2(x, y))
}

// The HeadLed capsule both the HeadHat and the Cirio hang from: a black
// finned heat sink about a centimeter tall, the two drawings' total heights
// less their shades, with a translucent diffuser under it.
function Capsule({ c, m, state }: { c: string; m: string; state: LightState | null }) {
  const fin = (Math.PI * 2 * CAPSULE_R) / CAPSULE_FINS / 2
  return (
    <group>
      <mesh position={[0, -CAPSULE_H / 2, 0]}>
        <cylinderGeometry args={[CAPSULE_R * 0.8, CAPSULE_R * 0.8, CAPSULE_H, SEG * 2]} />
        <BaseMaterial color={c} material={m} />
      </mesh>
      {Array.from({ length: CAPSULE_FINS }, (_, i) => {
        const a = (i / CAPSULE_FINS) * Math.PI * 2
        const r = CAPSULE_R * 0.9
        return (
          <mesh key={i} position={[Math.cos(a) * r, -CAPSULE_H / 2, Math.sin(a) * r]} rotation={[0, -a, 0]}>
            <boxGeometry args={[CAPSULE_R * 0.2, CAPSULE_H, fin]} />
            <BaseMaterial color={c} material={m} />
          </mesh>
        )
      })}
      {/* The diffuser the LEDs shine through, just under the heat sink. */}
      <mesh position={[0, -CAPSULE_H - 0.003, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[CAPSULE_R * 0.7, CAPSULE_R * 0.75, 0.006, SEG * 2]} />
        <ShadeMaterial color="#f4f2ee" material="matte" state={state} />
      </mesh>
    </group>
  )
}

// Nagoya: a drum of thin wooden slats, Ø42 by 25 cm, open top and bottom,
// held together by white thread at seven levels. A rod crosses the top with
// the lamp holder in the middle of it, and a white methacrylate diffuser
// hangs inside. It has no canopy: the cord goes up over a hook in the ceiling.

function Slats({ c, m, state }: { c: string; m: string; state: LightState | null }) {
  const mesh = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const slats = mesh.current
    if (!slats) return
    const place = new Matrix4()
    const turn = new Quaternion()
    const up = new Vector3(0, 1, 0)
    const one = new Vector3(1, 1, 1)
    for (let i = 0; i < NAGOYA_SLATS; i++) {
      const a = (i / NAGOYA_SLATS) * Math.PI * 2
      turn.setFromAxisAngle(up, -a)
      place.compose(new Vector3(Math.cos(a) * NAGOYA_R, -NAGOYA_H / 2, Math.sin(a) * NAGOYA_R), turn, one)
      slats.setMatrixAt(i, place)
    }
    slats.instanceMatrix.needsUpdate = true
    slats.computeBoundingSphere()
  }, [])
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, NAGOYA_SLATS]} userData={{ transmits: true }}>
      {/* A slat is a strip of veneer: under a centimeter wide and paper thin,
          with a gap to the next one the light comes through. */}
      <boxGeometry args={[0.0015, NAGOYA_H, 0.0095]} />
      <ShadeMaterial color={c} material={m} state={state} />
    </instancedMesh>
  )
}

function Nagoya({ k, top, c, m, state }: ModelProps) {
  const hook = 0.03
  return (
    <>
      <group position={[0, top, 0]} scale={k}>
        <Slats c={c('slats')} m={m('slats')} state={state} />
        {Array.from({ length: NAGOYA_THREADS }, (_, i) => (
          <mesh
            key={i}
            position={[0, -0.002 - (i * (NAGOYA_H - 0.004)) / (NAGOYA_THREADS - 1), 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[NAGOYA_R + 0.0009, 0.0012, 6, SEG * 4]} />
            <BaseMaterial color={c('threads')} material={m('threads')} />
          </mesh>
        ))}
        {/* The rod across the top and the ring in the middle of it. */}
        <mesh position={[0, -0.004, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.002, 0.002, NAGOYA_R * 2, 12]} />
          <BaseMaterial color={c('cord')} material="metal" />
        </mesh>
        <mesh position={[0, -0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.022, 0.002, 8, SEG]} />
          <BaseMaterial color={c('cord')} material="metal" />
        </mesh>
        {/* The E27 holder, and the diffuser round the bulb under it. */}
        <mesh position={[0, -0.02, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.032, SEG]} />
          <BaseMaterial color={c('cord')} material={m('cord')} />
        </mesh>
        <mesh position={[0, -0.036 - 0.06, 0]} userData={{ transmits: true }}>
          <cylinderGeometry args={[0.035, 0.035, 0.12, SEG * 2]} />
          <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} />
        </mesh>
      </group>
      <Cord from={top - 0.004 * k} to={CEILING_HEIGHT_M - hook} r={TEXTILE_CORD_R} c={c('cord')} m={m('cord')} />
      {/* The hook the cord hangs from, a plain ceiling fitting. */}
      <mesh position={[0, CEILING_HEIGHT_M - hook + 0.006, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.008, 0.0015, 8, SEG, Math.PI]} />
        <BaseMaterial color={c('cord')} material="metal" />
      </mesh>
      <mesh position={[0, CEILING_HEIGHT_M - hook / 2 + 0.004, 0]}>
        <cylinderGeometry args={[0.0015, 0.0015, hook - 0.008, 8]} />
        <BaseMaterial color={c('cord')} material="metal" />
      </mesh>
    </>
  )
}

// Globo Cestita: the Cestita's opal globe, Ø17 cm, hanging from its cord
// under a flat black cap. A thin glass lip, barely there, rounds off the
// bottom. Ø10.8 cm canopy.

// The table globe's profile, moved so its top is at zero and fitted between
// the cap and the lip.
const CESTITA_PENDANT_GLASS_H = CESTITA_PENDANT_H - CESTITA_PENDANT_CAP[1] - CESTITA_PENDANT_LIP[1]
const CESTITA_PENDANT_SCALE: [number, number, number] = [
  CESTITA_PENDANT_R / CESTITA_GLOBE_R,
  CESTITA_PENDANT_GLASS_H / (CESTITA_GLOBE[1] - CESTITA_GLOBE[0]),
  CESTITA_PENDANT_R / CESTITA_GLOBE_R,
]
const CESTITA_PENDANT_PROFILE = lathe(cestitaGlobeProfile().map(([x, y]) => [x, y - CESTITA_GLOBE[1]]))

function GloboCestita({ k, top, c, m, state }: ModelProps) {
  const [capR, capH] = CESTITA_PENDANT_CAP
  const [gripR, gripH] = CESTITA_PENDANT_GRIP
  const [lipR, lipH] = CESTITA_PENDANT_LIP
  return (
    <>
      <group position={[0, top, 0]} scale={k}>
        <mesh position={[0, -capH, 0]} scale={CESTITA_PENDANT_SCALE} userData={{ transmits: true }}>
          <latheGeometry args={[CESTITA_PENDANT_PROFILE, Math.round(SEG * 1.5)]} />
          <ShadeMaterial color={c('globe')} material={m('globe')} state={state} />
        </mesh>
        <mesh position={[0, -CESTITA_PENDANT_H + lipH / 2, 0]} userData={{ transmits: true }}>
          <cylinderGeometry args={[lipR, lipR * 0.97, lipH, SEG * 2]} />
          <ShadeMaterial color={c('globe')} material={m('globe')} state={state} />
        </mesh>
        <mesh position={[0, -capH / 2, 0]}>
          <cylinderGeometry args={[capR, capR, capH, SEG * 2]} />
          <BaseMaterial color={c('cap')} material={m('cap')} />
        </mesh>
        <mesh position={[0, gripH / 2, 0]}>
          <cylinderGeometry args={[gripR, gripR, gripH, SEG]} />
          <BaseMaterial color={c('cap')} material={m('cap')} />
        </mesh>
      </group>
      <Cord
        from={top + CESTITA_PENDANT_GRIP[1] * k}
        to={CEILING_HEIGHT_M - CESTITA_PENDANT_CANOPY[1]}
        r={TEXTILE_CORD_R}
        c={c('cord')}
        m={m('cord')}
      />
      <Canopy diameter={CESTITA_PENDANT_CANOPY[0]} height={CESTITA_PENDANT_CANOPY[1]} c={c('canopy')} m={m('canopy')} />
    </>
  )
}

// HeadHat Bowl L: a white ceramic bowl Ø20 cm, 12 cm tall with the capsule
// on top, glossy outside and matte inside. The shoulder rounds from a flat
// top into a straight side, and the bottom is open. Ø11 by 6 cm canopy.

function headhatProfile(inset: number): [number, number][] {
  // A flat top, a quarter ellipse shoulder and a straight side down to the
  // rim.
  const [rx, ry] = HEADHAT_SHOULDER
  const shoulderY = -CAPSULE_H - ry
  const points: [number, number][] = [[HEADHAT_R - inset, -HEADHAT_H]]
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * (Math.PI / 2)
    points.push([HEADHAT_TOP_R + (rx - inset) * Math.cos(t), shoulderY + (ry - inset) * Math.sin(t)])
  }
  points.push([CAPSULE_R * 0.85, -CAPSULE_H - inset])
  return points
}

const HEADHAT_OUTSIDE = lathe(headhatProfile(0))
const HEADHAT_INSIDE = lathe(headhatProfile(HEADHAT_WALL))

function HeadhatBowl({ k, top, c, m, state }: ModelProps) {
  return (
    <>
      <group position={[0, top, 0]} scale={k}>
        <Capsule c={c('capsule')} m={m('capsule')} state={state} />
        {/* Ceramic is opaque: the outside stays white and the inside is lit. */}
        <mesh>
          <latheGeometry args={[HEADHAT_OUTSIDE, SEG]} />
          <Material color={c('shade')} material={m('shade')} doubleSide />
        </mesh>
        <mesh userData={{ transmits: true }}>
          <latheGeometry args={[HEADHAT_INSIDE, SEG]} />
          <ShadeMaterial color={c('inside')} material={m('inside')} state={state} />
        </mesh>
        <mesh position={[0, -HEADHAT_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[HEADHAT_R - HEADHAT_WALL, HEADHAT_R, SEG * 2]} />
          <BaseMaterial color={c('shade')} material={m('shade')} />
        </mesh>
      </group>
      <Cord from={top} to={CEILING_HEIGHT_M - CAPSULE_CANOPY[1]} r={LED_CABLE_R} c={c('cord')} m={m('cord')} />
      <Canopy diameter={CAPSULE_CANOPY[0]} height={CAPSULE_CANOPY[1]} c={c('canopy')} m={m('canopy')} />
    </>
  )
}

// Cirio Simple: a white porcelain tube Ø10 by 21 cm, open at the bottom,
// hanging from the capsule, 22 cm with it. Porcelain lets the light through,
// so the whole tube glows. Ø11 by 6 cm canopy.

function CirioSimple({ k, top, c, m, state }: ModelProps) {
  const tubeY = -CAPSULE_H - CIRIO_H / 2
  return (
    <>
      <group position={[0, top, 0]} scale={k}>
        <Capsule c={c('capsule')} m={m('capsule')} state={state} />
        <mesh position={[0, tubeY, 0]} userData={{ transmits: true }}>
          <cylinderGeometry args={[CIRIO_R, CIRIO_R, CIRIO_H, SEG * 2, 1, true]} />
          <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
        </mesh>
        <mesh position={[0, tubeY, 0]} userData={{ transmits: true }}>
          <cylinderGeometry args={[CIRIO_R - CIRIO_WALL, CIRIO_R - CIRIO_WALL, CIRIO_H, SEG * 2, 1, true]} />
          <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
        </mesh>
        {/* The top the capsule sits in, and the rim at the bottom. */}
        <mesh position={[0, -CAPSULE_H, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[CAPSULE_R * 0.8, CIRIO_R, SEG * 2]} />
          <BaseMaterial color={c('shade')} material={m('shade')} />
        </mesh>
        <mesh position={[0, -CAPSULE_H - CIRIO_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[CIRIO_R - CIRIO_WALL, CIRIO_R, SEG * 2]} />
          <BaseMaterial color={c('shade')} material={m('shade')} />
        </mesh>
      </group>
      <Cord from={top} to={CEILING_HEIGHT_M - CAPSULE_CANOPY[1]} r={LED_CABLE_R} c={c('cord')} m={m('cord')} />
      <Canopy diameter={CAPSULE_CANOPY[0]} height={CAPSULE_CANOPY[1]} c={c('canopy')} m={m('canopy')} />
    </>
  )
}

const MODELS: Record<string, (props: ModelProps) => ReactNode> = {
  nagoya: Nagoya,
  globo_cestita: GloboCestita,
  headhat_bowl: HeadhatBowl,
  cirio_simple: CirioSimple,
}

export default function Pendant({ style, ...props }: ModelProps & { style: string }) {
  const Model = MODELS[style] ?? Nagoya
  return <Model {...props} />
}
