import { colorValue, decorationVariant, materialValue, paramValue, type DecorationKind } from '#/decoration/catalog.ts'
import { useEased } from '#/scene/decor/ease.ts'
import { Glass, Halo, Material, SEG, Slab } from '#/scene/decor/parts.tsx'
import ScreenMaterial from '#/scene/decor/Screen.tsx'
import type { ItemState } from '#/scene/decor/state.ts'
import { useLive } from '#/scene/live.ts'
import type { DecorationConfig } from '#/types.ts'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import { CanvasTexture, LatheGeometry, SRGBColorSpace, Vector2, type Group } from 'three'

type Props = { kind: DecorationKind; item: DecorationConfig; state: ItemState | null }

type Look = {
  p: (id: string) => number
  c: (slot: string) => string
  M: (slot: string) => ReactNode
  style: string
  state: ItemState | null
  on: boolean
}

type Vec3 = [number, number, number]

// The machines round a home's network and its workbench: a 3D printer, a
// router and a tablet on the wall that shows the home's dashboard.
export default function TechModel({ kind, item, state }: Props) {
  const p = (id: string) => paramValue(kind, item.params, id, item.variant)
  const c = (slot: string) => colorValue(kind, item.colors, slot, item.variant)
  const m = (slot: string) => materialValue(kind, slot, item.variant)
  const look: Look = {
    p,
    c,
    M: (slot: string) => <Material color={c(slot)} material={m(slot)} />,
    style: decorationVariant(kind, item.variant)?.id ?? '',
    state,
    on: state?.on ?? false,
  }
  switch (kind.id) {
    case 'printer_3d':
      return <Printer {...look} />
    case 'router':
      return look.style === 'mesh' ? <MeshPuck {...look} /> : <AntennaRouter {...look} />
    case 'wall_tablet':
      return <WallTablet {...look} />
    default:
      return null
  }
}

// A part that lights itself in `glow` by `strength`, over its own `color`.
function Lit({ color, glow, strength }: { color: string; glow: string; strength: number }) {
  return <meshStandardMaterial color={color} emissive={glow} emissiveIntensity={strength} roughness={0.4} />
}

// What a printer's sensor says while it works. Each make words it its own
// way: printing, running, preparing, heating the bed, levelling, paused.
const WORKING = /print|run|prepar|heat|level|calibrat|busy|paus|slic/i

// The white of the chamber light, a cool LED.
const CHAMBER = '#f4f7ff'
// The dark inside of a case.
const INK = '#141517'

// After a Bambu Lab P1S: a dark cube on a deep plinth, a glass door across
// its front and a glass lid on top, with the bed, the gantry and the
// toolhead inside. The toolhead stays up under the lid and the bed goes down
// as the print grows on it, the way a CoreXY printer works. While it prints,
// the chamber light is on and the toolhead runs to and fro. Bound to a
// sensor that gives the print's progress, the print stands as tall as it
// has got, and a finished one stays on the bed.
function Printer({ p, c, M, state, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const value = state?.value
  const counted = value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100
  const working = on || WORKING.test(state?.text ?? '') || (counted && value > 0 && value < 100)
  const progress = counted ? value / 100 : working ? 0.6 : 0
  const lit = useEased(working ? 1 : 0, 4)
  const grown = useEased(progress, 2)
  const plinth = h * 0.13
  const lid = h * 0.07
  const wall = 0.012
  const inW = w - wall * 2
  const inD = d - wall * 2
  const top = h - lid
  // The bed is two thirds of the inside across, a steel sheet on its frame.
  const bed = Math.min(inW, inD) * 0.7
  const nozzle = top - 0.085 * (h / 0.46)
  const tall = (top - plinth) * 0.5
  const printH = Math.max(tall * 0.4 * grown, 0)
  const bedY = nozzle - printH - 0.002
  const head = useRef<Group>(null)
  useLive(working)
  useFrame(({ clock }) => {
    if (!head.current) return
    const t = clock.elapsedTime
    // Two sweeps at different paces, so the head draws a figure rather
    // than a line.
    const run = working ? 1 : 0
    head.current.position.x = Math.sin(t * 2.3) * bed * 0.22 * run
    head.current.position.z = Math.sin(t * 1.7 + 1) * bed * 0.18 * run
  })
  // The X rod follows the head front to back.
  const rod = useRef<Group>(null)
  useFrame(() => {
    if (rod.current && head.current) rod.current.position.z = head.current.position.z
  })
  const glow = lit * 1.4
  return (
    <group>
      {/* The plinth, with a small screen in its front left corner. */}
      <Slab size={[w, plinth, d]} radius={0.014} bevel={0.004}>
        {M('frame')}
      </Slab>
      <mesh position={[-w * 0.3, plinth * 0.55, d / 2 + 0.0015]}>
        <planeGeometry args={[w * 0.16, plinth * 0.4]} />
        <Lit color="#0f1114" glow="#6fa8ff" strength={lit * 1.2} />
      </mesh>
      {/* The walls: sides, back and the frame round the door. */}
      {[-1, 1].map(s => (
        <Slab
          key={s}
          size={[wall, top - plinth, d]}
          radius={0.004}
          bevel={0.002}
          position={[(s * (w - wall)) / 2, plinth, 0]}
        >
          {M('frame')}
        </Slab>
      ))}
      <Slab size={[w, top - plinth, wall]} radius={0.004} bevel={0.002} position={[0, plinth, -(d - wall) / 2]}>
        {M('frame')}
      </Slab>
      {/* The lid: a dark rim round a glass top. */}
      <group position={[0, top, 0]}>
        {[-1, 1].map(s => (
          <Slab
            key={`x${s}`}
            size={[w, lid, 0.03]}
            radius={0.006}
            bevel={0.003}
            position={[0, 0, (s * (d - 0.03)) / 2]}
          >
            {M('frame')}
          </Slab>
        ))}
        {[-1, 1].map(s => (
          <Slab
            key={`z${s}`}
            size={[0.03, lid, d - 0.06]}
            radius={0.004}
            bevel={0.002}
            position={[(s * (w - 0.03)) / 2, 0, 0]}
          >
            {M('frame')}
          </Slab>
        ))}
        <mesh position={[0, lid - 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w - 0.06, d - 0.06]} />
          <Glass color={c('glass')} opacity={0.4} />
        </mesh>
      </group>
      {/* The inside: a dark floor and the chamber light along the top front. */}
      <mesh position={[0, plinth + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[inW, inD]} />
        <meshStandardMaterial color={INK} roughness={0.9} />
      </mesh>
      <mesh position={[0, top - 0.006, d / 2 - wall - 0.02]}>
        <boxGeometry args={[inW * 0.8, 0.006, 0.01]} />
        <Lit color="#d9dcde" glow={CHAMBER} strength={glow * 2.5} />
      </mesh>
      {/* The bed on its three lead screws, and the print on it. */}
      {[
        [-1, 1],
        [1, 1],
        [0, -1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * inW * 0.4, (plinth + top) / 2, sz * inD * 0.4]}>
          <cylinderGeometry args={[0.004, 0.004, top - plinth, 8]} />
          <meshStandardMaterial color="#8a8f92" metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      <group position={[0, bedY, 0]}>
        <Slab size={[bed + 0.03, 0.012, bed + 0.03]} radius={0.01} bevel={0.003} position={[0, -0.016, 0]}>
          <meshStandardMaterial color="#2a2c2e" roughness={0.6} />
        </Slab>
        <Slab size={[bed, 0.004, bed]} radius={0.006} bevel={0.001}>
          {M('bed')}
        </Slab>
        {printH > 0.002 && (
          // A hexagonal vase coming up layer by layer.
          <mesh position={[0, 0.004 + printH / 2, 0]} rotation={[0, 0.4, 0]} castShadow>
            <cylinderGeometry args={[bed * 0.15, bed * 0.12, printH, 6]} />
            {M('print')}
          </mesh>
        )}
      </group>
      {/* The gantry: a rail down each side, the X rod across between them
          and the toolhead on it. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (inW / 2 - 0.012), nozzle + 0.045, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.005, 0.005, inD - 0.02, 10]} />
          <meshStandardMaterial color="#a7abae" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      <group ref={rod}>
        <mesh position={[0, nozzle + 0.045, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.006, 0.006, inW - 0.02, 10]} />
          <meshStandardMaterial color="#202124" roughness={0.5} />
        </mesh>
      </group>
      <group ref={head}>
        <group position={[0, nozzle, 0]}>
          <Slab size={[0.05 * (w / 0.39), 0.06, 0.055]} radius={0.008} bevel={0.003} position={[0, 0.014, 0]}>
            {M('toolhead')}
          </Slab>
          {/* Its dark front and the fan grille on it. */}
          <mesh position={[0, 0.045, 0.0285]}>
            <circleGeometry args={[0.014, SEG]} />
            <meshStandardMaterial color="#2a2c2e" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.006, 0]}>
            <cylinderGeometry args={[0.002, 0.006, 0.012, 10]} />
            <meshStandardMaterial color="#c9a23a" metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      </group>
      {/* The door: a pane of tinted glass in a thin dark frame, with its
          handle up the right. */}
      <group position={[0, plinth, d / 2]}>
        <mesh position={[0, (top - plinth) / 2, 0.002]}>
          <planeGeometry args={[w - 0.02, top - plinth - 0.01]} />
          <Glass color={c('glass')} opacity={0.32} />
        </mesh>
        {[-1, 1].map(s => (
          <mesh key={s} position={[(s * (w - 0.012)) / 2, (top - plinth) / 2, 0.003]}>
            <boxGeometry args={[0.012, top - plinth, 0.006]} />
            {M('frame')}
          </mesh>
        ))}
        <mesh position={[0, top - plinth - 0.006, 0.003]}>
          <boxGeometry args={[w, 0.012, 0.006]} />
          {M('frame')}
        </mesh>
        <Slab
          size={[0.012, (top - plinth) * 0.4, 0.016]}
          radius={0.005}
          bevel={0.002}
          position={[w / 2 - 0.03, (top - plinth) * 0.3, 0.01]}
        >
          {M('frame')}
        </Slab>
      </group>
      {/* The chamber light on the inside and out through the door. */}
      <Halo on={working} position={[0, top - 0.03, d * 0.15]} color={CHAMBER} intensity={0.7} distance={1.1} />
    </group>
  )
}

// The small lights along a router's front, each lit while it is on.
function StatusRow({ count, at, gap, r, lit }: { count: number; at: Vec3; gap: number; r: number; lit: number }) {
  return (
    <group position={at}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[(i - (count - 1) / 2) * gap, 0, 0]}>
          <sphereGeometry args={[r, 10, 8]} />
          <Lit color="#3a3d40" glow={i === 0 ? '#ffffff' : '#7fe0a4'} strength={lit * 2.2} />
        </mesh>
      ))}
    </group>
  )
}

// After the TP-Link Archer AX55: a low wide box, its top a raised panel
// of ribs, a row of status lights along the front and four flat antennas
// standing up from the back and the sides. Every part scales with the width.
function AntennaRouter({ p, M, on }: Look) {
  const k = p('size') / 0.261
  const lit = useEased(on ? 1 : 0, 9)
  const [w, d, h] = [0.261, 0.135, 0.041]
  // Two antennas from the back and one from each side near the back, each
  // leaning out a little.
  const antennas: { at: Vec3; lean: Vec3 }[] = [
    { at: [-0.06, h * 0.6, -d / 2 - 0.006], lean: [-0.12, 0, -0.08] },
    { at: [0.06, h * 0.6, -d / 2 - 0.006], lean: [-0.12, 0, 0.08] },
    { at: [-w / 2 - 0.006, h * 0.6, -0.02], lean: [0, 0, 0.14] },
    { at: [w / 2 + 0.006, h * 0.6, -0.02], lean: [0, 0, -0.14] },
  ]
  return (
    <group scale={k}>
      {/* Four small feet lift it off the shelf. */}
      <Slab size={[w, h - 0.006, d]} radius={0.02} bevel={0.006} position={[0, 0.006, 0]}>
        {M('body')}
      </Slab>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}${sz}`} position={[sx * (w / 2 - 0.03), 0.003, sz * (d / 2 - 0.025)]}>
            <cylinderGeometry args={[0.008, 0.008, 0.006, 12]} />
            <meshStandardMaterial color={INK} roughness={0.9} />
          </mesh>
        )),
      )}
      {/* The ribs over the vents on top. */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[(i - 4) * 0.022, h + 0.0015, -0.01]}>
          <boxGeometry args={[0.012, 0.003, d * 0.62]} />
          {M('body')}
        </mesh>
      ))}
      <StatusRow count={6} at={[0, h * 0.5, d / 2 + 0.001]} gap={0.022} r={0.0028} lit={lit} />
      {antennas.map((a, i) => (
        <group key={i} position={a.at} rotation={a.lean}>
          {/* The hinge, then the blade with rounded ends. */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.007, 0.007, 0.018, 12]} />
            {M('antennas')}
          </mesh>
          <Slab
            size={[0.017, 0.008, 0.135]}
            radius={0.004}
            bevel={0.002}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.0675, 0.004]}
          >
            {M('antennas')}
          </Slab>
        </group>
      ))}
      <Halo on={on} position={[0, h * 0.5, d / 2 + 0.08]} color="#7fe0a4" intensity={0.03} distance={0.35} />
    </group>
  )
}

// After the Google Nest Wifi: a white puck, rounded over its top and a
// little narrower at its foot, with a soft ring of light round its top.
const PUCK_PROFILE = (() => {
  const points: [number, number][] = [
    [0, 0],
    [0.05, 0],
    [0.052, 0.004],
  ]
  // Up the side, flaring a hair, then round the shoulder onto the top.
  for (let i = 0; i <= 8; i++) points.push([0.052 + 0.003 * (i / 8), 0.004 + 0.06 * (i / 8)])
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2)
    points.push([0.035 + 0.02 * Math.cos(a), 0.064 + 0.026 * Math.sin(a)])
  }
  points.push([0, 0.09])
  return points.map(([x, y]) => new Vector2(x, y))
})()

function MeshPuck({ p, M, on }: Look) {
  const k = p('size') / 0.11
  const lit = useEased(on ? 1 : 0, 9)
  const geometry = useMemo(() => new LatheGeometry(PUCK_PROFILE, SEG * 2), [])
  return (
    <group scale={k}>
      <mesh geometry={geometry} castShadow receiveShadow>
        {M('body')}
      </mesh>
      {/* A flat cap on the top, a shade off the body, and the light ring
          round it. */}
      <mesh position={[0, 0.0904, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.034, SEG * 2]} />
        {M('top')}
      </mesh>
      <mesh position={[0, 0.0907, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.012, 0.0145, SEG * 2]} />
        <Lit color="#e4e6e8" glow="#ffffff" strength={lit * 2.4} />
      </mesh>
      <Halo on={on} position={[0, 0.12, 0]} color="#ffffff" intensity={0.03} distance={0.35} />
    </group>
  )
}

// The dashboard a wall tablet shows while it is on: a dark page of rounded
// tiles in Home Assistant's own way, some lit amber for the lights that are
// on, blue for a cover, green for a plug, each with a line of text. Drawn
// once for each way up.
const dashboards = new Map<string, CanvasTexture>()
function dashboard(portrait: boolean) {
  const key = portrait ? 'portrait' : 'landscape'
  const found = dashboards.get(key)
  if (found) return found
  const canvas = document.createElement('canvas')
  canvas.width = portrait ? 300 : 440
  canvas.height = portrait ? 440 : 300
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#111318'
    g.fillRect(0, 0, canvas.width, canvas.height)
    // The header: a title and the time.
    g.fillStyle = '#e8eaed'
    g.fillRect(18, 18, 90, 12)
    g.fillStyle = '#8a9099'
    g.fillRect(canvas.width - 64, 18, 46, 12)
    const cols = portrait ? 2 : 3
    const rows = portrait ? 5 : 3
    const pad = 14
    const tw = (canvas.width - pad * (cols + 1)) / cols
    const th = (canvas.height - 48 - pad * (rows + 1)) / rows
    const tints = [
      '#ffb74d',
      '#1c1f26',
      '#4fa3ff',
      '#1c1f26',
      '#ffb74d',
      '#66bb6a',
      '#1c1f26',
      '#1c1f26',
      '#ffb74d',
      '#4fa3ff',
    ]
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const i = r * cols + col
        const x = pad + col * (tw + pad)
        const y = 48 + pad + r * (th + pad)
        const lit = tints[i % tints.length] !== '#1c1f26'
        g.fillStyle = '#1c1f26'
        g.beginPath()
        g.roundRect(x, y, tw, th, 12)
        g.fill()
        // The icon's round badge, lit in its color when the thing is on.
        g.fillStyle = lit ? tints[i % tints.length] : '#3a3f48'
        g.beginPath()
        g.arc(x + 22, y + th / 2, 11, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#e8eaed'
        g.fillRect(x + 42, y + th / 2 - 9, tw * 0.42, 7)
        g.fillStyle = '#8a9099'
        g.fillRect(x + 42, y + th / 2 + 3, tw * 0.26, 6)
      }
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  dashboards.set(key, texture)
  return texture
}

// A tablet hung on the wall for the home's dashboard. The Flush Frame sets a
// 10.9 inch tablet into a white surround a little off the wall, and the Slim
// Portrait stands an 8 inch one upright on a small magnetic mount. On, it
// shows the dashboard, or what a player bound to it plays.
function WallTablet({ p, c, M, style, state, on }: Look) {
  const portrait = style === 'portrait'
  const w = p('width')
  // The tablet in its frame, or the tablet alone, and its screen.
  const [tw, th] = portrait ? [w, w * (0.202 / 0.137)] : [w * (0.249 / 0.28), w * (0.179 / 0.28)]
  const bezel = tw * (portrait ? 0.06 : 0.04)
  const [sw, sh] = [tw - bezel * 2, th - bezel * 2]
  const back = portrait ? 0.012 : 0.015
  const depth = portrait ? 0.008 : 0.007
  const lit = useEased(on ? 1 : 0, 6)
  const showing = state?.showing
  const page = useMemo(() => dashboard(portrait), [portrait])
  return (
    <group>
      {portrait ? (
        // The magnetic mount: a dark puck on the wall behind it.
        <mesh position={[0, 0, back / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[tw * 0.28, tw * 0.28, back, SEG]} />
          {M('frame')}
        </mesh>
      ) : (
        // The surround, laid flat and stood up so its rounding is on its face.
        <Slab size={[w, back, w * 0.75]} radius={0.01} bevel={0.004} rotation={[Math.PI / 2, 0, 0]}>
          {M('frame')}
        </Slab>
      )}
      {/* The tablet, its glass and its screen. */}
      <group position={[0, 0, back]}>
        <mesh position={[0, 0, depth / 2]}>
          <boxGeometry args={[tw, th, depth]} />
          {M('bezel')}
        </mesh>
        <mesh position={[0, 0, depth + 0.0006]}>
          <planeGeometry args={[sw, sh]} />
          {on ? (
            showing ? (
              <ScreenMaterial showing={showing} aspect={sw / sh} />
            ) : (
              <meshBasicMaterial map={page} toneMapped={false} color={[lit, lit, lit]} />
            )
          ) : (
            <meshStandardMaterial color={c('screen')} roughness={0.12} metalness={0.25} />
          )}
        </mesh>
      </group>
      <Halo on={on} position={[0, 0, 0.3]} color="#cfdcff" intensity={0.06} distance={0.9} />
    </group>
  )
}
