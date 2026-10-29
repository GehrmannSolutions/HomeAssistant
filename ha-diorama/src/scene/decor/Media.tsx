import { Halo, Led, Material, SEG, Slab, Spinner, Waves } from '#/scene/decor/parts.tsx'
import { useBeamScene } from '#/scene/decor/beam.ts'
import { ScreenGlow } from '#/scene/decor/Screen.tsx'
import { useShowingColor, type Showing } from '#/scene/decor/showing.ts'
import { useThrow } from '#/scene/decor/throw.ts'
import { useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  type Group,
  BufferGeometry,
  type BufferAttribute,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { useFrame } from '@react-three/fiber'

// The speakers, the game consoles and the projector's beam, each in the
// styles the catalog gives it. `paint` gives the material for a slot, and
// `color` and `material` the raw values for parts that also glow.

export type Look = {
  paint: (slot: string) => ReactNode
  color: (slot: string) => string
  material: (slot: string) => string
}

// The light a projector throws: a hollow box widening from the lens to a
// picture `width` wide, in the proportions of a wide screen, fading as it
// goes. It adds to whatever is behind it, so it reads as haze in the air
// and never hides the room. The fade rides in the vertex alpha, not the
// color: on the card's see through canvas the alpha a pixel gains darkens
// the page behind it, so it must fall away with the light or the faint far
// end shows as a dark box. Thrown onto a projection screen, it reaches
// the corners of the picture there instead, and fades out just as it gets
// to them.
// How far along the throw the beam is drawn before it has faded away.
const BEAM_REACH = 0.85
// The rings along the beam, how wide the lens is, and its corners in turn.
const ROWS = 24
const LENS = 0.012
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

// `showing` is what a player behind the projector plays, which the beam
// takes the color of and a projection screen it lands on shows.
export function Beam({
  length,
  width,
  strength,
  showing = null,
}: {
  length: number
  width: number
  strength: number
  showing?: Showing | null
}) {
  const material = useBeamScene(0.2 * strength, useShowingColor(showing))
  const from = useRef<Group>(null)
  const thrown = useThrow(from, length, strength, showing)
  const geometry = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const index: number[] = []
    for (let i = 0; i <= ROWS; i++) {
      const t = i / ROWS
      const along = t * BEAM_REACH
      const hx = LENS + (width / 2 - LENS) * along
      const hy = LENS + (width / 2 / (16 / 9) - LENS) * along
      // Brightest just out of the lens, gone by the end of what is drawn.
      const fade = Math.pow(1 - t, 1.8) * Math.min(1, t * 5 + 0.2)
      for (const [sx, sy] of CORNERS) {
        const x = sx * hx
        const y = sy * hy
        positions.push(x, y, along * length)
        colors.push(1, 1, 1, fade)
      }
    }
    for (let i = 0; i < ROWS; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k
        const b = i * 4 + ((k + 1) % 4)
        index.push(a, b, b + 4, a, b + 4, a + 4)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new Float32BufferAttribute(colors, 4))
    g.setIndex(index)
    return g
  }, [length, width])
  // The beam as it is drawn into the air, to go back to once it no longer
  // lands on a screen.
  const free = useMemo(() => (geometry.getAttribute('position').array as Float32Array).slice(), [geometry])
  const landed = useRef(false)
  const local = useMemo(() => [new Vector3(), new Vector3(), new Vector3(), new Vector3()], [])
  useFrame(() => {
    const group = from.current
    const position = geometry.getAttribute('position') as BufferAttribute
    const array = position.array as Float32Array
    const lands = thrown.current.lands
    if (!group || !lands) {
      if (landed.current) {
        array.set(free)
        position.needsUpdate = true
        geometry.computeBoundingSphere()
        landed.current = false
      }
      return
    }
    landed.current = true
    group.updateWorldMatrix(true, false)
    lands.forEach((corner, i) => group.worldToLocal(local[i].copy(corner)))
    // Each corner of the lens goes to the corner of the picture on its own
    // side, whichever face of the screen it lands on.
    CORNERS.forEach(([sx, sy], k) => {
      let to = local[0]
      for (const corner of local) if (sx * corner.x + sy * corner.y > sx * to.x + sy * to.y) to = corner
      for (let i = 0; i <= ROWS; i++) {
        const t = i / ROWS
        const at = (i * 4 + k) * 3
        array[at] = sx * LENS * (1 - t) + to.x * t
        array[at + 1] = sy * LENS * (1 - t) + to.y * t
        array[at + 2] = to.z * t
      }
    })
    position.needsUpdate = true
    geometry.computeBoundingSphere()
  })
  return (
    <group ref={from}>
      {strength >= 0.01 && (
        <mesh geometry={geometry} renderOrder={2}>
          <meshBasicMaterial
            ref={material}
            color="#eef3ff"
            vertexColors
            transparent
            opacity={0.2 * strength}
            blending={AdditiveBlending}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
      {/* Three quarters of the way along the haze, the picture's colors light the room. */}
      <ScreenGlow
        on={strength > 0.5}
        position={[0, 0, length * BEAM_REACH * 0.75]}
        intensity={0.6}
        distance={3}
        showing={showing}
      />
    </group>
  )
}

// A lathe from a profile of radius and height pairs.
function Turned({ profile, children }: { profile: [number, number][]; children: ReactNode }) {
  const key = profile.flat().join(',')
  const geometry = useMemo(() => {
    const at = key.split(',').map(Number)
    const points = Array.from({ length: at.length / 2 }, (_, i) => new Vector2(at[i * 2], at[i * 2 + 1]))
    return new LatheGeometry(points, SEG)
  }, [key])
  return (
    <mesh geometry={geometry} castShadow>
      {children}
    </mesh>
  )
}

// The swirl of color that plays across a smart speaker's top while it
// listens: three soft discs turning over dark glass.
function Swirl({ r, y, lit }: { r: number; y: number; lit: number }) {
  if (lit < 0.01) return null
  return (
    <group position={[0, y, 0]}>
      <Spinner speed={1.6}>
        {['#ff6fb5', '#8f7bff', '#4fd2ff'].map((color, i) => {
          const a = (i / 3) * Math.PI * 2
          return (
            <mesh
              key={color}
              position={[Math.cos(a) * r * 0.35, 0.0005 * i, Math.sin(a) * r * 0.35]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[r * 0.55, SEG]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.8 * lit}
                blending={AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          )
        })}
      </Spinner>
    </group>
  )
}

// Three smart speakers. A tall one wrapped all round in mesh, with no
// buttons and a glass top that lights up. A small ball of one with flat
// poles. The old fabric drum with a wooden base and top.
// Lays a ring of sound flat, round a speaker that plays all ways.
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0]

export function Speaker({
  style,
  r,
  h,
  on,
  lit,
  sounding,
  look,
}: {
  style: string
  r: number
  h: number
  on: boolean
  lit: number
  sounding: boolean
  look: Look
}) {
  const { paint } = look
  if (style === 'mini') {
    // A sphere cut flat top and bottom.
    const cut = 0.42
    const half = r * Math.cos(cut)
    const pole = r * Math.sin(cut)
    return (
      <group position={[0, half, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[r, SEG * 2, SEG, 0, Math.PI * 2, cut, Math.PI - cut * 2]} />
          {paint('mesh')}
        </mesh>
        <mesh position={[0, -half + 0.001, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[pole, SEG]} />
          {paint('top')}
        </mesh>
        <mesh position={[0, half, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[pole, SEG]} />
          {paint('top')}
        </mesh>
        <Swirl r={pole * 0.8} y={half + 0.001} lit={lit} />
        <Waves on={sounding} position={[0, half * 0.85, 0]} rotation={FLAT} from={r * 1.1} reach={r * 2.2} />
      </group>
    )
  }
  if (style === 'drum') {
    const foot = 0.016
    const plate = Math.min(0.02, h * 0.1)
    return (
      <group>
        <mesh position={[0, foot / 2, 0]}>
          <cylinderGeometry args={[r * 0.86, r * 0.9, foot, SEG]} />
          {paint('base')}
        </mesh>
        <mesh position={[0, (foot + h - plate) / 2, 0]} castShadow>
          <cylinderGeometry args={[r, r * 0.98, h - plate - foot, SEG]} />
          {paint('grille')}
        </mesh>
        <mesh position={[0, h - plate / 2, 0]}>
          <cylinderGeometry args={[r * 0.99, r, plate, SEG]} />
          {paint('base')}
        </mesh>
        <Led on={on} position={[0, h + 0.002, r * 0.45]} radius={Math.min(0.007, r * 0.1)} />
        <Waves on={sounding} position={[0, h * 0.92, 0]} rotation={FLAT} from={r * 1.1} reach={r * 2.2} />
      </group>
    )
  }
  // The pod: soft shoulders top and bottom, and a sunken glass top.
  const top = r * 0.72
  return (
    <group>
      <Turned
        profile={[
          [0, 0],
          [r * 0.6, 0],
          [r * 0.82, h * 0.025],
          [r * 0.95, h * 0.08],
          [r, h * 0.18],
          [r, h * 0.8],
          [r * 0.97, h * 0.9],
          [r * 0.9, h * 0.96],
          [r * 0.8, h * 0.995],
          [top, h],
          [0, h],
        ]}
      >
        {paint('mesh')}
      </Turned>
      <mesh position={[0, h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[top * 0.96, SEG * 2]} />
        {paint('top')}
      </mesh>
      <Swirl r={top * 0.7} y={h + 0.002} lit={lit} />
      <Waves on={sounding} position={[0, h * 0.92, 0]} rotation={FLAT} from={r * 1.1} reach={r * 2.2} />
    </group>
  )
}

// One loudspeaker driver seen from the front: a rubber surround, a cone
// dished into the baffle, and a dust cap in the middle. A tweeter is a
// small domed one in a metal ring.
function Driver({ r, y, z, tweeter, look }: { r: number; y: number; z: number; tweeter: boolean; look: Look }) {
  const { paint } = look
  return (
    <group position={[0, y, z]}>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[r * 0.9, r * 1.14, SEG * 2]} />
        {paint('trim')}
      </mesh>
      <mesh position={[0, 0, 0.0015]}>
        <circleGeometry args={[r * 0.95, SEG * 2]} />
        {paint('drivers')}
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <torusGeometry args={[r * 0.93, r * 0.06, 10, SEG * 2]} />
        {paint('drivers')}
      </mesh>
      {tweeter ? (
        <mesh position={[0, 0, 0.002]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.6, 1]}>
          <sphereGeometry args={[r * 0.62, SEG, SEG / 2, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {paint('trim')}
        </mesh>
      ) : (
        <>
          {/* The cone, a shallow dish in front of the baffle. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.008]}>
            <cylinderGeometry args={[r * 0.3, r * 0.88, 0.012, SEG * 2, 1, true]} />
            <Material color={look.color('drivers')} material="ceramic" doubleSide />
          </mesh>
          <mesh position={[0, 0, 0.002]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.45, 1]}>
            <sphereGeometry args={[r * 0.3, SEG, SEG / 2, 0, Math.PI * 2, 0, Math.PI / 2]} />
            {paint('drivers')}
          </mesh>
        </>
      )}
    </group>
  )
}

// Two floor speakers. A classic one: an oak cabinet on a plinth with its
// drivers out in the open on the front, a tweeter over a midrange and as
// many woofers as the height leaves room for, and a port at the foot. A
// modern one: a slim round column wrapped in fabric, a metal cap, and a
// neck down to a thin disc, so it looks to float, after the Bang & Olufsen
// Beolab 18.
export function FloorSpeaker({
  style,
  w,
  h,
  on,
  sounding,
  look,
}: {
  style: string
  w: number
  h: number
  on: boolean
  sounding: boolean
  look: Look
}) {
  const { paint } = look
  if (style === 'column') {
    const r = w / 2
    const disc = 0.012
    const neck = 0.07
    const cap = Math.min(0.05, h * 0.06)
    const body = h - disc - neck - cap
    return (
      <group>
        <mesh position={[0, disc / 2, 0]} castShadow>
          <cylinderGeometry args={[r * 1.5, r * 1.55, disc, SEG * 2]} />
          {paint('metal')}
        </mesh>
        <mesh position={[0, disc + neck / 2, 0]}>
          <cylinderGeometry args={[r * 0.18, r * 0.24, neck, SEG]} />
          {paint('metal')}
        </mesh>
        <mesh position={[0, disc + neck + 0.006, 0]}>
          <cylinderGeometry args={[r * 0.96, r * 0.8, 0.012, SEG * 2]} />
          {paint('metal')}
        </mesh>
        <mesh position={[0, disc + neck + body / 2, 0]} castShadow>
          <cylinderGeometry args={[r, r, body - 0.012, SEG * 2]} />
          {paint('fabric')}
        </mesh>
        <mesh position={[0, h - cap / 2, 0]}>
          <cylinderGeometry args={[r * 0.9, r, cap, SEG * 2]} />
          {paint('metal')}
        </mesh>
        <Led on={on} position={[0, h - cap * 0.5, r + 0.001]} color="#e8f2f6" radius={Math.min(0.004, r * 0.08)} />
        <Waves
          on={sounding}
          position={[0, disc + neck + body * 0.95, 0]}
          rotation={FLAT}
          from={r * 1.15}
          reach={r * 3}
        />
      </group>
    )
  }
  const d = w * 1.15
  const plinth = 0.03
  const cab = h - plinth - 0.012
  const tweeter = w * 0.1
  const mid = w * 0.26
  const woofer = w * 0.34
  const front = d / 2
  const ty = h - 0.05 - tweeter
  const my = ty - tweeter - 0.03 - mid
  const first = my - mid - 0.04 - woofer
  const port = 0.12
  const woofers = Math.min(2, Math.max(0, Math.floor((first - port - woofer) / (woofer * 2.4)) + 1))
  return (
    <group>
      <Slab size={[w * 1.2, plinth, d * 1.12]} radius={0.01} bevel={0.004} position={[0, 0, 0]}>
        {paint('cabinet')}
      </Slab>
      <Slab size={[w, cab, d]} radius={0.012} bevel={0.006} position={[0, plinth + 0.012, 0]}>
        {paint('cabinet')}
      </Slab>
      {/* A shadow gap between the plinth and the cabinet. */}
      <mesh position={[0, plinth + 0.006, 0]}>
        <boxGeometry args={[w * 0.9, 0.012, d * 0.9]} />
        {paint('drivers')}
      </mesh>
      <Driver r={tweeter} y={ty} z={front} tweeter look={look} />
      <Driver r={mid} y={my} z={front} tweeter={false} look={look} />
      {Array.from({ length: woofers }, (_, i) => (
        <Driver key={i} r={woofer} y={first - i * woofer * 2.4} z={front} tweeter={false} look={look} />
      ))}
      {/* The port, a dark round hole low on the front. */}
      <mesh position={[0, port * 0.7, front + 0.001]}>
        <circleGeometry args={[w * 0.1, SEG]} />
        <meshStandardMaterial color="#0e0f10" roughness={1} />
      </mesh>
      <mesh position={[0, port * 0.7, front + 0.001]}>
        <torusGeometry args={[w * 0.1, 0.004, 8, SEG]} />
        {paint('trim')}
      </mesh>
      <Led on={on} position={[w * 0.36, ty, front + 0.002]} radius={0.004} />
      <Waves on={sounding} position={[0, h - 0.03, 0]} rotation={FLAT} from={front * 1.15} reach={w * 0.9} />
    </group>
  )
}

// A side panel of the PlayStation 5: tall, pinched at the waist, flaring
// out at the top, with a curved front and back. Seen from the side, cut
// from the shape and pushed out to the panel's thickness.
function Wing({ h, d, t, x, children }: { h: number; d: number; t: number; x: number; children: ReactNode }) {
  const geometry = useMemo(() => {
    const s = new Shape()
    s.moveTo(-d * 0.4, 0)
    s.lineTo(d * 0.38, 0)
    s.quadraticCurveTo(d * 0.36, h * 0.6, d * 0.54, h)
    s.quadraticCurveTo(0, h * 1.03, -d * 0.54, h)
    s.quadraticCurveTo(-d * 0.38, h * 0.6, -d * 0.4, 0)
    const g = new ExtrudeGeometry(s, {
      depth: t,
      bevelEnabled: true,
      bevelSize: t * 0.3,
      bevelThickness: t * 0.3,
      bevelSegments: 3,
      curveSegments: 24,
    })
    g.rotateY(-Math.PI / 2)
    g.translate(t / 2, 0, 0)
    return g
  }, [h, d, t])
  return (
    <mesh geometry={geometry} position={[x, 0, 0]} castShadow>
      {children}
    </mesh>
  )
}

// Three consoles. A white box laid flat with a black round vent on its
// side, after the Xbox Series S. A black tower with a round vent on top,
// green inside, after the Xbox Series X. A tall black core between two
// white wings, lit blue down the seams, on a round stand, after the
// PlayStation 5. The width is across the front and the height is how tall it
// stands.
export function Console({
  style,
  w,
  h,
  on,
  lit,
  look,
}: {
  style: string
  w: number
  h: number
  on: boolean
  lit: number
  look: Look
}) {
  const { paint, color, material } = look
  if (style === 'tower') {
    const foot = 0.008
    const vent = w * 0.4
    return (
      <group>
        <mesh position={[0, foot / 2, 0]}>
          <cylinderGeometry args={[w * 0.42, w * 0.42, foot, SEG]} />
          <meshStandardMaterial color="#0c0d0e" roughness={0.9} />
        </mesh>
        <Slab size={[w, h - foot, w]} radius={w * 0.04} bevel={w * 0.015} position={[0, foot, 0]}>
          {paint('body')}
        </Slab>
        {/* The vent: the green inside, and the grille over it in rings. */}
        <mesh position={[0, h - 0.004, 0]}>
          <cylinderGeometry args={[vent, vent, 0.008, SEG * 2]} />
          <Material
            color={color('vent')}
            material={material('vent')}
            emissive={[0.35, 0.8, 0.3]}
            emissiveIntensity={0.9 * lit}
          />
        </mesh>
        <Halo on={on} position={[0, h + 0.05, 0]} color="#8fe08a" intensity={0.06} />
        {[0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1].map(k => (
          <mesh key={k} position={[0, h + 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.4]}>
            <torusGeometry args={[vent * k, vent * 0.05, 8, SEG * 2]} />
            {paint('body')}
          </mesh>
        ))}
        {/* The disc slot down the front, and the power button above it. */}
        <mesh position={[w * 0.3, h * 0.55, w / 2 + 0.001]}>
          <boxGeometry args={[0.003, h * 0.5, 0.002]} />
          <meshStandardMaterial color="#050505" />
        </mesh>
        <Led on={on} position={[-w * 0.3, h * 0.93, w / 2]} color="#e8f2f6" radius={Math.min(0.006, w * 0.04)} />
        {/* The light bar across the foot of the front, lit while it is on. */}
        <mesh position={[0, foot + h * 0.06, w / 2 + 0.0015]}>
          <boxGeometry args={[w * 0.6, Math.min(0.008, h * 0.03), 0.003]} />
          <meshStandardMaterial color="#1a1d20" emissive="#9ff09a" emissiveIntensity={3 * lit} />
        </mesh>
        <Halo on={on} position={[0, h * 0.3, w / 2 + 0.06]} color="#9ff09a" intensity={0.1} />
      </group>
    )
  }
  if (style === 'wing') {
    const d = h * 0.67
    const stand = 0.012
    const core = w * 0.62
    const t = w * 0.12
    const gap = w * 0.02
    return (
      <group>
        <mesh position={[0, stand / 2, 0]}>
          <cylinderGeometry args={[d * 0.24, d * 0.26, stand, SEG * 2]} />
          {paint('core')}
        </mesh>
        <group position={[0, stand, 0]}>
          <Slab size={[core, h * 0.96, d * 0.84]} radius={core * 0.3} bevel={core * 0.1} position={[0, h * 0.01, 0]}>
            {paint('core')}
          </Slab>
          {[-1, 1].map(side => (
            <group key={side}>
              <Wing h={h} d={d} t={t} x={side * (core / 2 + gap + t / 2)}>
                {paint('shell')}
              </Wing>
              {/* The light, down the seam between the core and the wing. */}
              <mesh position={[side * (core / 2 + gap / 2), h * 0.5, d * 0.42]}>
                <boxGeometry args={[gap * 0.8, h * 0.8, 0.004]} />
                <Material
                  color={color('light')}
                  material={material('light')}
                  emissive={[0.2, 0.42, 1]}
                  emissiveIntensity={3 * lit}
                />
              </mesh>
            </group>
          ))}
          {/* The light bar across the foot of the core's front. */}
          <mesh position={[0, h * 0.1, d * 0.42 + 0.0015]}>
            <boxGeometry args={[core * 0.6, Math.min(0.008, h * 0.03), 0.003]} />
            <meshStandardMaterial color="#1a1d20" emissive="#8fb4ff" emissiveIntensity={3 * lit} />
          </mesh>
          <Halo on={on} position={[0, h * 0.4, d * 0.42 + 0.06]} color="#8fb4ff" intensity={0.1} />
        </group>
      </group>
    )
  }
  const d = w * 0.55
  const feet = 0.006
  const vent = Math.min(h, d) * 0.42
  const mid = feet + h / 2
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}:${sz}`} position={[sx * w * 0.38, feet / 2, sz * d * 0.36]}>
            <cylinderGeometry args={[0.008, 0.008, feet, 12]} />
            {paint('panel')}
          </mesh>
        )),
      )}
      <Slab size={[w, h, d]} radius={Math.min(0.01, h * 0.2)} bevel={Math.min(0.004, h * 0.06)} position={[0, feet, 0]}>
        {paint('body')}
      </Slab>
      {/* The vent, a black disc with the rings of its grille. */}
      <mesh position={[w / 2 + 0.001, mid, -d * 0.1]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[vent, vent, 0.002, SEG]} />
        {paint('panel')}
      </mesh>
      {[0.4, 0.75].map(k => (
        <mesh key={k} position={[w / 2 + 0.002, mid, -d * 0.1]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[vent * k, Math.min(0.0015, vent * 0.04), 8, SEG]} />
          {paint('body')}
        </mesh>
      ))}
      {/* A port, and the button that glows while it is on. */}
      <mesh position={[-w * 0.28, mid, d / 2 + 0.001]}>
        <boxGeometry args={[w * 0.04, h * 0.14, 0.002]} />
        {paint('panel')}
      </mesh>
      <Led on={on} position={[-w * 0.4, mid, d / 2]} color="#e8f2f6" radius={Math.min(0.006, h * 0.12)} />
      {/* The light bar along the foot of the front, lit while it is on. */}
      <mesh position={[w * 0.08, feet + h * 0.12, d / 2 + 0.0015]}>
        <boxGeometry args={[w * 0.6, Math.min(0.008, h * 0.14), 0.003]} />
        <meshStandardMaterial color="#1a1d20" emissive="#cfe6ff" emissiveIntensity={3 * lit} />
      </mesh>
      <Halo on={on} position={[0, mid, d / 2 + 0.06]} color="#cfe6ff" intensity={0.1} />
    </group>
  )
}

// A portable projector after the Samsung Freestyle: a can with the lens in
// one end, held at its middle in a U shaped cradle on a round foot. Off, it
// looks straight up. On, it turns in the cradle to face the wall ahead,
// aimed a little up, and throws its picture.
export function PortableProjector({
  s,
  throwLength,
  swing,
  lit,
  look,
  showing,
}: {
  s: number
  throwLength: number
  swing: number
  lit: number
  look: Look
  showing?: Showing | null
}) {
  const { paint, color } = look
  const r = s / 2
  const len = s * 1.25
  const foot = s * 0.14
  const pivot = foot + len / 2 + s * 0.08
  const aim = 0.12
  const tilt = -(aim + (Math.PI / 2 - aim) * (1 - swing))
  const arm = r + s * 0.06
  return (
    <group>
      <mesh position={[0, foot / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 1.05, r * 1.1, foot, SEG * 2]} />
        {paint('cradle')}
      </mesh>
      {/* The U of the cradle, up either side to the pivots. */}
      {[-1, 1].map(side => (
        <group key={side}>
          <Slab
            size={[s * 0.07, pivot - foot + s * 0.1, s * 0.34]}
            radius={s * 0.03}
            bevel={s * 0.01}
            position={[side * arm, foot - 0.002, 0]}
          >
            {paint('cradle')}
          </Slab>
          <mesh position={[side * (arm - s * 0.04), pivot, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[s * 0.1, s * 0.1, s * 0.06, SEG]} />
            {paint('cradle')}
          </mesh>
        </group>
      ))}
      <group position={[0, pivot, 0]} rotation={[tilt, 0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[r, r, len, SEG * 2]} />
          {paint('body')}
        </mesh>
        {/* The lens end: a dark face with the glass in the middle. */}
        <mesh position={[0, 0, len / 2 + 0.001]}>
          <circleGeometry args={[r * 0.9, SEG * 2]} />
          <meshStandardMaterial color="#141516" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, len / 2 + 0.004]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r * 0.36, r * 0.4, 0.006, SEG]} />
          <meshStandardMaterial color={color('lens')} emissive="#cfe4f5" emissiveIntensity={2 * lit} />
        </mesh>
        {/* The speaker grille at the back end. */}
        <mesh position={[0, 0, -len / 2 - 0.001]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[r * 0.85, SEG * 2]} />
          {paint('cradle')}
        </mesh>
        <group position={[0, 0, len / 2 + 0.006]}>
          <Beam
            length={throwLength}
            width={throwLength * 0.55}
            strength={lit * Math.max(0, (swing - 0.85) / 0.15)}
            showing={showing}
          />
        </group>
      </group>
    </group>
  )
}
