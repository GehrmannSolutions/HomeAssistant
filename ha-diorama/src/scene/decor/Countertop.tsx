import { colorValue, decorationVariant, materialValue, paramValue, type DecorationKind } from '#/decoration/catalog.ts'
import { roundedShape } from '#/geometry/polygon.ts'
import { useEased } from '#/scene/decor/ease.ts'
import { Bar, Halo, Led, Material, SEG, Slab, Spinner, Steam, Tube } from '#/scene/decor/parts.tsx'
import type { ItemState } from '#/scene/decor/state.ts'
import type { DecorationConfig } from '#/types.ts'
import { useMemo, type ReactNode } from 'react'
import { Color, ExtrudeGeometry, LatheGeometry, Vector2 } from 'three'

type Props = { kind: DecorationKind; item: DecorationConfig; state: ItemState | null }

type Look = {
  p: (id: string) => number
  c: (slot: string) => string
  M: (slot: string) => ReactNode
  style: string
  on: boolean
}

type Vec3 = [number, number, number]

// The small appliances that stand on a worktop and show they are on by
// heating up: a toaster, a cooking robot and an air fryer.
export default function CountertopModel({ kind, item, state }: Props) {
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
    case 'toaster':
      return look.style === 'long' ? <LongToaster {...look} /> : <RetroToaster {...look} />
    case 'cooking_robot':
      return look.style === 'bowl' ? <DomeCooker {...look} /> : <JugCooker {...look} />
    case 'air_fryer':
      return <AirFryer {...look} dual={look.style === 'dual'} />
    default:
      return null
  }
}

// The dark inside of a slot or a vent.
const SLOT = '#141516'
// The orange red of a glowing heating element.
const HEAT = '#ff4d1f'
// The warm light a hot appliance throws round it.
const WARM = '#ff8a4a'
// The cool white of a lit touchscreen.
const SCREEN = '#c6f1ff'
// Bread before and after it browns.
const BREAD = '#e6c790'
const TOAST = '#a4622a'

// A solid turned about the y axis from [radius, height] pairs, bottom up.
function Turned({
  profile,
  position,
  children,
}: {
  profile: [number, number][]
  position?: Vec3
  children: ReactNode
}) {
  const key = profile.flat().join(',')
  const geometry = useMemo(() => {
    const at = key.split(',').map(Number)
    const points = Array.from({ length: at.length / 2 }, (_, i) => new Vector2(at[i * 2], at[i * 2 + 1]))
    return new LatheGeometry(points, SEG)
  }, [key])
  return (
    <mesh geometry={geometry} position={position} castShadow receiveShadow>
      {children}
    </mesh>
  )
}

// A body drawn from its side: an outline of [z, y] points, counter clockwise
// from the back of its foot, its corners rounded by `radius`, pushed `length`
// along x and centred on it. Every edge is softened by `bevel`, which also
// grows the outline by that much, so the points are given that far inside
// the real outline.
function Profile({
  points,
  length,
  radius,
  bevel,
  children,
}: {
  points: [number, number][]
  length: number
  radius: number
  bevel: number
  children: ReactNode
}) {
  const key = points.flat().join(',')
  const geometry = useMemo(() => {
    const at = key.split(',').map(Number)
    const outline = Array.from({ length: at.length / 2 }, (_, i): [number, number] => [at[i * 2], at[i * 2 + 1]])
    const geo = new ExtrudeGeometry(roundedShape(outline, radius), {
      depth: Math.max(length - bevel * 2, 0.001),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 8,
      curveSegments: 16,
    })
    // The outline lies on XY with its x as the depth, and is pushed along +z.
    // A quarter turn about y makes that depth run along z and the push run
    // toward -x, and the shift centres it.
    geo.rotateY(-Math.PI / 2)
    geo.translate(length / 2 - bevel, 0, 0)
    return geo
  }, [key, length, radius, bevel])
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      {children}
    </mesh>
  )
}

// Where a panel on a slope sits: the middle of the line from `a` to `b`,
// both [z, y], and the turn about x that lays a flat part's top along it.
function onSlope(a: [number, number], b: [number, number]) {
  const [dz, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = Math.hypot(dz, dy)
  // The outward normal, toward the front and up.
  const [nz, ny] = [dy / length, -dz / length]
  return {
    position: [0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2] as Vec3,
    turn: Math.atan2(nz, ny),
    length,
  }
}

// One toaster slot let into a body: its lining, with the element wires
// glowing on both long walls, a floor over the crumb tray, and the slices
// standing in it. `x` and `z` are its middle, `L` its length and `s` its
// width, from `floor` up to `top`. `slices` is how many sit end to end, and
// `rise` how far they stand above where they rest when the lever is down.
function ToastSlot({
  x,
  z,
  L,
  s,
  floor,
  top,
  slices,
  rise,
  lit,
}: {
  x: number
  z: number
  L: number
  s: number
  floor: number
  top: number
  slices: number
  rise: number
  lit: number
}) {
  const wall = top - floor - 0.004
  const bread = Math.min(0.12, top - floor - 0.02)
  const each = L / slices
  const crust = new Color(BREAD).lerp(new Color(TOAST), lit * 0.8)
  const lining = <meshStandardMaterial color={SLOT} emissive={HEAT} emissiveIntensity={0.35 * lit} roughness={0.8} />
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, floor / 2, 0]}>
        <boxGeometry args={[L, floor, s]} />
        <meshStandardMaterial color={SLOT} roughness={0.9} />
      </mesh>
      {[-1, 1].map(side => (
        <group
          key={side}
          position={[0, floor + wall / 2, side * (s / 2 - 0.0008)]}
          rotation={[0, side > 0 ? Math.PI : 0, 0]}
        >
          <mesh>
            <planeGeometry args={[L - s * 0.6, wall]} />
            {lining}
          </mesh>
          {/* The element wires, strung across the wall. */}
          {Array.from({ length: 5 }, (_, i) => (
            <mesh key={i} position={[0, (i - 2) * wall * 0.17, 0.0006]}>
              <planeGeometry args={[L - s, 0.0025]} />
              <meshStandardMaterial color="#3a2a24" emissive={HEAT} emissiveIntensity={2.4 * lit} />
            </mesh>
          ))}
        </group>
      ))}
      {Array.from({ length: slices }, (_, i) => (
        <Slab
          key={i}
          size={[each - 0.016, bread, 0.013]}
          radius={0.006}
          bevel={0.003}
          position={[(i - (slices - 1) / 2) * each, top - 0.012 - bread + rise, 0]}
        >
          <meshStandardMaterial color={crust} roughness={0.95} />
        </Slab>
      ))}
    </group>
  )
}

// Where a toaster's slots lie across its depth. Two side by side, each `s`
// wide and `gap` from the middle, while the body is deep enough to leave a
// wall outside them, and a single one down the middle when it is not.
const toastSlots = (d: number, s: number, gap: number) =>
  d < (s + gap) * 2 + 0.05 ? [0] : [-1, 1].map(k => k * (s / 2 + gap))

// A two slice toaster in the fifties manner, after the Smeg TSF01: a soft
// rounded body, its top edges well rounded, on a polished base, two slots
// side by side along its length, and on its right end the lever and a
// browning dial. While it is on the lever is down, the bread with it, and
// the elements glow in the slots.
function RetroToaster({ p, M, on }: Look) {
  const w = p('width')
  const lit = useEased(on ? 1 : 0, 2.2)
  const press = useEased(on ? 1 : 0, 6)
  const d = Math.max(0.09, p('depth'))
  const h = Math.min(0.24, Math.max(0.16, w * 0.64))
  const plinth = 0.016
  // The lever stands out from the right end, so the body gives it room.
  const bw = w - 0.03
  const endX = bw / 2
  const L = bw * 0.55
  const s = 0.034
  const slots = toastSlots(d, s, 0.013)
  const top = h
  const lever = h - 0.05 + (plinth + 0.045 - (h - 0.05)) * press
  return (
    <group>
      <group position={[-0.015, 0, 0]}>
        <Slab size={[bw - 0.006, plinth, d - 0.006]} radius={Math.min(0.05, d / 2 - 0.01)} bevel={0.004}>
          {M('trim')}
        </Slab>
        <Slab
          size={[bw, h - plinth, d]}
          // A shallow body cannot be rounded by more than half its depth.
          radius={Math.min(0.055, d / 2 - 0.006)}
          bevel={0.012}
          position={[0, plinth, 0]}
          holes={slots.map(z => ({ x: 0, z, w: L, d: s, r: s / 2 - 0.002 }))}
        >
          {M('body')}
        </Slab>
        {slots.map(z => (
          <ToastSlot
            key={z}
            x={0}
            z={z}
            L={L}
            s={s}
            floor={plinth + 0.035}
            top={top}
            slices={1}
            rise={0.055 * (1 - press)}
            lit={lit}
          />
        ))}
        {/* The lever's track down the right end, and the lever in it. */}
        <mesh position={[endX + 0.0006, (plinth + h) / 2, 0.012]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.008, h - plinth - 0.07]} />
          <meshStandardMaterial color={SLOT} />
        </mesh>
        <Slab size={[0.03, 0.016, 0.03]} radius={0.008} bevel={0.004} position={[endX + 0.01, lever - 0.008, 0.012]}>
          {M('trim')}
        </Slab>
        {/* The browning dial, its pointer, and the light over it. */}
        <group position={[endX + 0.002, plinth + 0.05, -0.024]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.014, 0.015, 0.012, SEG]} />
            {M('trim')}
          </mesh>
          <mesh position={[0.0065, 0.006, 0]}>
            <boxGeometry args={[0.001, 0.008, 0.002]} />
            <meshStandardMaterial color={SLOT} />
          </mesh>
          <Led on={on} position={[0, 0.03, 0]} radius={0.003} color={WARM} />
        </group>
      </group>
      <Halo on={on} position={[0, h + 0.06, 0]} color={WARM} intensity={0.08} distance={0.5} />
      <Steam
        on={on}
        position={[-0.015, h + 0.01, 0]}
        radius={0.02}
        rise={0.16}
        count={5}
        strength={0.05}
        speed={0.35}
      />
    </group>
  )
}

// A long slot toaster in brushed steel, after the Dualit Lite: a plain box
// with black end caps and a black base, two long slots side by side that
// take two slices each end to end, and on its front the lever in its track,
// a browning dial and three small buttons.
function LongToaster({ p, M, on }: Look) {
  const w = p('width')
  const lit = useEased(on ? 1 : 0, 2.2)
  const press = useEased(on ? 1 : 0, 6)
  const d = Math.max(0.09, p('depth'))
  const h = 0.19
  const cap = 0.035
  const base = 0.012
  const bw = w - cap * 2 + 0.01
  const L = w - cap * 2 - 0.04
  const s = 0.034
  const slots = toastSlots(d, s, 0.012)
  const front = d / 2
  const trackX = w / 2 - cap - 0.035
  const lever = h - 0.045 + (base + 0.04 - (h - 0.045)) * press
  return (
    <group>
      <Slab size={[w - 0.01, base, d - 0.004]} radius={0.012} bevel={0.003}>
        {M('trim')}
      </Slab>
      <Slab
        size={[bw, h - base, d]}
        radius={0.012}
        bevel={0.005}
        position={[0, base, 0]}
        holes={slots.map(z => ({ x: 0, z, w: L, d: s, r: s / 2 - 0.002 }))}
      >
        {M('body')}
      </Slab>
      {[-1, 1].map(k => (
        <Slab key={k} size={[cap, h, d + 0.004]} radius={0.02} bevel={0.008} position={[k * (w / 2 - cap / 2), 0, 0]}>
          {M('trim')}
        </Slab>
      ))}
      {slots.map(z => (
        <ToastSlot
          key={z}
          x={0}
          z={z}
          L={L}
          s={s}
          floor={base + 0.03}
          top={h}
          slices={2}
          rise={0.05 * (1 - press)}
          lit={lit}
        />
      ))}
      {/* The lever in its track on the front. */}
      <mesh position={[trackX, (base + h) / 2, front + 0.0006]}>
        <planeGeometry args={[0.008, h - base - 0.06]} />
        <meshStandardMaterial color={SLOT} />
      </mesh>
      <Slab size={[0.032, 0.018, 0.026]} radius={0.007} bevel={0.004} position={[trackX, lever - 0.009, front + 0.012]}>
        {M('trim')}
      </Slab>
      {/* The browning dial and the buttons under it. The top one lights. */}
      <group position={[trackX - 0.05, 0, front]}>
        <mesh position={[0, h * 0.68, 0.005]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.015, 0.016, 0.012, SEG]} />
          {M('trim')}
        </mesh>
        {[0.42, 0.32, 0.22].map((f, i) => (
          <group key={f} position={[0, h * f, 0.002]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.007, 0.007, 0.005, 20]} />
              {M('trim')}
            </mesh>
            {i === 0 && <Led on={on} position={[0, 0, 0.003]} radius={0.003} color={WARM} />}
          </group>
        ))}
      </group>
      <Halo on={on} position={[0, h + 0.06, 0]} color={WARM} intensity={0.1} distance={0.55} />
      <Steam on={on} position={[0, h + 0.01, 0]} radius={0.022} rise={0.16} count={6} strength={0.05} speed={0.35} />
    </group>
  )
}

// A cooking robot after the Thermomix TM6: a base that rises from a low
// front, with its selector knob, up a sloping panel carrying the
// touchscreen to a flat top, and on that top a tall steel jug with a
// handle, a lid and a measuring cup in the hole of the lid. While it cooks
// the screen is lit, the cup turns, a ring glows round it and steam rises
// from the hole.
function JugCooker({ p, c, M, on }: Look) {
  const w = p('width')
  const lit = useEased(on ? 1 : 0, 2.5)
  const k = w / 0.33
  const D = w * 0.97
  const b = 0.02
  const H = 0.14 * k
  const low = 0.065 * k
  const shelf = D / 2 - 0.11 * k
  const slope = onSlope([D / 2, low], [shelf, H])
  // The jug stands in the middle of the flat top.
  const jz = (-D / 2 + shelf) / 2
  const r = 0.072 * k
  const jh = 0.17 * k
  const seat = H + 0.004
  const rim = seat + jh
  const lidTop = rim + 0.024 * k
  return (
    <group>
      <Profile
        points={[
          [-D / 2 + b, b],
          [D / 2 - b, b],
          [D / 2 - b, low],
          [shelf, H - b],
          [-D / 2 + b, H - b],
        ]}
        length={w}
        radius={0.03}
        bevel={b}
      >
        {M('body')}
      </Profile>
      {/* The screen on the sloping panel, and the arc it shows. */}
      <group position={slope.position} rotation={[slope.turn, 0, 0]}>
        <Slab size={[0.16 * k, 0.004, slope.length * 0.62]} radius={0.012} bevel={0.0015}>
          {M('display')}
        </Slab>
        <mesh position={[0, 0.0042, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.145 * k, slope.length * 0.52]} />
          <meshStandardMaterial color={c('display')} emissive={SCREEN} emissiveIntensity={0.45 * lit} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.0046, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.018 * k, 0.022 * k, SEG, 1, -0.4, Math.PI + 0.8]} />
          <meshStandardMaterial color={c('display')} emissive="#7fd8ff" emissiveIntensity={1.8 * lit} />
        </mesh>
      </group>
      {/* The selector knob on the low front, ringed with light. */}
      <group position={[0, low * 0.52, D / 2]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02 * k, 0.022 * k, 0.018, SEG]} />
          {M('lid')}
        </mesh>
        <mesh position={[0, 0, 0.0092]}>
          <ringGeometry args={[0.014 * k, 0.017 * k, SEG]} />
          <meshStandardMaterial color={c('lid')} emissive={SCREEN} emissiveIntensity={1.5 * lit} />
        </mesh>
      </group>
      <group position={[0, 0, jz]}>
        {/* The collar the jug sits down into. */}
        <mesh position={[0, H - 0.004 + 0.014 * k, 0]} castShadow>
          <cylinderGeometry args={[r * 1.14, r * 1.18, 0.028 * k, SEG * 2]} />
          {M('body')}
        </mesh>
        <Turned
          profile={[
            [0, 0],
            [r * 0.84, 0],
            [r * 0.9, jh * 0.08],
            [r * 0.95, jh * 0.55],
            [r, jh * 0.97],
            [r * 1.04, jh],
            [r * 0.96, jh],
          ]}
          position={[0, seat, 0]}
        >
          {M('jug')}
        </Turned>
        {/* The handle, off the jug's right toward the front. */}
        <group rotation={[0, -0.5, 0]}>
          <Tube
            radius={0.011 * k}
            points={[
              [r * 0.95, rim - 0.02 * k, 0],
              [r + 0.045 * k, rim - 0.025 * k, 0],
              [r + 0.055 * k, seat + jh * 0.55, 0],
              [r + 0.04 * k, seat + jh * 0.3, 0],
              [r * 0.9, seat + jh * 0.25, 0],
            ]}
          >
            {M('lid')}
          </Tube>
        </group>
        {/* The lid, with the hole the cup sits in. */}
        <Turned
          profile={[
            [r * 0.9, 0],
            [r * 1.06, 0],
            [r * 1.08, 0.006 * k],
            [r * 0.98, 0.016 * k],
            [0.04 * k, 0.024 * k],
            [0.026 * k, 0.024 * k],
            [0.026 * k, 0.02 * k],
          ]}
          position={[0, rim, 0]}
        >
          {M('lid')}
        </Turned>
        <mesh position={[0, lidTop + 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.029 * k, 0.036 * k, SEG]} />
          <meshStandardMaterial color={c('lid')} emissive={SCREEN} emissiveIntensity={1.4 * lit} />
        </mesh>
        {/* The measuring cup, turning slowly while it cooks. */}
        <group position={[0, lidTop - 0.012 * k, 0]}>
          <Spinner speed={0.9 * lit}>
            <mesh position={[0, 0.011 * k, 0]} castShadow>
              <cylinderGeometry args={[0.023 * k, 0.021 * k, 0.022 * k, SEG]} />
              {M('body')}
            </mesh>
            <mesh position={[0.012 * k, 0.023 * k, 0]}>
              <boxGeometry args={[0.02 * k, 0.004, 0.006]} />
              {M('lid')}
            </mesh>
          </Spinner>
        </group>
        <Steam
          on={on}
          position={[0, lidTop + 0.012, 0]}
          radius={0.022}
          rise={0.26}
          count={8}
          strength={0.14}
          speed={0.45}
        />
      </group>
      <Halo on={on} position={[0, H + 0.04, D / 2 + 0.04]} color={SCREEN} intensity={0.06} distance={0.45} />
    </group>
  )
}

// A multicooker with a domed lid: a squat round base in dark plastic with a
// round display on its front, a wide steel bowl on it with a loop handle
// each side, and a domed steel lid with a knob. While it cooks the display
// is lit, a ring glows round the knob and steam leaks from the vent beside
// it.
function DomeCooker({ p, c, M, on }: Look) {
  const w = p('width')
  const lit = useEased(on ? 1 : 0, 2.5)
  const k = w / 0.36
  const R = w / 2 - 0.035
  const bh = 0.11 * k
  const bowl = 0.13 * k
  const rim = bh + bowl
  const dome = 0.075 * k
  return (
    <group>
      <Turned
        profile={[
          [0, 0],
          [R * 0.95, 0],
          [R * 1.02, 0.008],
          [R * 1.05, 0.03 * k],
          [R * 0.99, bh],
          [R * 0.86, bh + 0.004],
          [0, bh + 0.004],
        ]}
      >
        {M('body')}
      </Turned>
      {/* The round display, tipped back with the side of the base. */}
      <group position={[0, bh * 0.5, R * 1.02]} rotation={[-0.35, 0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.032 * k, 0.034 * k, 0.01, SEG]} />
          {M('display')}
        </mesh>
        <mesh position={[0, 0, 0.0052]}>
          <circleGeometry args={[0.026 * k, SEG]} />
          <meshStandardMaterial color={c('display')} emissive={SCREEN} emissiveIntensity={0.5 * lit} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0, 0.0056]}>
          <ringGeometry args={[0.02 * k, 0.023 * k, SEG, 1, -0.5, Math.PI + 1]} />
          <meshStandardMaterial color={c('display')} emissive={WARM} emissiveIntensity={1.8 * lit} />
        </mesh>
      </group>
      <Turned
        profile={[
          [0, 0],
          [R * 0.72, 0],
          [R * 0.84, bowl * 0.15],
          [R * 0.96, bowl * 0.6],
          [R, bowl * 0.92],
          [R * 1.03, bowl * 0.96],
          [R * 1.03, bowl],
          [R * 0.98, bowl],
        ]}
        position={[0, bh, 0]}
      >
        {M('jug')}
      </Turned>
      {/* A loop handle each side, just under the rim. */}
      {[0, Math.PI].map(turn => (
        <group key={turn} rotation={[0, turn, 0]}>
          <Tube
            radius={0.006 * k}
            points={[
              [R * 0.97, rim - 0.018 * k, -0.032 * k],
              [R + 0.028 * k, rim - 0.014 * k, -0.026 * k],
              [R + 0.036 * k, rim - 0.014 * k, 0],
              [R + 0.028 * k, rim - 0.014 * k, 0.026 * k],
              [R * 0.97, rim - 0.018 * k, 0.032 * k],
            ]}
          >
            {M('jug')}
          </Tube>
        </group>
      ))}
      <Turned
        profile={[
          [R * 1.05, 0],
          [R * 1.04, 0.01 * k],
          [R * 0.9, dome * 0.45],
          [R * 0.62, dome * 0.8],
          [R * 0.3, dome * 0.97],
          [0, dome],
        ]}
        position={[0, rim, 0]}
      >
        {M('lid')}
      </Turned>
      {/* The knob, the ring of light round its foot, and the steam vent. */}
      <group position={[0, rim + dome, 0]}>
        <mesh position={[0, 0.01 * k, 0]} castShadow>
          <cylinderGeometry args={[0.016 * k, 0.02 * k, 0.02 * k, SEG]} />
          {M('body')}
        </mesh>
        <mesh position={[0, 0.02 * k, 0]} scale={[1, 0.45, 1]}>
          <sphereGeometry args={[0.016 * k, SEG, SEG / 2, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {M('body')}
        </mesh>
        <mesh position={[0, 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.021 * k, 0.026 * k, SEG]} />
          <meshStandardMaterial color={c('lid')} emissive={WARM} emissiveIntensity={1.4 * lit} />
        </mesh>
        <mesh position={[R * 0.32, -0.004 * k, 0]} rotation={[0, 0, -0.2]}>
          <cylinderGeometry args={[0.008 * k, 0.009 * k, 0.012 * k, 20]} />
          {M('body')}
        </mesh>
        <Steam
          on={on}
          position={[R * 0.33, 0.006, 0]}
          radius={0.022}
          rise={0.24}
          count={8}
          strength={0.13}
          speed={0.45}
        />
      </group>
      <Halo on={on} position={[0, bh * 0.5, R + 0.08]} color={WARM} intensity={0.06} distance={0.45} />
    </group>
  )
}

// A drawer pulled from the foot of an air fryer's front: a rounded panel
// `dw` wide and `dh` tall, standing on a dark seam that glows orange all
// round it while the fryer heats, a small window onto the basket and a
// chunky bar handle standing out in front. `front` is the body's face.
function FryerDrawer({
  x,
  dw,
  dh,
  front,
  lit,
  c,
  M,
}: {
  x: number
  dw: number
  dh: number
  front: number
  lit: number
  c: (slot: string) => string
  M: (slot: string) => ReactNode
}) {
  const y0 = 0.02
  const face = front + 0.006
  const grip = Math.min(0.14, dw * 0.6)
  const gy = y0 + dh * 0.32
  return (
    <group position={[x, 0, 0]}>
      <Slab
        size={[dw + 0.007, dh + 0.007, 0.014]}
        radius={0.028}
        bevel={0.002}
        position={[0, y0 - 0.0035, front - 0.004]}
      >
        <meshStandardMaterial color={SLOT} emissive={HEAT} emissiveIntensity={1.6 * lit} roughness={0.7} />
      </Slab>
      <Slab size={[dw, dh, 0.02]} radius={0.025} bevel={0.005} position={[0, y0, front - 0.004]}>
        {M('body')}
      </Slab>
      {/* The window onto the basket, lit from inside while it cooks. */}
      <mesh position={[0, y0 + dh * 0.74, face + 0.0005]}>
        <planeGeometry args={[dw * 0.46, dh * 0.2]} />
        <meshStandardMaterial color="#1b1612" emissive={WARM} emissiveIntensity={1.3 * lit} roughness={0.1} />
      </mesh>
      {/* The handle: a thick bar on two stubs. */}
      {[-1, 1].map(s => (
        <Slab
          key={s}
          size={[0.022, 0.03, 0.05]}
          radius={0.008}
          bevel={0.004}
          position={[s * (grip / 2 - 0.011), gy, face + 0.022]}
        >
          {M('handle')}
        </Slab>
      ))}
      <Bar length={grip} radius={0.017} position={[0, gy + 0.015, face + 0.052]} rotation={[0, 0, Math.PI / 2]}>
        {M('handle')}
      </Bar>
      <mesh position={[0, gy + 0.0152, face + 0.0698]} rotation={[0, 0, 0]}>
        <planeGeometry args={[grip * 0.5, 0.004]} />
        <meshStandardMaterial color={c('handle')} emissive={WARM} emissiveIntensity={0.6 * lit} />
      </mesh>
    </group>
  )
}

// An air fryer: a rounded cube with its top front edge cut back into a
// slanted panel carrying the display, one drawer at the foot of its front,
// or two side by side for the twin, and a vent grille across the upper
// back. While it cooks the display is lit, the drawer seams and windows
// glow orange and hot air shimmers up from the vent.
function AirFryer({ p, c, M, on, dual }: Look & { dual: boolean }) {
  const w = p('width')
  const lit = useEased(on ? 1 : 0, 2)
  const d = dual ? Math.min(0.4, Math.max(0.3, w * 0.9)) : Math.min(0.46, w * 1.28)
  const h = dual ? d * 0.88 : Math.min(0.42, w * 1.12)
  const b = 0.024
  const cut = 0.075
  const slope = onSlope([d / 2, h - cut], [d / 2 - 0.085, h])
  const dh = h * 0.5
  const gap = 0.012
  const dw = dual ? (w - 0.03 - gap) / 2 : w - 0.03
  const drawers = dual ? [-1, 1].map(s => s * (dw / 2 + gap / 2)) : [0]
  const panelW = dual ? w * 0.5 : w - 0.07
  return (
    <group>
      <Profile
        points={[
          [-d / 2 + b, b],
          [d / 2 - b, b],
          [d / 2 - b, h - cut],
          [d / 2 - 0.085, h - b],
          [-d / 2 + b, h - b],
        ]}
        length={w}
        radius={0.035}
        bevel={b}
      >
        {M('body')}
      </Profile>
      {drawers.map(x => (
        <FryerDrawer key={x} x={x} dw={dw} dh={dh} front={d / 2} lit={lit} c={c} M={M} />
      ))}
      {/* The display on the slanted panel: its glass, the lit digits and a
          row of touch keys. */}
      <group position={slope.position} rotation={[slope.turn, 0, 0]}>
        <Slab size={[panelW, 0.004, slope.length * 0.6]} radius={0.01} bevel={0.0015}>
          {M('display')}
        </Slab>
        <mesh position={[0, 0.0042, -slope.length * 0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.052, 0.018]} />
          <meshStandardMaterial color={c('display')} emissive="#ffd9a8" emissiveIntensity={1.8 * lit} />
        </mesh>
        {Array.from({ length: 4 }, (_, i) => (
          <Led
            key={i}
            on={on}
            position={[(i - 1.5) * Math.min(0.03, panelW / 5), 0.004, slope.length * 0.16]}
            radius={0.0028}
            color="#f2f5f7"
          />
        ))}
      </group>
      {/* The vent grille across the upper back. */}
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0, h * 0.6 + i * 0.018, -d / 2 - 0.0006]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[w * 0.55, 0.007]} />
          <meshStandardMaterial color={SLOT} />
        </mesh>
      ))}
      <Steam
        on={on}
        position={[0, h * 0.72, -d / 2 - 0.01]}
        radius={0.03}
        rise={0.22}
        count={7}
        strength={0.07}
        speed={0.4}
        drift={[0, -0.08]}
        color="#f3ece4"
      />
      <Halo on={on} position={[0, dh * 0.7, d / 2 + 0.09]} color={WARM} intensity={0.08} distance={0.5} />
    </group>
  )
}
