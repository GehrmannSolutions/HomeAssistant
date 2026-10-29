import { Slab, Soft } from '#/scene/decor/parts.tsx'
import type { ReactNode } from 'react'

type Props = {
  style: string
  w: number
  d: number
  // The material of a named part.
  M: (slot: string) => ReactNode
}

type Vec3 = [number, number, number]

// Sim racing cockpits, the driver facing +z: the bucket seat at the back,
// the wheel in front of it and the pedals at the far end. Each is drawn at
// its rig's own size in meters and stretched to the width and depth the
// sliders give it.

// The rigs as they are sold: width across and depth from the back of the
// seat to the front of the pedals.
const RIGS: Record<string, { w: number; d: number }> = {
  tube: { w: 0.55, d: 1.38 },
  profile: { w: 0.6, d: 1.35 },
}

const INK = '#141517'

// A fixed back bucket seat on its sliders, the back raked 18 degrees: a pan
// with a bolster each side, a tall back with wings round the ribs and the
// shoulders, and the two slots a harness runs through. Its pan is 26 cm
// off the floor, low as a race car's.
function Bucket({ z, M }: { z: number; M: Props['M'] }) {
  return (
    <group position={[0, 0, z]}>
      {/* The shell under the pan, and the pan's cushion and bolsters. */}
      <Slab size={[0.48, 0.1, 0.46]} radius={0.08} bevel={0.02} position={[0, 0.15, 0.02]}>
        {M('seat')}
      </Slab>
      <Soft size={[0.36, 0.08, 0.44]} round={[0.03, 0.03, 0.03]} puff={[0, 0.01, 0]} position={[0, 0.27, 0.03]}>
        {M('seat')}
      </Soft>
      {[-1, 1].map(s => (
        <group key={s}>
          <Soft
            size={[0.08, 0.15, 0.44]}
            round={[0.035, 0.05, 0.05]}
            position={[s * 0.21, 0.29, 0.03]}
            rotation={[0, 0, -s * 0.25]}
          >
            {M('seat')}
          </Soft>
          {/* A stripe down the outside of each bolster. */}
          <Slab size={[0.012, 0.012, 0.38]} radius={0.005} bevel={0.003} position={[s * 0.25, 0.335, 0.03]}>
            {M('trim')}
          </Slab>
        </group>
      ))}
      {/* The back, raked, with its own wings and the harness slots. */}
      <group position={[0, 0.2, -0.19]} rotation={[-0.32, 0, 0]}>
        <Soft size={[0.5, 0.82, 0.07]} round={[0.04, 0.05, 0.03]} position={[0, 0.41, -0.02]}>
          {M('seat')}
        </Soft>
        <Soft size={[0.34, 0.66, 0.06]} round={[0.03, 0.04, 0.025]} puff={[0, 0, 0.008]} position={[0, 0.38, 0.04]}>
          {M('seat')}
        </Soft>
        {[-1, 1].map(s => (
          <group key={s}>
            <Soft
              size={[0.08, 0.46, 0.18]}
              round={[0.035, 0.06, 0.05]}
              position={[s * 0.22, 0.28, 0.06]}
              rotation={[0, s * 0.3, 0]}
            >
              {M('seat')}
            </Soft>
            <Soft
              size={[0.07, 0.2, 0.14]}
              round={[0.03, 0.05, 0.04]}
              position={[s * 0.16, 0.7, 0.05]}
              rotation={[0, s * 0.35, 0]}
            >
              {M('seat')}
            </Soft>
            <Slab size={[0.012, 0.4, 0.012]} radius={0.005} bevel={0.003} position={[s * 0.262, 0.08, 0.08]}>
              {M('trim')}
            </Slab>
            <mesh position={[s * 0.07, 0.66, 0.072]}>
              <boxGeometry args={[0.05, 0.014, 0.004]} />
              <meshStandardMaterial color={INK} roughness={0.9} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

// A round wheel at `at`, its face toward the driver and tipped back by
// `tilt`: a rim with three spokes into a hub, on a shaft back to its base.
function Wheel({ at, tilt, r, M }: { at: Vec3; tilt: number; r: number; M: Props['M'] }) {
  return (
    <group position={at} rotation={[tilt, 0, 0]}>
      <mesh castShadow>
        <torusGeometry args={[r, 0.017, 10, 40]} />
        {M('wheel')}
      </mesh>
      {[0, Math.PI * 0.5, Math.PI].map(a => (
        <mesh key={a} position={[(Math.cos(a) * r) / 2, (-Math.sin(a) * r) / 2, 0]} rotation={[0, 0, -a]}>
          <boxGeometry args={[r, 0.035, 0.014]} />
          {M('wheel')}
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.05, 24]} />
        {M('wheel')}
      </mesh>
      {/* The little red mark at twelve o'clock. */}
      <mesh position={[0, r, 0]}>
        <boxGeometry args={[0.012, 0.038, 0.036]} />
        {M('trim')}
      </mesh>
    </group>
  )
}

// Three pedals on a plate leaning away from the driver: clutch, brake and
// throttle, each an arm up from a pivot at the plate's foot with its pad.
function Pedals({ at, lean, M }: { at: Vec3; lean: number; M: Props['M'] }) {
  return (
    <group position={at} rotation={[lean, 0, 0]}>
      <Slab size={[0.38, 0.012, 0.3]} radius={0.02} bevel={0.004} position={[0, -0.012, 0]}>
        {M('frame')}
      </Slab>
      {[-0.1, 0, 0.1].map((x, i) => (
        <group key={x} position={[x, 0, -0.1]}>
          {/* The arm rises off the plate toward the driver. */}
          <mesh position={[0, 0.06, 0.09]} rotation={[-0.6, 0, 0]}>
            <boxGeometry args={[0.018, 0.016, 0.2]} />
            {M('pedals')}
          </mesh>
          <Slab size={[i === 2 ? 0.045 : 0.07, 0.012, 0.1]} radius={0.01} bevel={0.003} position={[0, 0.11, 0.16]}>
            {M('pedals')}
          </Slab>
        </group>
      ))}
    </group>
  )
}

// A tube cockpit after the Next Level Racing GTtrack: two black steel rails
// along the floor tied by cross tubes, the seat on sliders at the back, a
// wheel deck on two posts in the middle and the pedal plate at the front.
function TubeCockpit({ M }: { M: Props['M'] }) {
  const tube = (size: Vec3, at: Vec3, key?: string | number) => (
    <Slab key={key} size={size} radius={0.018} bevel={0.006} position={at}>
      {M('frame')}
    </Slab>
  )
  return (
    <group>
      {[-1, 1].map(s => tube([0.05, 0.06, 1.38], [s * 0.2, 0.02, 0], `r${s}`))}
      {[-0.6, -0.12, 0.62].map(z => tube([0.42, 0.05, 0.05], [0, 0.025, z], `c${z}`))}
      {[-1, 1].flatMap(sx =>
        [-0.66, 0.66].map(z => (
          <mesh key={`${sx}${z}`} position={[sx * 0.2, 0.01, z]}>
            <cylinderGeometry args={[0.025, 0.028, 0.02, 12]} />
            <meshStandardMaterial color={INK} roughness={0.9} />
          </mesh>
        )),
      )}
      {/* The seat's sliders and brackets. */}
      {[-1, 1].map(s => tube([0.04, 0.07, 0.42], [s * 0.17, 0.08, -0.38], `s${s}`))}
      <Bucket z={-0.42} M={M} />
      {/* The wheel deck on its two posts, leaning a little toward the seat. */}
      {[-1, 1].map(s => tube([0.05, 0.55, 0.05], [s * 0.14, 0.05, 0.22], `p${s}`))}
      <group position={[0, 0.6, 0.2]} rotation={[0.12, 0, 0]}>
        <Slab size={[0.36, 0.014, 0.26]} radius={0.02} bevel={0.004}>
          {M('frame')}
        </Slab>
        {/* The wheel base, a dark box on the deck with its shaft out. */}
        <Slab size={[0.14, 0.11, 0.22]} radius={0.02} bevel={0.006} position={[0, 0.014, 0.01]}>
          {M('wheel')}
        </Slab>
        <mesh position={[0, 0.07, -0.13]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.06, 12]} />
          {M('wheel')}
        </mesh>
      </group>
      <Wheel at={[0, 0.69, 0.04]} tilt={0.3} r={0.15} M={M} />
      <Pedals at={[0, 0.07, 0.5]} lean={0.75} M={M} />
    </group>
  )
}

// A slot down a profile's face, as dark as the inside of it.
function Groove({ size, at }: { size: Vec3; at: Vec3 }) {
  return (
    <mesh position={at}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={INK} roughness={0.9} />
    </mesh>
  )
}

// An aluminium profile cockpit after the Sim-Lab GT1 Evo: two 80 by 40 mm
// rails along the floor, an upright frame of the same profile at the front
// with a direct drive base on its crossbar, the seat on brackets at the back
// and a slotted deck for the pedals between the rails.
function ProfileCockpit({ M }: { M: Props['M'] }) {
  const profile = (size: Vec3, at: Vec3, key?: string | number) => (
    <Slab key={key} size={size} radius={0.004} bevel={0.002} position={at}>
      {M('frame')}
    </Slab>
  )
  return (
    <group>
      {[-1, 1].map(s => (
        <group key={s}>
          {profile([0.04, 0.08, 1.35], [s * 0.26, 0, 0])}
          <Groove size={[0.002, 0.008, 1.33]} at={[s * 0.281, 0.04, 0]} />
          <Groove size={[0.002, 0.008, 1.33]} at={[s * 0.239, 0.04, 0]} />
        </group>
      ))}
      {[-0.62, -0.15, 0.2, 0.63].map(z => profile([0.48, 0.08, 0.04], [0, 0, z], `c${z}`))}
      {/* The seat brackets, bolted to the cross profiles under it. */}
      {[-1, 1].map(s => profile([0.03, 0.12, 0.44], [s * 0.18, 0.08, -0.4], `s${s}`))}
      <Bucket z={-0.42} M={M} />
      {/* The front upright: two posts and a crossbar, 66 cm tall. */}
      {[-1, 1].map(s => (
        <group key={`u${s}`}>
          {profile([0.08, 0.58, 0.04], [s * 0.2, 0.08, 0.2])}
          <Groove size={[0.008, 0.56, 0.002]} at={[s * 0.2, 0.37, 0.179]} />
        </group>
      ))}
      {profile([0.48, 0.08, 0.04], [0, 0.58, 0.2])}
      {/* The direct drive base: a round motor on a plate on the crossbar,
          its shaft toward the seat. */}
      <Slab size={[0.16, 0.12, 0.012]} radius={0.01} bevel={0.003} position={[0, 0.56, 0.174]}>
        {M('wheel')}
      </Slab>
      <mesh position={[0, 0.66, 0.08]} rotation={[Math.PI / 2 + 0.2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.18, 28]} />
        {M('wheel')}
      </mesh>
      <Wheel at={[0, 0.645, -0.03]} tilt={0.2} r={0.15} M={M} />
      {/* The pedal deck between the rails, with its slots. */}
      <group position={[0, 0.08, 0.45]}>
        {Array.from({ length: 4 }, (_, i) => (
          <Groove key={i} size={[0.36, 0.002, 0.008]} at={[0, 0.0135, -0.1 + i * 0.06]} />
        ))}
      </group>
      <Pedals at={[0, 0.09, 0.45]} lean={0.55} M={M} />
    </group>
  )
}

export default function SimRig({ style, w, d, M }: Props) {
  const rig = RIGS[style] ?? RIGS.tube
  return (
    <group scale={[w / rig.w, 1, d / rig.d]}>
      {style === 'profile' ? <ProfileCockpit M={M} /> : <TubeCockpit M={M} />}
    </group>
  )
}
