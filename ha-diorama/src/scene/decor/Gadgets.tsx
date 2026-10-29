import {
  colorValue,
  decorationVariant,
  materialValue,
  paramValue,
  screenSize,
  type DecorationKind,
} from '#/decoration/catalog.ts'
import { useEased } from '#/scene/decor/ease.ts'
import { Glass, Halo, Led, Material, SEG, Slab, Spinner, Tube } from '#/scene/decor/parts.tsx'
import { useBeamScene } from '#/scene/decor/beam.ts'
import ScreenMaterial, { ScreenGlow } from '#/scene/decor/Screen.tsx'
import { useThrow } from '#/scene/decor/throw.ts'
import type { ItemState } from '#/scene/decor/state.ts'
import type { DecorationConfig } from '#/types.ts'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Object3D,
  type Group,
  type InstancedMesh,
  type Material as ThreeMaterial,
  type Mesh,
} from 'three'

type Props = { kind: DecorationKind; item: DecorationConfig; state: ItemState | null }

type Look = {
  p: (id: string) => number
  c: (slot: string) => string
  M: (slot: string) => ReactNode
  style: string
  on: boolean
}

type Vec3 = [number, number, number]

// The computers and the small things round them: a desktop tower, an open
// laptop, a charging pad with whatever is on it, and a projector that sits
// against the wall and throws its picture up it.
export default function GadgetModel({ kind, item, state }: Props) {
  const p = (id: string) => paramValue(kind, item.params, id, item.variant)
  const c = (slot: string) => colorValue(kind, item.colors, slot, item.variant)
  const m = (slot: string) => materialValue(kind, slot, item.variant)
  const look: Look = {
    p,
    c,
    M: (slot: string) => <Material color={c(slot)} material={m(slot)} />,
    style: decorationVariant(kind, item.variant)?.id ?? '',
    on: state?.on ?? false,
  }
  switch (kind.id) {
    case 'pc_tower':
      return look.style === 'lattice' ? <LatticeTower {...look} /> : <GlassTower {...look} />
    case 'laptop':
      return <Laptop {...look} />
    case 'wireless_charger':
      switch (look.style) {
        case 'watch':
          return <WatchPuck {...look} />
        case 'earbuds':
          return <BudDock {...look} />
        case 'tablet':
          return <TabletEasel {...look} />
        default:
          return <PhonePad {...look} />
      }
    case 'projector_ust':
      return <ShortThrow {...look} />
    default:
      return null
  }
}

// The dark of the inside of a case, of a bezel and of a screen that is off.
const INK = '#0d0e10'
// The cool white a screen that is only showing its lock screen gives off.
const LOCK_GLOW = '#9fb8e8'

// A part that lights itself in `glow` by `strength`, over its own `color`.
function Lit({ color, glow, strength }: { color: string; glow: string; strength: number }) {
  return <meshStandardMaterial color={color} emissive={glow} emissiveIntensity={strength} roughness={0.4} />
}

// A slab stood on its edge: `w` across, `h` tall and `t` thick, its bottom
// at `position` and centered on it in depth. A Slab rounds the corners it
// sees from above, so a panel is made lying down and stood up, which puts
// the rounding on its face where it shows.
function Upright({
  size,
  radius,
  bevel,
  position = [0, 0, 0],
  children,
}: {
  size: Vec3
  radius: number
  bevel: number
  position?: Vec3
  children: ReactNode
}) {
  const [w, h, t] = size
  return (
    <group position={[position[0], position[1] + h / 2, position[2] + t / 2]}>
      <Slab size={[w, t, h]} radius={radius} bevel={bevel} rotation={[-Math.PI / 2, 0, 0]}>
        {children}
      </Slab>
    </group>
  )
}

// Many copies of one small shape, each at its own place and scale, in a
// single draw: the keys of a keyboard, the dimples of a pierced front.
function Instances({
  items,
  shadow = false,
  children,
}: {
  items: { at: Vec3; scale: Vec3 }[]
  shadow?: boolean
  children: ReactNode
}) {
  const mesh = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const o = new Object3D()
    items.forEach((it, i) => {
      o.position.set(...it.at)
      o.scale.set(...it.scale)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [items])
  return (
    <instancedMesh key={items.length} ref={mesh} args={[undefined, undefined, items.length]} castShadow={shadow}>
      {children}
    </instancedMesh>
  )
}

// A case fan `f` square facing +z, its middle at `position`: a square frame
// round a round opening, seven pitched blades on a hub that spin while the
// machine runs, and a ring of light round the blades on each face.
function Fan({ f, position, lit, accent }: { f: number; position: Vec3; lit: number; accent: string }) {
  const fd = Math.min(0.025, f * 0.2)
  const r = f * 0.44
  const ring = <Lit color="#24272b" glow={accent} strength={2.5 * lit} />
  return (
    <group position={position}>
      <group position={[0, 0, -fd / 2]}>
        <Slab
          size={[f, fd, f]}
          radius={f * 0.08}
          bevel={0.002}
          rotation={[Math.PI / 2, 0, 0]}
          holes={[{ x: 0, z: 0, w: r * 2, d: r * 2, r: r - 0.001 }]}
        >
          <meshStandardMaterial color="#141517" roughness={0.6} />
        </Slab>
      </group>
      {[-1, 1].map(s => (
        <mesh key={s} position={[0, 0, (s * fd) / 2]}>
          <torusGeometry args={[r * 0.97, f * 0.018, 8, SEG]} />
          {ring}
        </mesh>
      ))}
      {/* The blades turn about z, so they are laid in the xz plane of a
          group stood up onto it. */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        <Spinner speed={lit * 16}>
          <mesh>
            <cylinderGeometry args={[r * 0.34, r * 0.34, fd * 0.8, 24]} />
            <meshStandardMaterial color="#1b1d20" roughness={0.5} />
          </mesh>
          {Array.from({ length: 7 }, (_, i) => (
            <group key={i} rotation={[0, (i / 7) * Math.PI * 2, 0]}>
              <mesh position={[r * 0.64, 0, 0]} rotation={[0.55, 0, 0]}>
                <boxGeometry args={[r * 0.62, 0.0015, r * 0.42]} />
                <Lit color="#2a2d31" glow={accent} strength={0.35 * lit} />
              </mesh>
            </group>
          ))}
        </Spinner>
      </group>
    </group>
  )
}

// A black mid tower gaming case: a box on four short feet, a solid front
// with a strip of light down it, and a tinted glass side on the left
// showing the build inside. Behind the glass are the board on the far
// wall, a tower cooler with its own fan, a long graphics card across the
// middle, the power supply shroud along the floor and three intake fans
// lined up inside the front.
function GlassTower({ p, c, M, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const lit = useEased(on ? 1 : 0, 3)
  const accent = c('accent')
  const foot = 0.012
  const H = h - foot
  const t = 0.012
  const skin = 0.004
  // The inside runs from the glass to the right hand wall, and from the
  // back to the front panel.
  const inL = -w / 2 + skin
  const inR = w / 2 - t
  const front = d / 2 - 0.022
  const back = -d / 2 + t
  const f = Math.min(w - 0.04, (H - 0.05) / 3)
  const fanZ = front - Math.min(0.025, f * 0.2) / 2 - 0.003
  const shroudH = Math.min(0.09, H * 0.19)
  const shroudBack = back
  const shroudFront = fanZ - 0.03
  const boardD = (front - back) * 0.66
  const boardZ = back + 0.01 + boardD / 2
  const coolerW = (inR - inL) * 0.42
  const coolerH = H * 0.24
  const coolerY = foot + H * 0.6
  const gpuW = (inR - inL) * 0.62
  const gpuD = Math.min(0.3, boardD * 0.95)
  const gpuY = foot + H * 0.34
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}:${sz}`} position={[sx * (w / 2 - 0.03), foot / 2, sz * (d / 2 - 0.05)]} castShadow>
            <cylinderGeometry args={[0.014, 0.016, foot, 16]} />
            <meshStandardMaterial color={INK} roughness={0.9} />
          </mesh>
        )),
      )}
      {/* The shell: floor, roof, the right hand wall, the back and the front. */}
      <Slab size={[w, t, d]} radius={0.01} bevel={0.003} position={[0, foot, 0]}>
        {M('case')}
      </Slab>
      <Slab size={[w, t, d]} radius={0.01} bevel={0.003} position={[0, h - t, 0]}>
        {M('case')}
      </Slab>
      <Slab size={[t, H, d]} radius={0.004} bevel={0.002} position={[w / 2 - t / 2, foot, 0]}>
        {M('case')}
      </Slab>
      <Upright size={[w, H, t]} radius={0.004} bevel={0.002} position={[0, foot, -d / 2 + t / 2]}>
        {M('case')}
      </Upright>
      <Upright size={[w, H, 0.022]} radius={0.01} bevel={0.003} position={[0, foot, d / 2 - 0.011]}>
        {M('case')}
      </Upright>
      {/* The mesh down the front and the strip of light beside it. */}
      <mesh position={[-w * 0.08, foot + H / 2, d / 2 + 0.0005]}>
        <planeGeometry args={[w * 0.6, H * 0.86]} />
        <meshStandardMaterial color="#111214" roughness={0.95} />
      </mesh>
      <mesh position={[w * 0.33, foot + H / 2, d / 2 + 0.001]}>
        <boxGeometry args={[0.006, H * 0.86, 0.002]} />
        <Lit color="#24272b" glow={accent} strength={3 * lit} />
      </mesh>
      <Led on={on} position={[w * 0.33, h - 0.004, d / 2 - 0.03]} color="#e8f2f6" radius={0.004} />
      {/* The glass side, tinted, over the whole left. */}
      <mesh position={[-w / 2 + skin / 2, foot + H / 2, 0]}>
        <boxGeometry args={[skin, H - 0.004, d - 0.004]} />
        <Glass color={c('glass')} opacity={0.35} />
      </mesh>
      {/* The board on the far wall, the shroud over the power supply and a
          lit strip along its edge. */}
      <mesh position={[inR - 0.002, foot + H * 0.58, boardZ]}>
        <boxGeometry args={[0.003, H * 0.7, boardD]} />
        <meshStandardMaterial color="#1b1e22" roughness={0.7} />
      </mesh>
      <Slab
        size={[inR - inL, shroudH, shroudFront - shroudBack]}
        radius={0.004}
        bevel={0.002}
        position={[(inL + inR) / 2, foot + t, (shroudBack + shroudFront) / 2]}
      >
        {M('case')}
      </Slab>
      <mesh position={[inL + 0.004, foot + t + shroudH - 0.01, (shroudBack + shroudFront) / 2]}>
        <boxGeometry args={[0.002, 0.004, (shroudFront - shroudBack) * 0.8]} />
        <Lit color="#24272b" glow={accent} strength={2 * lit} />
      </mesh>
      {/* A tower cooler off the board: a block of aluminium fins with a fan
          on its front. */}
      <group position={[inR - 0.004 - coolerW / 2, coolerY, boardZ + 0.02]}>
        <mesh castShadow>
          <boxGeometry args={[coolerW, coolerH, 0.06]} />
          <meshStandardMaterial color="#9a9ea3" roughness={0.35} metalness={0.6} />
        </mesh>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} position={[-coolerW / 2 - 0.0005, -coolerH * 0.42 + (i * coolerH * 0.84) / 6, 0]}>
            <boxGeometry args={[0.001, 0.002, 0.058]} />
            <meshStandardMaterial color="#5c6166" />
          </mesh>
        ))}
        <mesh position={[0, coolerH / 2 + 0.004, 0]}>
          <boxGeometry args={[coolerW, 0.008, 0.062]} />
          <meshStandardMaterial color="#17191c" roughness={0.5} />
        </mesh>
        <Fan f={Math.min(coolerH, coolerW)} position={[0, 0, 0.045]} lit={lit} accent={accent} />
      </group>
      {/* The graphics card, a long dark shroud with a lit line on the face
          toward the glass. */}
      <group position={[inR - 0.004 - gpuW / 2, gpuY, boardZ + 0.03]}>
        <Slab size={[gpuW, 0.05, gpuD]} radius={0.006} bevel={0.003}>
          <meshStandardMaterial color="#26292d" roughness={0.45} metalness={0.3} />
        </Slab>
        <mesh position={[-gpuW / 2 - 0.0008, 0.034, 0]}>
          <boxGeometry args={[0.002, 0.004, gpuD * 0.7]} />
          <Lit color="#24272b" glow={accent} strength={2.5 * lit} />
        </mesh>
      </group>
      {/* Three intake fans stacked up the inside of the front. */}
      {[0, 1, 2].map(i => (
        <Fan
          key={i}
          f={f}
          position={[(inL + inR) / 2, foot + t + 0.012 + f / 2 + i * f, fanZ]}
          lit={lit}
          accent={accent}
        />
      ))}
      <Halo on={on} position={[-w / 2 - 0.12, foot + H * 0.55, 0]} color={accent} intensity={0.08} distance={0.8} />
    </group>
  )
}

// An aluminium tower after the Mac Pro: a plain block on four short feet,
// the whole front pierced with a lattice of round dimples, and two
// polished handles arching over the top. When it runs a soft light shows
// through the lattice and the little power light comes on.
function LatticeTower({ p, c, M, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const lit = useEased(on ? 1 : 0, 3)
  const foot = 0.022
  const H = h - foot
  const pitch = Math.max(0.016, Math.min(0.024, w / 10))
  // The dimples on a staggered grid, and the holes in the gaps between
  // each three of them, where the light comes through.
  const { balls, holes } = useMemo(() => {
    const rowH = pitch * 0.866
    const cols = Math.floor((w - 0.03) / pitch)
    const rows = Math.floor((H - 0.03) / rowH)
    const x0 = -((cols - 1) * pitch) / 2
    const y0 = foot + (H - (rows - 1) * rowH) / 2
    const r = pitch * 0.46
    const balls: { at: Vec3; scale: Vec3 }[] = []
    const holes: { at: Vec3; scale: Vec3 }[] = []
    for (let j = 0; j < rows; j++) {
      const shift = j % 2 ? pitch / 4 : -pitch / 4
      for (let i = 0; i < cols; i++) {
        const x = x0 + i * pitch + shift
        const y = y0 + j * rowH
        balls.push({ at: [x, y, d / 2], scale: [r, r, r * 0.42] })
        if (i < cols - 1 && j < rows - 1)
          holes.push({ at: [x + pitch / 2, y + rowH / 3, d / 2 + 0.0004], scale: [1, 1, 1] })
      }
    }
    return { balls, holes }
  }, [w, d, H, pitch])
  const handleZ = d / 2 - 0.035
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}:${sz}`} position={[sx * (w / 2 - 0.025), foot / 2, sz * (d / 2 - 0.04)]} castShadow>
            <cylinderGeometry args={[0.012, 0.014, foot, 16]} />
            {M('case')}
          </mesh>
        )),
      )}
      <Slab size={[w, H, d - 0.004]} radius={0.018} bevel={0.006} position={[0, foot, -0.002]}>
        {M('case')}
      </Slab>
      {/* The pierced front: a dark face behind, the dimples on it, and the
          holes between them lit from within. */}
      <mesh position={[0, foot + H / 2, d / 2 - 0.001]}>
        <planeGeometry args={[w - 0.02, H - 0.02]} />
        <meshStandardMaterial color="#2a2c2e" roughness={0.6} />
      </mesh>
      <Instances items={balls}>
        <sphereGeometry args={[1, 12, 8]} />
        {M('glass')}
      </Instances>
      <Instances items={holes}>
        <circleGeometry args={[pitch * 0.14, 10]} />
        <Lit color="#16171a" glow={c('accent')} strength={1.3 * lit} />
      </Instances>
      {/* The two handles over the top, front and back. */}
      {[-1, 1].map(s => (
        <Tube
          key={s}
          radius={0.007}
          points={[
            [-w * 0.42, h - 0.004, s * handleZ],
            [-w * 0.36, h + 0.03, s * handleZ],
            [0, h + 0.042, s * handleZ],
            [w * 0.36, h + 0.03, s * handleZ],
            [w * 0.42, h - 0.004, s * handleZ],
          ]}
        >
          <meshStandardMaterial color="#d9dcde" roughness={0.2} metalness={0.85} />
        </Tube>
      ))}
      <mesh position={[w * 0.28, h + 0.001, -d * 0.2]}>
        <cylinderGeometry args={[0.008, 0.008, 0.003, 24]} />
        {M('case')}
      </mesh>
      <Led on={on} position={[w * 0.28 + 0.014, h, -d * 0.2]} color="#f2f6ff" radius={0.0025} />
      <Halo on={on} position={[0, foot + H * 0.5, d / 2 + 0.1]} color={c('accent')} intensity={0.06} />
    </group>
  )
}

// An open laptop: a base with the keyboard and trackpad, and the lid
// raised to about 105 degrees on a hinge along the back, the screen inside
// it in a thin black bezel. The slim one is a thin aluminium slab; the
// gaming one is thicker, black and squarer, with vents at the back, keys
// that glow and a lit strip along its front edge.
function Laptop({ p, c, M, style, on }: Look) {
  const gaming = style === 'gaming'
  const w = p('width')
  const d = w * 0.7
  const t = gaming ? 0.024 : 0.015
  const lt = gaming ? 0.012 : 0.006
  const lh = d * 0.96
  const lit = useEased(on ? 1 : 0, 4)
  const accent = gaming ? c('accent') : '#ffffff'
  // The hinge of the gaming one sits forward of the back, over its vents.
  const hingeZ = -d / 2 + (gaming ? 0.028 : 0.004)
  const open = (105 - 90) * (Math.PI / 180)
  const bezel = gaming ? 0.01 : 0.007
  const chin = gaming ? 0.02 : 0.016
  const kw = w * 0.84
  const keys = useMemo(() => {
    const cols = 14
    const pitch = kw / cols
    const size = pitch * 0.8
    const z0 = hingeZ + (gaming ? 0.012 : 0.02) + pitch * 0.35
    const out: { at: Vec3; scale: Vec3 }[] = []
    // A short row of function keys, then four full rows and the bottom row
    // round the space bar.
    for (let i = 0; i < cols; i++) {
      out.push({ at: [-kw / 2 + pitch * (i + 0.5), t, z0], scale: [size, 0.0015, size * 0.5] })
    }
    for (let r = 0; r < 4; r++) {
      const z = z0 + pitch * 0.55 + pitch * (r + 0.5)
      for (let i = 0; i < cols; i++) {
        out.push({ at: [-kw / 2 + pitch * (i + 0.5), t, z], scale: [size, 0.0015, size] })
      }
    }
    const zb = z0 + pitch * 0.55 + pitch * 4.5
    for (const i of [0, 1, 2, 3, 10, 11, 12, 13]) {
      out.push({ at: [-kw / 2 + pitch * (i + 0.5), t, zb], scale: [size, 0.0015, size] })
    }
    out.push({ at: [-kw / 2 + pitch * 7, t, zb], scale: [pitch * 6 - pitch * 0.2, 0.0015, size] })
    return { out, end: zb + pitch / 2 }
  }, [kw, t, hingeZ, gaming])
  const padD = Math.max(0.03, d / 2 - 0.012 - keys.end)
  const body = gaming ? 0.004 : 0.01
  return (
    <group>
      <Slab size={[w, t, d]} radius={body} bevel={gaming ? 0.002 : 0.004} position={[0, 0, 0]}>
        {M('body')}
      </Slab>
      {/* The keyboard well and the keys in it. */}
      <mesh position={[0, t + 0.0003, (hingeZ + keys.end) / 2 + 0.006]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[kw + 0.01, keys.end - hingeZ - 0.004]} />
        <meshStandardMaterial color={INK} roughness={0.8} />
      </mesh>
      <Instances items={keys.out}>
        <boxGeometry args={[1, 1, 1]} />
        {gaming ? <Lit color={c('keys')} glow={accent} strength={1.4 * lit} /> : M('keys')}
      </Instances>
      <mesh position={[0, t + 0.0004, keys.end + padD / 2 + 0.004]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * (gaming ? 0.3 : 0.4), padD]} />
        <meshStandardMaterial color={new Color(c('body')).multiplyScalar(0.82)} roughness={0.3} />
      </mesh>
      {gaming && (
        <>
          {/* Vents across the back behind the hinge, a slot in each back
              corner, and the lit strip along the front edge. */}
          {Array.from({ length: 9 }, (_, i) => (
            <mesh key={i} position={[-w * 0.3 + (i * w * 0.6) / 8, t + 0.0004, -d / 2 + 0.012]}>
              <boxGeometry args={[w * 0.045, 0.001, 0.012]} />
              <meshStandardMaterial color="#050506" />
            </mesh>
          ))}
          {[-1, 1].map(s => (
            <mesh key={s} position={[s * w * 0.36, t / 2, -d / 2 - 0.0005]}>
              <boxGeometry args={[w * 0.18, t * 0.45, 0.002]} />
              <meshStandardMaterial color="#050506" />
            </mesh>
          ))}
          <mesh position={[0, t * 0.45, d / 2 + 0.0008]}>
            <boxGeometry args={[w * 0.7, 0.002, 0.002]} />
            <Lit color="#24272b" glow={accent} strength={3 * lit} />
          </mesh>
        </>
      )}
      {/* The hinge, and the lid raised on it. */}
      <mesh position={[0, t + 0.002, hingeZ - lt / 2]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[lt * 0.6 + 0.002, lt * 0.6 + 0.002, w * 0.72, 16]} />
        {gaming ? M('body') : <meshStandardMaterial color="#1b1c1e" roughness={0.5} />}
      </mesh>
      <group position={[0, t, hingeZ]} rotation={[-open, 0, 0]}>
        <Upright size={[w, lh, lt]} radius={body} bevel={gaming ? 0.002 : 0.0025} position={[0, 0, -lt / 2]}>
          {M('body')}
        </Upright>
        <mesh position={[0, lh / 2, 0.0003]}>
          <planeGeometry args={[w - 0.006, lh - 0.006]} />
          <meshStandardMaterial color={INK} roughness={0.3} />
        </mesh>
        <mesh position={[0, chin + (lh - chin - bezel) / 2, 0.0006]}>
          <planeGeometry args={[w - bezel * 2, lh - chin - bezel]} />
          {on ? <ScreenMaterial /> : <meshStandardMaterial color={c('screen')} roughness={0.12} metalness={0.25} />}
        </mesh>
        <mesh position={[0, lh - bezel / 2, 0.0006]}>
          <circleGeometry args={[0.0014, 12]} />
          <meshStandardMaterial color="#1e2a33" />
        </mesh>
        {gaming && (
          <mesh position={[0, lh * 0.55, -lt - 0.0005]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[w * 0.08, w * 0.08]} />
            <Lit color="#24272b" glow={accent} strength={2 * lit} />
          </mesh>
        )}
      </group>
      <Halo on={on} position={[0, t + lh * 0.45, hingeZ + 0.12]} color="#cfe0ff" intensity={0.05} />
    </group>
  )
}

// The charging light: a thin ring round the pad that glows while it
// charges and stays faintly lit when it is waiting.
function ChargeRing({ r, y, lit, color }: { r: number; y: number; lit: number; color: string }) {
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[r, 0.0014, 8, SEG * 2]} />
      <Lit color="#2b2e31" glow={color} strength={0.15 + 1.6 * lit} />
    </mesh>
  )
}

// What is on the pad fades in as it comes down onto it to charge and fades
// out as it lifts away when it stops, since a charger that is off is one
// with nothing on it. Plain paint is shared across the whole scene, so each
// part under here is given a copy of its own to fade; while it is solid the
// copy writes depth again, so it never shows through itself.
function Arriving({ lit, children }: { lit: number; children: ReactNode }) {
  const group = useRef<Group>(null)
  useLayoutEffect(() => {
    group.current?.traverse(o => {
      const mesh = o as Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material)) return
      const own = mesh.userData.own as ThreeMaterial | undefined
      if (mesh.material !== own) {
        own?.dispose()
        mesh.material = mesh.material.clone()
        mesh.userData.own = mesh.material
      }
      const m = mesh.material as ThreeMaterial
      m.transparent = lit < 0.98
      m.opacity = lit
      m.depthWrite = lit >= 0.98
    })
  }, [lit])
  return (
    <group ref={group} position={[0, (1 - lit) * 0.02, 0]} visible={lit > 0.02}>
      {children}
    </group>
  )
}

// A round fabric pad a finger thick, and while it charges a phone lying on
// it face up, its lock screen glowing, the camera bump underneath hanging
// out past the pad's edge.
function PhonePad({ p, c, M, on }: Look) {
  const s = p('size')
  const lit = useEased(on ? 1 : 0, 4)
  const pad = 0.009
  const [pw, pt, pl] = [0.072, 0.008, 0.147]
  return (
    <group>
      <Slab size={[s, pad, s]} radius={s / 2} bevel={0.003}>
        {M('pad')}
      </Slab>
      <ChargeRing r={s * 0.44} y={pad + 0.0002} lit={lit} color={c('ring')} />
      <Arriving lit={lit}>
        <Slab size={[pw, pt, pl]} radius={0.011} bevel={0.003} position={[0, pad, 0]}>
          {M('device')}
        </Slab>
        <Slab
          size={[0.03, 0.002, 0.03]}
          radius={0.008}
          bevel={0.0008}
          position={[-0.012, pad - 0.002, -pl / 2 + 0.021]}
        >
          {M('device')}
        </Slab>
        <mesh position={[0, pad + pt + 0.0003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[pw - 0.006, pl - 0.006]} />
          <Lit color={INK} glow={LOCK_GLOW} strength={0.45 * lit} />
        </mesh>
        {/* The clock on the lock screen and the camera cutout above it. */}
        <mesh position={[0, pad + pt + 0.0005, -pl * 0.28]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[pw * 0.45, 0.012]} />
          <Lit color="#dfe7f5" glow="#ffffff" strength={0.7 * lit} />
        </mesh>
        <mesh position={[0, pad + pt + 0.0005, -pl / 2 + 0.011]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.02, 0.005]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
      </Arriving>
      <Halo on={on} position={[0, 0.05, 0]} color={c('ring')} intensity={0.04} distance={0.35} />
    </group>
  )
}

// A small white puck, and while it charges a smartwatch lying on it face
// up, its strap draping down on either side to the table.
function WatchPuck({ p, c, M, on }: Look) {
  const s = p('size')
  const lit = useEased(on ? 1 : 0, 4)
  const puck = 0.012
  const [bw, bt, bl] = [0.04, 0.011, 0.045]
  const top = puck + bt
  return (
    <group>
      <mesh position={[0, puck / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[s / 2, s / 2 + 0.001, puck, SEG * 2]} />
        {M('pad')}
      </mesh>
      <ChargeRing r={s * 0.4} y={puck + 0.0002} lit={lit} color={c('ring')} />
      <Arriving lit={lit}>
        <Slab size={[bw, bt, bl]} radius={0.011} bevel={0.0035} position={[0, puck, 0]}>
          {M('device')}
        </Slab>
        <mesh position={[0, top + 0.0003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[bw - 0.008, bl - 0.008]} />
          <Lit color={INK} glow={LOCK_GLOW} strength={0.6 * lit} />
        </mesh>
        <mesh position={[bw / 2 + 0.001, puck + bt * 0.6, -0.006]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.0032, 0.0032, 0.004, 16]} />
          {M('device')}
        </mesh>
        {/* The strap, a flat band out of each end, curling down to the
            table. A round tube pressed flat makes the band. */}
        {[-1, 1].map(sz => (
          <group key={sz} scale={[2.8, 1, 1]}>
            <Tube
              radius={0.0035}
              points={[
                [0, puck + bt * 0.5, sz * (bl / 2 - 0.003)],
                [0, puck + bt * 0.35, sz * (bl / 2 + 0.012)],
                [0, puck * 0.55, sz * (s / 2 + 0.008)],
                [0, 0.0035, sz * (s / 2 + 0.03)],
              ]}
            >
              {M('device')}
            </Tube>
          </group>
        ))}
      </Arriving>
      <Halo on={on} position={[0, 0.05, 0]} color={c('ring')} intensity={0.03} distance={0.3} />
    </group>
  )
}

// A small square fabric pad, and while it charges an earbuds case lying on
// it, a rounded pill with the seam of its lid and a small green light.
function BudDock({ p, c, M, on }: Look) {
  const s = p('size')
  const lit = useEased(on ? 1 : 0, 4)
  const pad = 0.008
  const [cw, ct, cl] = [0.06, 0.022, 0.045]
  return (
    <group>
      <Slab size={[s, pad, s]} radius={s * 0.18} bevel={0.0025}>
        {M('pad')}
      </Slab>
      <ChargeRing r={s * 0.38} y={pad + 0.0002} lit={lit} color={c('ring')} />
      <Arriving lit={lit}>
        <Slab size={[cw, ct, cl]} radius={0.016} bevel={0.009} position={[0, pad, 0]}>
          {M('device')}
        </Slab>
        <mesh position={[0, pad + ct + 0.0002, -cl / 2 + 0.013]}>
          <boxGeometry args={[cw * 0.82, 0.0006, 0.0008]} />
          <meshStandardMaterial color="#b9bab8" />
        </mesh>
        <Led on={on} position={[0, pad + ct - 0.0005, 0.006]} color="#8fd6a0" radius={0.0018} />
      </Arriving>
      <Halo on={on} position={[0, 0.05, 0]} color={c('ring')} intensity={0.03} distance={0.3} />
    </group>
  )
}

// A metal easel: a flat base, a ledge with a lip along its front and a
// back plate leaning about 20 degrees, propped on a strut behind. While it
// charges a tablet stands on the ledge in landscape against the plate,
// its screen faintly lit. With no tablet the charging coil's ring shows on
// the plate.
function TabletEasel({ p, c, M, on }: Look) {
  const s = p('size')
  const lit = useEased(on ? 1 : 0, 4)
  const lean = (20 * Math.PI) / 180
  const base = 0.006
  const ledge = 0.004
  const zf = s * 0.17
  const oy = base + ledge
  const [tw, th, tt] = [0.25, 0.18, 0.006]
  const plateH = s * 0.8
  // Where the strut meets the back of the plate, in the room's frame.
  const up = plateH * 0.6
  const strutTop: Vec3 = [
    0,
    oy + up * Math.cos(lean) - 0.006 * Math.sin(lean),
    zf - up * Math.sin(lean) - 0.006 * Math.cos(lean),
  ]
  return (
    <group>
      <Slab size={[s * 0.9, base, s * 0.6]} radius={0.012} bevel={0.002}>
        {M('pad')}
      </Slab>
      <Slab size={[s * 0.9, ledge, 0.022]} radius={0.003} bevel={0.001} position={[0, base, zf - 0.002]}>
        {M('pad')}
      </Slab>
      <Slab size={[s * 0.9, 0.012, 0.003]} radius={0.0014} bevel={0.001} position={[0, base, zf + 0.0075]}>
        {M('pad')}
      </Slab>
      <Tube
        radius={0.0035}
        points={[strutTop, [0, strutTop[1] * 0.5, (strutTop[2] - s * 0.26) / 2 - 0.004], [0, base, -s * 0.26]]}
      >
        {M('pad')}
      </Tube>
      <group position={[0, oy, zf]} rotation={[-lean, 0, 0]}>
        <Upright size={[s * 0.6, plateH, 0.005]} radius={0.01} bevel={0.0015} position={[0, -0.004, -0.003]}>
          {M('pad')}
        </Upright>
        <mesh position={[0, plateH * 0.55, -0.0003]}>
          <torusGeometry args={[0.018, 0.0012, 8, SEG]} />
          <Lit color="#2b2e31" glow={c('ring')} strength={0.15 + 1.6 * lit} />
        </mesh>
        <Arriving lit={lit}>
          <Upright size={[tw, th, tt]} radius={0.012} bevel={0.002} position={[0, 0, tt / 2]}>
            {M('device')}
          </Upright>
          <mesh position={[0, th / 2, tt + 0.0003]}>
            <planeGeometry args={[tw - 0.016, th - 0.016]} />
            <Lit color={INK} glow={LOCK_GLOW} strength={0.5 * lit} />
          </mesh>
          <mesh position={[0, th * 0.66, tt + 0.0005]}>
            <planeGeometry args={[tw * 0.28, 0.022]} />
            <Lit color="#dfe7f5" glow="#ffffff" strength={0.7 * lit} />
          </mesh>
        </Arriving>
      </group>
      <Halo on={on} position={[0, th * 0.6, zf + 0.12]} color={LOCK_GLOW} intensity={0.05} />
    </group>
  )
}

// The light an ultra short throw projector sends up the wall: a fan from
// the slot of its lens, `from` wide and at `lens`, spreading toward the
// edges of a picture `pw` by `ph` with its bottom at `y0` on the plane
// `z`, and gone before it lands there. It adds to what is behind it and
// fades as it climbs, carrying the fade in its vertex alpha the way the
// ceiling projector's beam does, so its far end never shows as a dark box
// on the card's see through canvas, and it cuts and shimmers like that
// beam, since the same kind of picture is playing.
function WallThrow({
  lens,
  from,
  pw,
  ph,
  y0,
  z,
  strength,
}: {
  lens: Vec3
  from: number
  pw: number
  ph: number
  y0: number
  z: number
  strength: number
}) {
  const material = useBeamScene(0.24 * strength)
  const geometry = useMemo(() => {
    const rows = 24
    const positions: number[] = []
    const colors: number[] = []
    const index: number[] = []
    const near = [
      [-from / 2, lens[1], lens[2] - 0.004],
      [from / 2, lens[1], lens[2] - 0.004],
      [from / 2, lens[1], lens[2] + 0.004],
      [-from / 2, lens[1], lens[2] + 0.004],
    ]
    // The far corners: the bottom edge and the top edge of the picture.
    const far = [
      [-pw / 2, y0, z],
      [pw / 2, y0, z],
      [pw / 2, y0 + ph, z],
      [-pw / 2, y0 + ph, z],
    ]
    // Drawn most of the way to the picture, brightest just out of the
    // slot and faded to nothing before the end.
    const reach = 0.85
    for (let i = 0; i <= rows; i++) {
      const t = i / rows
      const k = t * reach
      const fade = Math.pow(1 - t, 1.8) * Math.min(1, t * 5 + 0.2)
      for (let q = 0; q < 4; q++) {
        positions.push(
          near[q][0] + (far[q][0] - near[q][0]) * k,
          near[q][1] + (far[q][1] - near[q][1]) * k,
          near[q][2] + (far[q][2] - near[q][2]) * k,
        )
        colors.push(1, 1, 1, fade)
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let q = 0; q < 4; q++) {
        const a = i * 4 + q
        const b = i * 4 + ((q + 1) % 4)
        index.push(a, b, b + 4, a, b + 4, a + 4)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new Float32BufferAttribute(colors, 4))
    g.setIndex(index)
    return g
  }, [lens, from, pw, ph, y0, z])
  if (strength < 0.01) return null
  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial
        ref={material}
        color="#eef3ff"
        vertexColors
        transparent
        opacity={0.24 * strength}
        blending={AdditiveBlending}
        depthWrite={false}
        side={DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}

// An ultra short throw projector: a low rounded box on a cabinet a hand
// from the wall, a fabric grille across its front, and at the back of its
// top a dark recessed window the light leaves by, straight up. When it is
// on a fan of light climbs the wall above it, widening toward where the
// picture would land, the way the ceiling projector's beam does.
function ShortThrow({ p, c, M, on }: Look) {
  const lit = useEased(on ? 1 : 0, 3)
  const W = 0.6
  const D = 0.35
  const H = 0.13
  const foot = 0.008
  const top = foot + H
  const r = 0.05
  const [pw, ph] = screenSize(p('inches'))
  const wallZ = -(D / 2 + 0.08)
  const y0 = top + 0.25
  const lensZ = -D / 2 + 0.06
  const lens: Vec3 = useMemo(() => [0, top + 0.001, lensZ], [top, lensZ])
  const aim = useRef<Group>(null)
  useThrow(aim, 1.2, lit)
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}:${sz}`} position={[sx * (W / 2 - 0.07), foot / 2, sz * (D / 2 - 0.06)]}>
            <cylinderGeometry args={[0.018, 0.02, foot, 16]} />
            <meshStandardMaterial color={INK} roughness={0.9} />
          </mesh>
        )),
      )}
      <Slab size={[W, H, D]} radius={r} bevel={0.014} position={[0, foot, 0]}>
        {M('body')}
      </Slab>
      {/* The grille, a band of fabric across the front. */}
      <Upright
        size={[W - r * 2, H * 0.56, 0.008]}
        radius={0.004}
        bevel={0.002}
        position={[0, foot + H * 0.2, D / 2 - 0.002]}
      >
        {M('grille')}
      </Upright>
      {/* The lens window, sunk in a darker tray at the back of the top. */}
      <Slab size={[W * 0.4, 0.003, 0.1]} radius={0.02} bevel={0.001} position={[0, top - 0.002, lensZ]}>
        {M('grille')}
      </Slab>
      <Slab size={[W * 0.33, 0.003, 0.07]} radius={0.014} bevel={0.001} position={[0, top - 0.0005, lensZ]}>
        <meshStandardMaterial
          color={c('lens')}
          roughness={0.08}
          metalness={0.3}
          emissive="#cfe4f5"
          emissiveIntensity={1.4 * lit}
        />
      </Slab>
      <Led on={on} position={[W * 0.38, top, D / 2 - 0.04]} color="#e8f2f6" radius={0.003} />
      {/* The light on its way up the wall. */}
      <WallThrow lens={lens} from={W * 0.28} pw={pw} ph={ph} y0={y0} z={wallZ + 0.002} strength={lit} />
      {/* Where the picture lands, as seen from a meter out in front of it,
          for a projection screen hung across it to find. */}
      <group ref={aim} position={[0, y0 + ph / 2, wallZ + 1]} rotation={[0, Math.PI, 0]} />
      <ScreenGlow on={on} position={[0, y0 + ph * 0.35, wallZ + 0.35]} intensity={0.6} distance={3} />
    </group>
  )
}
