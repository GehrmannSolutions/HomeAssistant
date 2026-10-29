import { colorValue, decorationVariant, materialValue, paramValue, type DecorationKind } from '#/decoration/catalog.ts'
import { useEased, useTravel } from '#/scene/decor/ease.ts'
import { Glass, Halo, Material, SEG, Slab, Steam } from '#/scene/decor/parts.tsx'
import { scatter } from '#/scene/decor/scatter.ts'
import type { ItemState } from '#/scene/decor/state.ts'
import type { DecorationConfig } from '#/types.ts'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Color, ExtrudeGeometry, Object3D, Shape, type InstancedMesh } from 'three'

type Props = { kind: DecorationKind; item: DecorationConfig; state: ItemState | null }

type Look = {
  p: (id: string) => number
  c: (slot: string) => string
  M: (slot: string) => ReactNode
  style: string
  on: boolean
  // How far open, 0 to 1, eased along its travel.
  level: number
}

type Vec3 = [number, number, number]

// The larger pieces of a garden: a pergola whose roof of blades turns open
// and shut, a sauna that glows and breathes out vapor while it heats, and a
// driveway gate that opens by its cover's position.
export default function GardenModel({ kind, item, state }: Props) {
  const p = (id: string) => paramValue(kind, item.params, id, item.variant)
  const c = (slot: string) => colorValue(kind, item.colors, slot, item.variant)
  const m = (slot: string) => materialValue(kind, slot, item.variant)
  const on = state?.on ?? false
  // How far open the item is: the percentage feeding it, or its switch when
  // it has none, so a roof bound to a plain switch still opens.
  // A cover being dragged follows the finger with no easing.
  const level = useTravel(state ? (state.levels.open ?? state.level ?? (on ? 1 : 0)) : 0, undefined, state?.dragged)
  const look: Look = {
    p,
    c,
    M: (slot: string) => <Material color={c(slot)} material={m(slot)} />,
    style: decorationVariant(kind, item.variant)?.id ?? '',
    on,
    level,
  }
  switch (kind.id) {
    case 'louvred_pergola':
      return <LouvredPergola {...look} />
    case 'sauna':
      return look.style === 'cabin' ? <CabinSauna {...look} /> : <BarrelSauna {...look} />
    case 'driveway_gate':
      return look.style === 'sliding' ? <SlidingGate {...look} /> : <SwingGate {...look} />
    default:
      return null
  }
}

// The glow of a stove behind glass, on the panes and on the ground in front.
const FIRE = '#ffb070'
// A sauna's inside with the stove cold, seen through its glass.
const DUSK = '#1c140e'
const STEEL = '#6f7478'
const PIPE = '#1c1d1f'
const CONCRETE = '#8e8d88'
const GROOVE = '#2a1f17'
// Pale aspen, the wood saunas are lined and benched with.
const ASPEN = '#d8b98c'

// Many plain boxes in one draw, each placed by its middle and sized by
// scaling a unit box: the boards of a wall, the staves of a barrel. Each is
// a shade lighter or darker than the next, the way boards come off a saw.
type Board = { at: Vec3; size: Vec3; turn?: Vec3 }
function Boards({ boards, children }: { boards: Board[]; children: ReactNode }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new Object3D()
    const shade = new Color()
    boards.forEach((b, i) => {
      o.position.set(...b.at)
      o.rotation.set(...(b.turn ?? [0, 0, 0]))
      o.scale.set(...b.size)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      mesh.setColorAt(i, shade.setScalar(0.86 + scatter(i, 7) * 0.14))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [boards])
  return (
    <instancedMesh key={boards.length} ref={ref} args={[undefined, undefined, boards.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      {children}
    </instancedMesh>
  )
}

// A curved band round the z axis, from angle `from` to `to` counted from +x
// the way round toward +y, between radii `inner` and `outer`, `length` long
// and centered on z. A barrel's steel hoops and the felt over its top.
function arcShell(inner: number, outer: number, from: number, to: number, length: number) {
  const s = new Shape()
  s.moveTo(Math.cos(from) * outer, Math.sin(from) * outer)
  s.absarc(0, 0, outer, from, to, false)
  s.lineTo(Math.cos(to) * inner, Math.sin(to) * inner)
  s.absarc(0, 0, inner, to, from, true)
  s.closePath()
  const geo = new ExtrudeGeometry(s, { depth: length, bevelEnabled: false, curveSegments: 48 })
  geo.translate(0, 0, -length / 2)
  return geo
}

// A pane of glass `w` by `h` in a frame `bar` wide, its middle at the
// origin and facing +z from z = 0. With `glow`, a dark inside stands right
// behind the glass and lights up warm while the sauna heats, for a pane too
// small or too high to show the room itself.
function Pane({
  w,
  h,
  lit,
  glass,
  frame,
  bar = 0.05,
  glow = true,
}: {
  w: number
  h: number
  lit: number
  glass: string
  frame: ReactNode
  bar?: number
  glow?: boolean
}) {
  const [iw, ih] = [w - bar * 2, h - bar * 2]
  return (
    <group>
      {glow && (
        <mesh position={[0, 0, 0.004]}>
          <planeGeometry args={[iw, ih]} />
          <meshStandardMaterial color={DUSK} emissive={FIRE} emissiveIntensity={1.3 * lit} />
        </mesh>
      )}
      <mesh position={[0, 0, 0.022]}>
        <planeGeometry args={[iw, ih]} />
        <Glass color={glass} opacity={0.3} />
      </mesh>
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[(s * (w - bar)) / 2, 0, 0.022]} castShadow>
            <boxGeometry args={[bar, h, 0.044]} />
            {frame}
          </mesh>
          <mesh position={[0, (s * (h - bar)) / 2, 0.022]} castShadow>
            <boxGeometry args={[iw, bar, 0.044]} />
            {frame}
          </mesh>
        </group>
      ))}
    </group>
  )
}

// The black flue of a wood stove standing `tall` above `base`, under a rain
// cap, and the vapor it gives off while the sauna heats: one thick plume and
// a thinner one out of step with it.
function Flue({ on, at, base, tall }: { on: boolean; at: [number, number]; base: number; tall: number }) {
  const [x, z] = at
  const pipe = <Material color={PIPE} material="metal" />
  const top = base + tall
  return (
    <group>
      <mesh position={[x, base + tall / 2, z]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, tall, 20]} />
        {pipe}
      </mesh>
      {/* The collar where it passes through, and the cap on its stays. */}
      <mesh position={[x, base + 0.03, z]} castShadow>
        <cylinderGeometry args={[0.085, 0.12, 0.06, 20]} />
        {pipe}
      </mesh>
      <mesh position={[x, top + 0.09, z]} castShadow>
        <coneGeometry args={[0.13, 0.08, 20]} />
        {pipe}
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[x + s * 0.05, top + 0.025, z]}>
          <boxGeometry args={[0.008, 0.07, 0.008]} />
          {pipe}
        </mesh>
      ))}
      <Steam
        on={on}
        position={[x, top + 0.04, z]}
        radius={0.075}
        rise={1.05}
        count={8}
        strength={0.5}
        speed={0.3}
        drift={[0.06, -0.12]}
        glow={0.3}
      />
      <Steam
        on={on}
        position={[x, top + 0.04, z]}
        radius={0.05}
        rise={0.7}
        count={5}
        strength={0.4}
        speed={0.42}
        drift={[-0.05, 0.04]}
        phase={0.5}
        glow={0.3}
      />
    </group>
  )
}

// Thin wisps of hot air leaking from the top of a sauna door. The roof runs
// out over the door, `out` past it with its underside `head` above the leak,
// so they are blown outwards and only climb as far as lets them clear its
// edge on the way, instead of rising straight into it.
function DoorWisps({
  on,
  x,
  y,
  z,
  w,
  out,
  head,
}: {
  on: boolean
  x: number
  y: number
  z: number
  w: number
  out: number
  head: number
}) {
  const drift = out + 0.2
  const rise = Math.min(0.4, ((head - 0.03) * drift) / out)
  return [-1, 0, 1].map(i => (
    <Steam
      key={i}
      on={on}
      position={[x + (i * w) / 3, y, z]}
      radius={0.028}
      rise={rise}
      count={4}
      strength={0.28}
      speed={0.45 + scatter(i + 2, 31) * 0.15}
      drift={[0, drift]}
      phase={scatter(i + 2, 32)}
    />
  ))
}

// A bioclimatic pergola, after the Renson Algarve: four square posts under
// a deep beam that hides the gutter, and a roof of aluminium blades running
// across the width. Shut, the blades lie flat edge to edge and keep the
// rain off; open, each turns on its own long axis until it stands on edge
// and lets the sky through.
function LouvredPergola({ p, M, style, level }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const timber = style === 'timber'
  const post = timber ? 0.18 : 0.15
  const beamH = 0.22
  // The beam runs round the top as deep as the posts are thick.
  const beamT = post
  const yb = h - beamH
  const inW = w - beamT * 2
  const inD = d - beamT * 2
  // Blades about every 20 centimeters across the depth, a hair narrower
  // than their pitch so that neighbors never touch as they turn.
  const n = Math.max(2, Math.round(inD / 0.2))
  const pitch = inD / n
  const bladeW = pitch - 0.004
  const bladeL = inW - 0.1
  // The pivots sit low enough in the beam that an upright blade still
  // stays under its top edge.
  const pivotY = h - bladeW / 2 - 0.012
  const blade = useMemo(() => {
    // An airfoil across the blade: arched a little, thickest in the middle.
    const s = new Shape()
    const steps = 12
    const at = (i: number, side: number): [number, number] => {
      const u = -1 + (2 * i) / steps
      const arch = 0.008 * (1 - u * u)
      const t = 0.004 + 0.011 * (1 - u * u)
      return [(u * bladeW) / 2, arch + side * t]
    }
    s.moveTo(...at(0, -1))
    for (let i = 1; i <= steps; i++) s.lineTo(...at(i, -1))
    for (let i = steps; i >= 0; i--) s.lineTo(...at(i, 1))
    const geo = new ExtrudeGeometry(s, { depth: bladeL, bevelEnabled: false })
    // Extruded along z, so turned to run along x.
    geo.translate(0, 0, -bladeL / 2)
    geo.rotateY(Math.PI / 2)
    return geo
  }, [bladeW, bladeL])
  // The timber louvres turn, up to a few degrees short of upright, as the
  // real ones stop. The aluminium roof slides instead: its slats run along
  // the rails to the back and pack there on edge, and the roof is open
  // to the sky from the front as far as they have gone.
  const turn = timber ? level * 1.48 : level * 1.4
  const packPitch = 0.032
  const packZ = (i: number) => -inD / 2 + 0.03 + (i + 0.5) * packPitch
  const [px, pz] = [w / 2 - post / 2, d / 2 - post / 2]
  return (
    <group>
      {[-1, 1].map(sx =>
        [-1, 1].map(sz => (
          <group key={`${sx}${sz}`}>
            <Slab
              size={[post, yb, post]}
              radius={timber ? 0.008 : 0.012}
              bevel={0.004}
              position={[sx * px, 0, sz * pz]}
            >
              {M('frame')}
            </Slab>
            {/* The foot plate bolted to the terrace. */}
            <mesh position={[sx * px, 0.006, sz * pz]} receiveShadow>
              <boxGeometry args={[post + 0.07, 0.012, post + 0.07]} />
              <Material color={PIPE} material="metal" />
            </mesh>
            {timber &&
              // Knee braces from each post up into the beam, both ways in.
              [
                {
                  at: [sx * (px - post / 2 - 0.2), yb - 0.2, sz * pz] as Vec3,
                  turn: [0, 0, -sx * (Math.PI / 4)] as Vec3,
                },
                {
                  at: [sx * px, yb - 0.2, sz * (pz - post / 2 - 0.2)] as Vec3,
                  turn: [sz * (Math.PI / 4), 0, 0] as Vec3,
                },
              ].map((b, i) => (
                <mesh key={i} position={b.at} rotation={b.turn} castShadow>
                  <boxGeometry args={i === 0 ? [0.62, 0.08, 0.08] : [0.08, 0.08, 0.62]} />
                  {M('frame')}
                </mesh>
              ))}
          </group>
        )),
      )}
      {/* The beam round the top: front and back full width, the sides in
          between, with the gutter channel let into its top. */}
      {[-1, 1].map(s => (
        <group key={s}>
          <Slab size={[w, beamH, beamT]} radius={0.006} bevel={0.004} position={[0, yb, s * (d / 2 - beamT / 2)]}>
            {M('frame')}
          </Slab>
          <Slab size={[beamT, beamH, inD]} radius={0.004} bevel={0.004} position={[s * (w / 2 - beamT / 2), yb, 0]}>
            {M('frame')}
          </Slab>
          <mesh position={[0, h + 0.001, s * (d / 2 - beamT / 2)]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w - 0.04, beamT - 0.05]} />
            <meshStandardMaterial color={PIPE} roughness={0.8} />
          </mesh>
          <mesh position={[s * (w / 2 - beamT / 2), h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[beamT - 0.05, inD]} />
            <meshStandardMaterial color={PIPE} roughness={0.8} />
          </mesh>
          {/* The rail along the inside of each end that carries the pivots
              and the rod that turns every blade at once. */}
          <mesh position={[s * (inW / 2 - 0.025), pivotY - 0.02, 0]} castShadow>
            <boxGeometry args={[0.05, 0.07, inD]} />
            {M('frame')}
          </mesh>
        </group>
      ))}
      {/* Where the downpipe inside a post lets out at its foot. */}
      <mesh position={[px - post / 2 - 0.03, 0.05, pz]} castShadow>
        <boxGeometry args={[0.06, 0.03, 0.05]} />
        {M('frame')}
      </mesh>
      {Array.from({ length: n }, (_, i) => {
        const shut = -inD / 2 + (i + 0.5) * pitch
        const z = timber ? shut : shut + (packZ(i) - shut) * level
        return (
          <mesh key={i} geometry={blade} position={[0, pivotY, z]} rotation={[turn, 0, 0]} castShadow receiveShadow>
            {M('louvres')}
          </mesh>
        )
      })}
    </group>
  )
}

// A barrel sauna, after the Thermory Barrel: cedar staves round a
// horizontal drum on two cradles, held by steel hoops, a strip of felt
// shingle over its top, a glass door in the front end and the stove's flue
// out of the top at the back. While it heats the glass glows and it
// breathes vapor out of the flue and round the door.
function BarrelSauna({ p, c, M, on }: Look) {
  const w = p('width')
  const L = p('depth')
  const h = p('height')
  const lit = useEased(on ? 1 : 0, 2)
  // The drum is as wide as the sauna, and the cradles lift it clear of the
  // ground by whatever height is left over, so a taller sauna stands its
  // barrel higher rather than swelling it.
  const R = w / 2
  const lift = Math.max(0.1, h - R * 2)
  const cy = lift + R
  const stave = 0.045
  const ri = R - stave
  // How far the staves run past each end wall, the barrel's lip.
  const inset = 0.08
  const staves = useMemo(() => {
    const N = 28
    return Array.from({ length: N }, (_, i): Board => {
      const a = (i / N) * Math.PI * 2
      const r = R - stave / 2
      return {
        at: [Math.sin(a) * r, cy + Math.cos(a) * r, 0],
        size: [(Math.PI * 2 * R) / N, stave, L],
        turn: [0, 0, -a],
      }
    })
  }, [R, cy, L])
  // The felt over the top third, and the hoops round the rest.
  const felt = useMemo(() => arcShell(R - 0.002, R + 0.012, Math.PI / 6, (Math.PI * 5) / 6, L + 0.03), [R, L])
  const hoop = useMemo(() => arcShell(R - 0.002, R + 0.007, (Math.PI * 5) / 6, (Math.PI * 13) / 6, 0.04), [R])
  const hoops = L > 1.6 ? [-L / 2 + 0.3, 0, L / 2 - 0.3] : [-L / 2 + 0.25, L / 2 - 0.25]
  // Each cradle is a board with the drum's curve cut out of its top.
  const cradle = useMemo(() => {
    const cw = R * 1.5
    const edge = cy - Math.sqrt(R * R - (cw / 2) ** 2)
    const s = new Shape()
    s.moveTo(-cw / 2, 0)
    s.lineTo(cw / 2, 0)
    s.lineTo(cw / 2, edge)
    s.absarc(0, cy, R, Math.atan2(edge - cy, cw / 2), Math.atan2(edge - cy, -cw / 2), true)
    s.closePath()
    const geo = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 32 })
    geo.translate(0, 0, -0.06)
    return geo
  }, [R, cy])
  // The joints between the vertical boards of both end walls.
  const ends = L / 2 - inset
  const grooves = useMemo(() => {
    const out: Board[] = []
    const cols = Math.max(4, Math.round((ri * 2) / 0.12))
    for (let i = 1; i < cols; i++) {
      const x = -ri + (i * ri * 2) / cols
      const tall = 2 * Math.sqrt(Math.max(ri * ri - x * x, 0)) - 0.02
      for (const s of [-1, 1]) out.push({ at: [x, cy, s * (ends + 0.021)], size: [0.006, tall, 0.004] })
    }
    return out
  }, [ri, cy, ends])
  // The door, as tall as the curve lets it be.
  const dw = Math.min(0.62, ri * 1.1)
  const doorY = cy - R * 0.78
  const doorTop = Math.min(doorY + 1.8, cy + Math.sqrt(Math.max(ri * ri - (dw / 2 + 0.08) ** 2, 0)) - 0.04)
  const doorH = doorTop - doorY
  const front = ends + 0.02
  const flueX = R * 0.35
  const flueZ = -L / 2 + Math.min(0.6, L * 0.25)
  return (
    <group>
      <Boards boards={staves}>{M('wood')}</Boards>
      <mesh geometry={felt} position={[0, cy, 0]} castShadow>
        {M('roof')}
      </mesh>
      {hoops.map(z => (
        <mesh key={z} geometry={hoop} position={[0, cy, z]} castShadow>
          <Material color={STEEL} material="metal" />
        </mesh>
      ))}
      {[-1, 1].map(s => (
        <mesh key={s} geometry={cradle} position={[0, 0, s * (L / 2 - 0.4)]} castShadow receiveShadow>
          {M('wood')}
        </mesh>
      ))}
      {/* The two round end walls, set in behind the lip of the staves. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[0, cy, s * ends]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[ri + 0.004, ri + 0.004, 0.04, SEG * 2]} />
          {M('wood')}
        </mesh>
      ))}
      <Boards boards={grooves}>
        <meshStandardMaterial color={GROOVE} roughness={0.9} />
      </Boards>
      <group position={[0, doorY + doorH / 2, front]}>
        <Pane w={dw} h={doorH} lit={lit} glass={c('glass')} frame={M('wood')} bar={0.06} />
        <mesh position={[dw / 2 - 0.11, 0, 0.07]} castShadow>
          <boxGeometry args={[0.03, 0.34, 0.03]} />
          {M('wood')}
        </mesh>
      </group>
      {/* A small window high in the back wall. */}
      <group position={[0, cy + R * 0.25, -front]} rotation={[0, Math.PI, 0]}>
        <Pane w={0.42} h={0.36} lit={lit} glass={c('glass')} frame={M('wood')} />
      </group>
      <Flue on={on} at={[flueX, flueZ]} base={cy + Math.sqrt(R * R - flueX * flueX) - 0.01} tall={0.55} />
      <DoorWisps on={on} x={0} y={doorTop} z={front + 0.06} w={dw} out={inset} head={cy + ri - doorTop} />
      <Halo on={on} position={[0, doorY + doorH / 2, L / 2 + 0.4]} color={FIRE} intensity={0.6} distance={2.6} />
    </group>
  )
}

// A garden sauna cabin, after the Nordic sheds of Kontio: vertical boards
// with battens over their joints on low concrete footings, a single pitch
// roof falling to the back and overhanging the front, and a front of glass
// with a glass door, the benches and the stove plain to see behind it.
function CabinSauna({ p, c, M, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const lit = useEased(on ? 1 : 0, 2)
  const lift = 0.12
  const y0 = lift + 0.08
  const roofT = 0.12
  const yF = h - roofT - 0.04
  const yB = yF - Math.max(0.3, d * 0.16)
  const top = (z: number) => yB + ((yF - yB) * (z + d / 2)) / d
  // Board thickness, and the corner posts and beams of the glass front.
  const BT = 0.05
  const POST = 0.1
  const boards = useMemo(() => {
    const out: Board[] = []
    const top = (z: number) => yB + ((yF - yB) * (z + d / 2)) / d
    const bw = 0.14
    const nb = Math.max(1, Math.round(w / bw))
    const bx = w / nb
    const tall = yB - y0
    for (let i = 0; i < nb; i++) {
      out.push({ at: [-w / 2 + (i + 0.5) * bx, y0 + tall / 2, -d / 2 + BT / 2], size: [bx, tall, BT] })
      if (i > 0) out.push({ at: [-w / 2 + i * bx, y0 + tall / 2, -d / 2 - 0.01], size: [0.04, tall, 0.02] })
    }
    const run = d - POST
    const ns = Math.max(1, Math.round(run / bw))
    const bz = run / ns
    for (const s of [-1, 1]) {
      for (let j = 0; j < ns; j++) {
        const z = -d / 2 + (j + 0.5) * bz
        const up = top(z + bz / 2) - y0
        out.push({ at: [s * (w / 2 - BT / 2), y0 + up / 2, z], size: [BT, up, bz] })
        if (j > 0) {
          const jt = top(z - bz / 2) - y0
          out.push({ at: [s * (w / 2 + 0.01), y0 + jt / 2, z - bz / 2], size: [0.02, jt, 0.04] })
        }
      }
    }
    return out
  }, [w, d, y0, yB, yF])
  // The roof lies on the line of the wall tops and runs past it.
  const slope = Math.atan2(yF - yB, d)
  const [ohF, ohB, ohS] = [0.35, 0.15, 0.15]
  const roofTop = (z: number) => top(z) + roofT / Math.cos(slope)
  // The glass front, between the corner posts, the head and the sill.
  const [gx0, gx1] = [-w / 2 + POST, w / 2 - POST]
  const [gy0, gy1] = [y0 + 0.06, yF - 0.08]
  const gh = gy1 - gy0
  const dw = Math.min(0.68, (gx1 - gx0) * 0.45)
  const MUL = 0.06
  const fixedW = gx1 - gx0 - dw - MUL
  const glassZ = d / 2 - POST / 2 - 0.02
  // The stove in the front corner by the fixed pane, and its flue.
  const stove = { x: gx0 + BT + 0.22, z: d / 2 - POST - 0.3, w: 0.4, h: 0.7, d: 0.36 }
  const flueZ = stove.z - stove.d / 2 + 0.07
  const bench = { w: w - BT * 2 - 0.02, x: 0 }
  const wood = M('wood')
  return (
    <group>
      {[-1, 0, 1].map(i =>
        [-1, 1].map(s => (
          <mesh key={`${i}${s}`} position={[i * (w / 2 - 0.12), lift / 2, s * (d / 2 - 0.12)]} castShadow receiveShadow>
            <boxGeometry args={[0.2, lift, 0.2]} />
            <Material color={CONCRETE} material="concrete" />
          </mesh>
        )),
      )}
      {/* The floor frame, its top the floor inside. */}
      <Slab size={[w, y0 - lift, d]} radius={0.01} bevel={0.004} position={[0, lift, 0]}>
        {wood}
      </Slab>
      <Boards boards={boards}>{wood}</Boards>
      {/* The glass front: corner posts, the head beam over them and the
          mullion between the fixed pane and the door. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (w / 2 - POST / 2), (y0 + yF) / 2, d / 2 - POST / 2]} castShadow>
          <boxGeometry args={[POST, yF - y0, POST]} />
          {wood}
        </mesh>
      ))}
      <mesh position={[0, yF - 0.04, d / 2 - POST / 2]} castShadow>
        <boxGeometry args={[w, 0.08, POST]} />
        {wood}
      </mesh>
      <mesh position={[0, y0 + 0.03, d / 2 - POST / 2]} castShadow>
        <boxGeometry args={[w - POST * 2, 0.06, POST]} />
        {wood}
      </mesh>
      <mesh position={[gx0 + fixedW + MUL / 2, (gy0 + gy1) / 2, d / 2 - POST / 2]} castShadow>
        <boxGeometry args={[MUL, gh, POST * 0.8]} />
        {wood}
      </mesh>
      <group position={[gx0 + fixedW / 2, (gy0 + gy1) / 2, glassZ]}>
        <Pane w={fixedW} h={gh} lit={lit} glass={c('glass')} frame={wood} bar={0.03} glow={false} />
      </group>
      <group position={[gx1 - dw / 2, (gy0 + gy1) / 2, glassZ]}>
        <Pane w={dw} h={gh} lit={lit} glass={c('glass')} frame={wood} bar={0.06} glow={false} />
        <mesh position={[-dw / 2 + 0.11, 0, 0.07]} castShadow>
          <boxGeometry args={[0.03, 0.4, 0.03]} />
          {wood}
        </mesh>
      </group>
      {/* A small window in the right side wall. */}
      <group position={[w / 2 + 0.001, y0 + 1.25, -d * 0.15]} rotation={[0, Math.PI / 2, 0]}>
        <Pane w={0.5} h={0.35} lit={lit} glass={c('glass')} frame={wood} />
      </group>
      <group position={[0, (yF + yB) / 2, 0]} rotation={[-slope, 0, 0]}>
        <Slab
          size={[w + ohS * 2, roofT, d / Math.cos(slope) + ohF + ohB]}
          radius={0.01}
          bevel={0.004}
          position={[0, 0, (ohF - ohB) / 2]}
        >
          {M('roof')}
        </Slab>
      </group>
      {/* Inside: the back wall warming with the stove, two tiers of benches
          in pale aspen, and the stove with its basket of stones. */}
      <mesh position={[0, (y0 + yB) / 2, -d / 2 + BT + 0.002]}>
        <planeGeometry args={[w - BT * 2, yB - y0]} />
        <meshStandardMaterial color={ASPEN} roughness={0.8} emissive={FIRE} emissiveIntensity={0.35 * lit} />
      </mesh>
      {[
        { y: y0 + 0.85, z: -d / 2 + BT + 0.26, deep: 0.52 },
        { y: y0 + 0.45, z: -d / 2 + BT + 0.52 + 0.22, deep: 0.44 },
      ].map((b, i) => (
        <group key={i}>
          <Slab size={[bench.w, 0.045, b.deep]} radius={0.006} bevel={0.003} position={[bench.x, b.y, b.z]}>
            <Material color={ASPEN} material="wood" />
          </Slab>
          <mesh position={[bench.x, (y0 + b.y) / 2, b.z + b.deep / 2 - 0.03]} castShadow>
            <boxGeometry args={[bench.w, b.y - y0, 0.025]} />
            <Material color={ASPEN} material="wood" />
          </mesh>
        </group>
      ))}
      <Slab size={[stove.w, stove.h, stove.d]} radius={0.01} bevel={0.004} position={[stove.x, y0, stove.z]}>
        <Material color={PIPE} material="metal" />
      </Slab>
      <mesh position={[stove.x, y0 + stove.h * 0.35, stove.z + stove.d / 2 + 0.002]}>
        <planeGeometry args={[stove.w * 0.5, stove.h * 0.25]} />
        <meshStandardMaterial color={DUSK} emissive={FIRE} emissiveIntensity={2 * lit} />
      </mesh>
      <Slab
        size={[stove.w - 0.04, 0.12, stove.d - 0.04]}
        radius={0.04}
        bevel={0.03}
        position={[stove.x, y0 + stove.h, stove.z]}
      >
        <Material color="#7c7a76" material="concrete" />
      </Slab>
      <mesh position={[stove.x, (y0 + stove.h + roofTop(flueZ)) / 2, flueZ]}>
        <cylinderGeometry args={[0.06, 0.06, roofTop(flueZ) - y0 - stove.h, 20]} />
        <Material color={PIPE} material="metal" />
      </mesh>
      <Flue on={on} at={[stove.x, flueZ]} base={roofTop(flueZ) - 0.01} tall={0.6} />
      <DoorWisps on={on} x={gx1 - dw / 2} y={gy1} z={d / 2 + 0.05} w={dw} out={ohF} head={top(d / 2) - gy1} />
      <Halo on={on} position={[0, y0 + 1.2, 0]} color={FIRE} intensity={0.7} distance={2.8} />
      <Halo on={on} position={[0, y0 + 1, d / 2 + 0.5]} color={FIRE} intensity={0.4} distance={2.5} />
    </group>
  )
}

// A driveway gate stands across its opening along x, between two square
// steel posts, its street side toward -z. How far it is open is the cover's
// position, eased along its travel the way the other covers are.
const GATE_POST = 0.12
// How far the leaves clear the ground.
const GATE_FOOT = 0.06

function GatePost({ x, h, M }: { x: number; h: number; M: Look['M'] }) {
  return (
    <group position={[x, 0, 0]}>
      <Slab size={[GATE_POST, h, GATE_POST]} radius={0.008} bevel={0.004}>
        {M('posts')}
      </Slab>
      {/* A flat cap over the top of the tube. */}
      <Slab size={[GATE_POST + 0.02, 0.012, GATE_POST + 0.02]} radius={0.008} bevel={0.003} position={[0, h, 0]}>
        {M('posts')}
      </Slab>
    </group>
  )
}

// A frame of square tube round a rectangle `w` by `h` standing on its
// bottom edge, centered on x and on its own thickness.
function TubeFrame({ w, h, t, M }: { w: number; h: number; t: number; M: Look['M'] }) {
  return (
    <group>
      <Slab size={[w, t, t]} radius={0.004} bevel={0.002}>
        {M('frame')}
      </Slab>
      <Slab size={[w, t, t]} radius={0.004} bevel={0.002} position={[0, h - t, 0]}>
        {M('frame')}
      </Slab>
      {[-1, 1].map(s => (
        <Slab key={s} size={[t, h - t * 2, t]} radius={0.004} bevel={0.002} position={[(s * (w - t)) / 2, t, 0]}>
          {M('frame')}
        </Slab>
      ))}
    </group>
  )
}

// A pair of leaves hung on the posts, each a steel frame filled with
// horizontal boards with a finger's gap between them. They swing into the
// drive, toward +z, or out to the street with the switch.
function SwingGate({ p, M, level }: Look) {
  const w = p('width')
  const h = p('height')
  const way = p('back') > 0.5 ? -1 : 1
  const t = 0.05
  // A hand's gap at each post and between the leaves.
  const lw = w / 2 - 0.045
  const lh = h - GATE_FOOT
  const boards = Math.max(3, Math.round((lh - t * 2) / 0.1))
  const pitch = (lh - t * 2) / boards
  const leaf = (
    <group>
      <TubeFrame w={lw} h={lh} t={t} M={M} />
      {Array.from({ length: boards }, (_, i) => (
        <mesh key={i} position={[0, t + pitch * (i + 0.5), 0]} castShadow receiveShadow>
          <boxGeometry args={[lw - t * 2, pitch - 0.018, 0.022]} />
          {M('infill')}
        </mesh>
      ))}
      {/* A diagonal brace in the frame would show through the gaps, so the
          leaf is held square by a middle rail instead. */}
      <Slab size={[lw - t * 2, t * 0.7, t * 0.7]} radius={0.004} bevel={0.002} position={[0, lh / 2, -t * 0.4]}>
        {M('frame')}
      </Slab>
    </group>
  )
  return (
    <group>
      {[-1, 1].map(s => (
        <GatePost key={s} x={s * (w / 2 + GATE_POST / 2)} h={h + 0.08} M={M} />
      ))}
      {/* Each leaf turns on its post, square to the opening when open. */}
      {[1, -1].map(side => (
        <group
          key={side}
          position={[(-side * w) / 2, GATE_FOOT, 0]}
          rotation={[0, -side * way * (Math.PI / 2) * level, 0]}
        >
          <group position={[side * (0.03 + lw / 2), 0, 0]}>{leaf}</group>
          {/* The hinge pins on the post side. */}
          {[0.15, lh - 0.15].map(y => (
            <mesh key={y} position={[side * 0.015, y, 0]}>
              <cylinderGeometry args={[0.014, 0.014, 0.09, 12]} />
              {M('posts')}
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// A cantilever gate: one long leaf of upright bars on a deep bottom beam,
// that runs on the rollers of the post beside the opening, out along the
// fence behind it, to the right or to the left with the switch.
function SlidingGate({ p, M, level }: Look) {
  const w = p('width')
  const h = p('height')
  // 1 slides to the right, -1 to the left.
  const side = p('flip') > 0.5 ? -1 : 1
  const t = 0.06
  const beam = 0.14
  // The leaf reaches past the opening at its tail, where the rollers hold it.
  const tail = Math.min(1.2, w * 0.3)
  const lw = w + tail
  const lh = h - GATE_FOOT
  const bars = Math.max(4, Math.round((lw - t) / 0.12))
  const pitch = (lw - t * 2) / bars
  // The leaf runs behind the posts, on the street side.
  const z = -GATE_POST / 2 - t / 2 - 0.02
  // Shut, it spans the opening from post to post with its tail past the
  // post on the side it opens to, behind the fence there. Open, it has run
  // that way by the whole opening.
  const x = side * (lw / 2 - w / 2 + w * level)
  return (
    <group>
      {[-1, 1].map(s => (
        <GatePost key={s} x={s * (w / 2 + GATE_POST / 2)} h={h + 0.08} M={M} />
      ))}
      {/* The roller post the leaf runs through, past the near post, and the
          carriage on the ground under it. */}
      <GatePost x={side * (w / 2 + tail - 0.1)} h={h * 0.6} M={M} />
      {[w / 2 + 0.25, w / 2 + tail - 0.1].map(at => (
        <Slab key={at} size={[0.22, 0.08, 0.16]} radius={0.01} bevel={0.004} position={[side * at, 0, z]}>
          {M('posts')}
        </Slab>
      ))}
      <group position={[x, GATE_FOOT, z]}>
        <TubeFrame w={lw} h={lh} t={t} M={M} />
        <Slab size={[lw, beam, t + 0.01]} radius={0.006} bevel={0.003} position={[0, 0.02, 0]}>
          {M('frame')}
        </Slab>
        {Array.from({ length: bars - 1 }, (_, i) => (
          <mesh
            key={i}
            position={[-lw / 2 + t + pitch * (i + 1), beam + (lh - beam - t) / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.03, lh - beam - t, 0.03]} />
            {M('infill')}
          </mesh>
        ))}
      </group>
    </group>
  )
}
