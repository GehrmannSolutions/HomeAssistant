import { colorValue, decorationVariant, materialValue, paramValue, type DecorationKind } from '#/decoration/catalog.ts'
import { useEased } from '#/scene/decor/ease.ts'
import { FairyLights, Falling, Flames, Spray } from '#/scene/decor/effects.tsx'
import { Foliage, heading, place, random } from '#/scene/decor/foliage.ts'
import { scatter } from '#/scene/decor/scatter.ts'
import { Glass, Halo, Led, Material, SEG, Slab, Waves } from '#/scene/decor/parts.tsx'
import type { ItemState } from '#/scene/decor/state.ts'
import type { DecorationConfig } from '#/types.ts'
import { useFrame, useThree } from '@react-three/fiber'
import { shadowless, useLive } from '#/scene/live.ts'
import { LITTER_TURN } from '#/scene/decor/pressed.ts'
import { useMemo, useRef, type ReactNode } from 'react'
import { Color, Vector3, type Group } from 'three'

type Props = { kind: DecorationKind; item: DecorationConfig; state: ItemState | null }

type Look = {
  p: (id: string) => number
  c: (slot: string) => string
  M: (slot: string) => ReactNode
  style: string
  on: boolean
}

type Vec3 = [number, number, number]

// The pieces round the home that show they are on with something alive: a
// fire, a tree's lights, a feeder, a litter box that turns itself over, a
// boiler.
export default function HearthModel({ kind, item, state }: Props) {
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
    case 'fireplace':
      return look.style === 'stove' ? <Stove {...look} /> : <LinearFire {...look} />
    case 'christmas_tree':
      return <ChristmasTree {...look} />
    case 'pet_feeder':
      return look.style === 'fountain' ? <PetFountain {...look} /> : <PetFeeder {...look} />
    case 'litter_box':
      return look.style === 'moon' ? <MoonLitterBox {...look} /> : <GlobeLitterBox {...look} />
    case 'water_heater':
      return look.style === 'tank' ? <TankHeater {...look} /> : <CombiBoiler {...look} />
    default:
      return null
  }
}

// The warm light a fire throws on the floor and the wall round it.
const FIRE_LIGHT = '#ff9a4a'
const SOOT = '#0c0c0d'

// A body `w` wide, `h` tall and `d` deep, standing on its base at `y0`,
// with a firebox let into its front: an opening `ow` by `oh` from `oy` up,
// `depth` deep, lined in soot that glows while the fire burns. The logs and
// flames go in the recess, behind whatever glass closes it.
function Firebox({
  w,
  h,
  d,
  y0,
  ow,
  oh,
  oy,
  depth,
  lit,
  children,
}: {
  w: number
  h: number
  d: number
  y0: number
  ow: number
  oh: number
  oy: number
  depth: number
  lit: number
  children: ReactNode
}) {
  const side = (w - ow) / 2
  const lining = <meshStandardMaterial color={SOOT} emissive={FIRE_LIGHT} emissiveIntensity={0.3 * lit} />
  const inner = d / 2 - depth / 2
  return (
    <group>
      <Slab size={[w, oy - y0, d]} radius={0.006} bevel={0.003} position={[0, y0, 0]}>
        {children}
      </Slab>
      <Slab size={[w, y0 + h - oy - oh, d]} radius={0.006} bevel={0.003} position={[0, oy + oh, 0]}>
        {children}
      </Slab>
      {[-1, 1].map(s => (
        <Slab key={s} size={[side, oh, d]} radius={0.004} bevel={0.002} position={[s * (ow / 2 + side / 2), oy, 0]}>
          {children}
        </Slab>
      ))}
      <Slab size={[ow, oh, d - depth]} radius={0.004} bevel={0.002} position={[0, oy, -depth / 2]}>
        {children}
      </Slab>
      {/* The lining: back, floor, roof and the two cheeks. */}
      <mesh position={[0, oy + oh / 2, d / 2 - depth + 0.001]}>
        <planeGeometry args={[ow, oh]} />
        {lining}
      </mesh>
      <mesh position={[0, oy + 0.001, inner]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ow, depth]} />
        {lining}
      </mesh>
      <mesh position={[0, oy + oh - 0.001, inner]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ow, depth]} />
        {lining}
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (ow / 2 - 0.001), oy + oh / 2, inner]} rotation={[0, -s * (Math.PI / 2), 0]}>
          <planeGeometry args={[depth, oh]} />
          {lining}
        </mesh>
      ))}
    </group>
  )
}

// A wide gas fire set in a plain black box on a stone hearth, after the
// Faber MatriX: one long ribbon of flame over a bed of pale pebbles behind
// a sheet of glass.
function LinearFire({ p, M, on }: Look) {
  const w = p('width')
  const h = p('height')
  const lit = useEased(on ? 1 : 0, 1.8)
  const plinth = 0.08
  const D = 0.36
  const openW = w - 0.18
  const openH = Math.min(0.42, (h - plinth) * 0.5)
  const openY = plinth + (h - plinth) * 0.28
  const front = D / 2
  // How far the firebox runs back behind the glass.
  const box = D * 0.55
  const stones = Math.max(6, Math.round(openW / 0.07))
  return (
    <group>
      <Slab size={[w + 0.24, plinth, D + 0.26]} radius={0.01} bevel={0.004} position={[0, 0, 0.1]}>
        {M('hearth')}
      </Slab>
      <Firebox w={w} h={h - plinth} d={D} y0={plinth} ow={openW} oh={openH} oy={openY} depth={box} lit={lit}>
        {M('body')}
      </Firebox>
      {Array.from({ length: stones }, (_, i) => (
        <mesh
          key={i}
          position={[-openW / 2 + (openW / stones) * (i + 0.5), openY + 0.014, front - box * 0.45]}
          scale={[1.2 + scatter(i) * 0.5, 0.7, 0.8]}
        >
          <sphereGeometry args={[0.018, 12, 8]} />
          {M('logs')}
        </mesh>
      ))}
      <Flames
        on={on}
        width={openW * 0.92}
        height={openH * 0.75}
        count={Math.round(openW / 0.06)}
        position={[0, openY + 0.02, front - box * 0.45]}
      />
      <mesh position={[0, openY + openH / 2, front - 0.004]}>
        <planeGeometry args={[openW, openH]} />
        <Glass color="#ffffff" opacity={0.08} />
      </mesh>
      <Halo on={on} position={[0, openY + openH / 2, front + 0.35]} color={FIRE_LIGHT} intensity={0.9} distance={3} />
    </group>
  )
}

// A cast iron wood stove on four short legs, its flue going up behind, with
// logs burning behind the glass of its door.
function Stove({ p, c, M, on }: Look) {
  const w = p('width')
  const h = p('height')
  const lit = useEased(on ? 1 : 0, 1.8)
  const legH = 0.12
  const d = w * 0.85
  const bodyH = h - legH
  const doorW = w * 0.72
  const doorH = bodyH * 0.5
  const doorY = legH + bodyH * 0.2
  const front = d / 2
  // How far the firebox runs back behind the door.
  const box = d * 0.7
  const iron = M('body')
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}${sz}`} position={[(sx * (w - 0.08)) / 2, legH / 2, (sz * (d - 0.08)) / 2]} castShadow>
            <boxGeometry args={[0.04, legH, 0.04]} />
            {iron}
          </mesh>
        )),
      )}
      <Firebox w={w} h={bodyH} d={d} y0={legH} ow={doorW} oh={doorH} oy={doorY} depth={box} lit={lit}>
        {iron}
      </Firebox>
      {/* The top plate, a little proud all round. */}
      <Slab size={[w + 0.03, 0.02, d + 0.03]} radius={0.02} bevel={0.006} position={[0, h - 0.02, 0]}>
        {iron}
      </Slab>
      <mesh position={[0, h + 0.3, -d * 0.1]} castShadow>
        <cylinderGeometry args={[0.065, 0.065, 0.6, SEG]} />
        {iron}
      </mesh>
      {/* Two logs across the grate, well back inside. */}
      {[-1, 1].map(s => (
        <mesh
          key={s}
          position={[0, doorY + 0.03 + (s > 0 ? 0.035 : 0), front - box * 0.5 + s * 0.03]}
          rotation={[0, 0, Math.PI / 2 + s * 0.15]}
        >
          <cylinderGeometry args={[0.022, 0.022, doorW * 0.8, 12]} />
          {M('logs')}
        </mesh>
      ))}
      <Flames
        on={on}
        width={doorW * 0.8}
        height={doorH * 0.6}
        count={9}
        position={[0, doorY + 0.04, front - box * 0.45]}
        sparks
      />
      {/* The door: an iron frame round a clear pane. */}
      <mesh position={[0, doorY + doorH / 2, front + 0.01]}>
        <planeGeometry args={[doorW, doorH]} />
        <Glass color="#ffffff" opacity={0.08} />
      </mesh>
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[0, doorY + doorH / 2 + s * (doorH / 2 + 0.0125), front + 0.01]}>
            <boxGeometry args={[doorW + 0.05, 0.025, 0.02]} />
            {iron}
          </mesh>
          <mesh position={[s * (doorW / 2 + 0.0125), doorY + doorH / 2, front + 0.01]}>
            <boxGeometry args={[0.025, doorH, 0.02]} />
            {iron}
          </mesh>
        </group>
      ))}
      <mesh position={[doorW / 2 + 0.012, doorY + doorH * 0.6, front + 0.03]}>
        <boxGeometry args={[0.018, 0.08, 0.02]} />
        <Material color={c('logs')} material="metal" />
      </mesh>
      <Halo on={on} position={[0, doorY + doorH / 2, front + 0.3]} color={FIRE_LIGHT} intensity={0.7} distance={2.6} />
    </group>
  )
}

// The outline of a fir frond: full near its base, tapering to the tip,
// with the needles along its edge as saw teeth.
const FROND = (t: number) => {
  const shape = t < 0.12 ? 0.55 + (t / 0.12) * 0.45 : Math.max(0, 1 - ((t - 0.12) / 0.88) ** 1.25)
  return shape * (0.7 + 0.3 * Math.abs(Math.sin(t * 47)))
}

// A fir: whorls of branches up the trunk, each a drooping frond with two
// side fronds and a short one on top for depth, set round a little from the
// whorl below, every one a slightly different length and one of two shades.
// All the fronds of a shade are one geometry, so the tree costs three
// draws whatever its size.
// How many whorls a crown this tall is laid out in, and how far up it the
// trunk shows: to just under the last whorl drawn, so its fronds hide the end.
const firWhorls = (crown: number) => Math.max(7, Math.round(crown / 0.115))
const firTop = (crown: number) => crown * (1 - 2.4 / firWhorls(crown))

function firTree(R: number, y0: number, crown: number) {
  const rnd = random(11)
  const light = new Foliage()
  const dark = new Foliage()
  const twigs = new Foliage()
  const frond = (f: Foliage, at: Vector3, a: number, lift: number, len: number) => {
    const dir = heading(a, lift)
    f.blade(
      { length: len, width: len * 0.44, outline: FROND, rows: 26, cols: 3, droop: len * 0.2, fold: 0.22 },
      place(at, dir),
    )
    // The side fronds, from a little under half way out and drooping a
    // touch more, and a short one lying over the top.
    const fork = at.clone().addScaledVector(dir, len * 0.42)
    fork.y -= len * 0.2 * 0.42 ** 2
    for (const s of [-1, 1]) {
      const side = heading(a + s * 0.62, lift - 0.12)
      f.blade(
        { length: len * 0.5, width: len * 0.24, outline: FROND, rows: 18, cols: 3, droop: len * 0.1, fold: 0.22 },
        place(fork, side),
      )
    }
    const over = at.clone()
    over.y += 0.012
    f.blade(
      { length: len * 0.6, width: len * 0.26, outline: FROND, rows: 18, cols: 3, droop: len * 0.1, fold: 0.3 },
      place(over, heading(a, lift + 0.15)),
    )
    twigs.stem([at.toArray() as Vec3, fork.toArray() as Vec3], 0.009, 0.005)
  }
  // The topmost whorl is left out: with so few short fronds it read as a
  // star floating over the tree, so the one under it makes the tip.
  const whorls = firWhorls(crown)
  for (let k = 0; k < whorls - 1; k++) {
    const t = k / whorls
    const at = new Vector3(0, y0 + crown * t, 0)
    const reach = R * (1 - t) * 0.98 + 0.04
    const n = Math.max(3, Math.round(9 * (1 - t * 0.55)))
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + k * 2.4 + (rnd() - 0.5) * 0.5
      const len = Math.max(0.08, reach * (0.85 + rnd() * 0.3))
      const lift = -0.08 + (rnd() - 0.5) * 0.24
      frond(rnd() < 0.5 ? light : dark, at, a, lift, len)
    }
  }
  return { light: light.geometry(), dark: dark.geometry(), twigs: twigs.geometry() }
}

// A bare tree, the kind sold for winter with its lights already on: a
// trunk forking three ways, each limb forking again and again, reaching
// out and up into a rounded crown as a real tree does, with fairy lights
// wound along every branch. All of it is one geometry.
function bareTree(R: number, y0: number, h: number) {
  const rnd = random(23)
  const wood = new Foliage()
  const bulbs: Vec3[] = []
  const UP = new Vector3(0, 1, 0)
  const grow = (from: Vector3, dir: Vector3, len: number, r: number, depth: number) => {
    // A little bow in each limb, so none is a straight rod.
    const side = new Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new Vector3(1, 0, 0) : UP).normalize()
    const mid = from
      .clone()
      .addScaledVector(dir, len * 0.5)
      .addScaledVector(side, (rnd() - 0.5) * len * 0.2)
    const end = from.clone().addScaledVector(dir, len)
    wood.stem([from.toArray() as Vec3, mid.toArray() as Vec3, end.toArray() as Vec3], r, r * 0.62, undefined, 7)
    if (depth > 0) {
      const count = Math.max(1, Math.round(len / 0.08))
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count
        // A point on the bow, and the bulb hung a little off the bark.
        const at = from
          .clone()
          .multiplyScalar((1 - t) ** 2)
          .addScaledVector(mid, 2 * (1 - t) * t)
          .addScaledVector(end, t * t)
        const off = (rnd() - 0.5) * 2 * Math.PI
        at.addScaledVector(side, Math.cos(off) * r * 1.6).y += Math.sin(off) * r * 1.6
        bulbs.push(at.toArray() as Vec3)
      }
    }
    if (depth >= 4 || len < 0.1) return
    const kids = depth === 0 ? 3 : rnd() < 0.4 ? 3 : 2
    const spin = rnd() * Math.PI * 2
    for (let i = 0; i < kids; i++) {
      const turn = spin + (i / kids) * Math.PI * 2 + (rnd() - 0.5) * 0.8
      // The limb leaves at an angle from its parent, reaching out and up.
      const out = new Vector3().crossVectors(dir, UP).normalize().applyAxisAngle(dir, turn)
      if (out.lengthSq() < 0.5) out.set(Math.cos(turn), 0, Math.sin(turn))
      const tilt = (depth === 0 ? 0.55 : 0.45) + rnd() * 0.45
      const next = dir
        .clone()
        .multiplyScalar(Math.cos(tilt))
        .addScaledVector(out, Math.sin(tilt))
        .addScaledVector(UP, 0.18)
        .normalize()
      const nlen = len * (0.7 + rnd() * 0.16)
      // A limb that would reach out past the crown turns up instead.
      const reach = end.clone().addScaledVector(next, nlen)
      if (Math.hypot(reach.x, reach.z) > R * 0.92) next.addScaledVector(UP, 1.5).normalize()
      grow(end, next, nlen, r * 0.62, depth + 1)
    }
  }
  const lean = heading(rnd() * Math.PI * 2, Math.PI / 2 - 0.04)
  grow(new Vector3(0, y0 - 0.06, 0), lean, (h - y0) * 0.27, 0.032, 0)
  return { wood: wood.geometry(), bulbs }
}

// A Christmas tree standing in a woven basket, rows of rattan round a core
// with a thick rim at the top: a fir with warm white fairy lights scattered
// over it, thicker lower down where there is more tree, or a bare tree
// with the lights wound along its branches. The lights run through their
// patterns while it is on.
function ChristmasTree({ p, c, M, style, on }: Look) {
  const size = p('size')
  const h = p('height')
  const R = size / 2
  const bare = style === 'bare'
  const potH = Math.min(0.24, h * 0.13)
  const basketTop = R * (bare ? 0.3 : 0.36)
  const basketBottom = basketTop * 0.83
  const rows = Math.max(5, Math.round(potH / 0.03))
  const stakes = Math.max(12, Math.round(basketTop * 60))
  const lean = Math.atan2(basketTop - basketBottom, potH)
  // The lowest whorl, a little clear of the pot.
  const y0 = potH + Math.min(0.1, h * 0.05)
  const crown = h - y0
  const fir = useMemo(() => (bare ? null : firTree(R, y0, crown)), [bare, R, y0, crown])
  const winter = useMemo(() => (bare ? bareTree(R, y0, h) : null), [bare, R, y0, h])
  const bulbs = useMemo(
    () =>
      winter?.bulbs ??
      Array.from({ length: Math.max(30, Math.round(60 * size * h)) }, (_, i): Vec3 => {
        const t = 1 - Math.sqrt(scatter(i, 35)) * 0.97
        const a = scatter(i, 36) * Math.PI * 2
        const r = R * (1 - t) * (0.72 + scatter(i, 37) * 0.22)
        return [Math.cos(a) * r, y0 + crown * t - r * 0.1, Math.sin(a) * r]
      }),
    [winter, R, y0, crown, size, h],
  )
  const shade = useMemo(() => `#${new Color(c('needles')).multiplyScalar(0.78).getHexString()}`, [c])
  return (
    <group>
      <mesh position={[0, potH / 2, 0]} castShadow>
        <cylinderGeometry args={[basketTop - 0.008, basketBottom - 0.008, potH, SEG]} />
        {M('stand')}
      </mesh>
      {/* The weave, rows of cane round it, each a little out of line. */}
      {Array.from({ length: rows }, (_, k) => {
        const t = (k + 0.5) / rows
        const r = basketBottom + (basketTop - basketBottom) * t
        return (
          <mesh
            key={k}
            position={[0, t * potH, 0]}
            rotation={[Math.PI / 2 + (scatter(k, 38) - 0.5) * 0.03, 0, k * 0.7]}
            castShadow
          >
            <torusGeometry args={[r, potH / rows / 2, 6, SEG]} />
            {M('stand')}
          </mesh>
        )
      })}
      {/* The canes the rows are woven through, up the outside. */}
      {Array.from({ length: stakes }, (_, k) => {
        const a = (k / stakes) * Math.PI * 2
        const r = (basketTop + basketBottom) / 2 + potH / rows / 2
        return (
          <mesh
            key={k}
            position={[Math.cos(a) * r, potH / 2, Math.sin(a) * r]}
            rotation={[Math.sin(a) * lean, 0, -Math.cos(a) * lean]}
          >
            <cylinderGeometry args={[0.005, 0.005, potH, 5]} />
            {M('stand')}
          </mesh>
        )
      })}
      <mesh position={[0, potH, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[basketTop + 0.004, 0.016, 8, SEG]} />
        {M('stand')}
      </mesh>
      {/* Bark mulch over the top, round the foot of the trunk. */}
      <mesh position={[0, potH - 0.01, 0]}>
        <cylinderGeometry args={[basketTop - 0.01, basketTop - 0.01, 0.01, SEG]} />
        <Material color="#5a4030" material="matte" />
      </mesh>
      {winter && (
        <mesh geometry={winter.wood} castShadow>
          {M('trunk')}
        </mesh>
      )}
      {fir && (
        <>
          {/* The trunk, up to the last whorl and no further, so no bare tip
              shows above the fronds. */}
          <mesh position={[0, (potH + y0 + firTop(crown)) / 2, 0]}>
            <cylinderGeometry args={[0.012, 0.035, y0 + firTop(crown) - potH, 10]} />
            {M('trunk')}
          </mesh>
          {/* A dark core, so no light shows through between the fronds. */}
          <mesh position={[0, y0 + crown * 0.45, 0]}>
            <coneGeometry args={[R * 0.38, crown * 0.9, 12]} />
            <Material color={shade} material="matte" />
          </mesh>
          <mesh geometry={fir.twigs}>{M('trunk')}</mesh>
          <mesh geometry={fir.light} castShadow>
            <Material color={c('needles')} material="matte" doubleSide />
          </mesh>
          <mesh geometry={fir.dark} castShadow>
            <Material color={shade} material="matte" doubleSide />
          </mesh>
        </>
      )}
      <FairyLights on={on} points={bulbs} radius={bare ? 0.012 : 0.011} />
      <Halo on={on} position={[0, y0 + crown * 0.4, R + 0.35]} color="#ffd9a0" intensity={0.25} distance={2.2} />
    </group>
  )
}

// A tower of dry food with a see-through hopper, a chute at its foot and a
// bowl in front. At meal time a portion drops down the chute and the bowl
// fills.
function PetFeeder({ p, c, M, on }: Look) {
  const s = p('size')
  const h = p('height')
  const fill = useEased(on ? 1 : 0, 0.8)
  const towerD = s * 0.8
  const towerZ = -s * 0.35
  const bowlR = s * 0.36
  const bowlZ = towerZ + towerD / 2 + bowlR + 0.01
  const chuteY = 0.1
  const hopperH = h * 0.45
  return (
    <group>
      <Slab size={[s, h - hopperH, towerD]} radius={s * 0.2} bevel={0.01} position={[0, 0, towerZ]}>
        {M('body')}
      </Slab>
      {/* The hopper, clear, with the food in it. */}
      <Slab
        size={[s * 0.9, hopperH * 0.7, towerD * 0.85]}
        radius={s * 0.18}
        bevel={0.005}
        position={[0, h - hopperH + 0.01, towerZ]}
      >
        <Material color={c('food')} material="matte" />
      </Slab>
      <mesh position={[0, h - hopperH / 2, towerZ]}>
        <boxGeometry args={[s * 0.96, hopperH, towerD * 0.94]} />
        <Glass color="#ffffff" opacity={0.25} />
      </mesh>
      <Slab size={[s, 0.03, towerD]} radius={s * 0.2} bevel={0.008} position={[0, h - 0.015, towerZ]}>
        {M('body')}
      </Slab>
      {/* The chute over the bowl. */}
      <mesh position={[0, chuteY + 0.02, towerZ + towerD / 2 + 0.03]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[s * 0.3, 0.02, 0.07]} />
        {M('body')}
      </mesh>
      <mesh position={[0, 0.03, bowlZ]} castShadow>
        <cylinderGeometry args={[bowlR, bowlR * 0.85, 0.06, SEG, 1, true]} />
        <Material color={c('bowl')} material="metal" doubleSide />
      </mesh>
      <mesh position={[0, 0.004, bowlZ]}>
        <cylinderGeometry args={[bowlR * 0.85, bowlR * 0.85, 0.008, SEG]} />
        <Material color={c('bowl')} material="metal" />
      </mesh>
      <mesh position={[0, 0.008 + 0.022 * fill, bowlZ]} scale={[1, Math.max(fill, 0.01), 1]} visible={fill > 0.02}>
        <cylinderGeometry args={[bowlR * 0.8, bowlR * 0.82, 0.045, SEG]} />
        <Material color={c('food')} material="matte" />
      </mesh>
      <Falling
        on={on}
        points={[
          [0, chuteY + 0.01, towerZ + towerD / 2 + 0.07] as Vec3,
          [0.01, chuteY + 0.01, towerZ + towerD / 2 + 0.065] as Vec3,
        ]}
        fall={chuteY - 0.02}
        size={[0.009, 0.009, 0.009]}
        per={4}
        speed={1.4}
        color={c('food')}
        opacity={1}
      />
      <Led on={on} position={[0, h - hopperH - 0.04, towerZ + towerD / 2 + 0.002]} radius={0.006} />
    </group>
  )
}

// A round drinking fountain: water spouts up out of a dome in the middle,
// arcs over and falls back into the bowl round it while the pump is on.
function PetFountain({ p, c, M, on }: Look) {
  const s = p('size')
  const h = Math.min(p('height'), s * 0.8)
  const R = s / 2
  const baseH = h * 0.55
  const flow = useEased(on ? 1 : 0, 3)
  return (
    <group>
      <mesh position={[0, baseH / 2, 0]} castShadow>
        <cylinderGeometry args={[R * 0.92, R, baseH, SEG]} />
        {M('body')}
      </mesh>
      <mesh position={[0, baseH + 0.015, 0]}>
        <cylinderGeometry args={[R * 0.96, R * 0.92, 0.03, SEG, 1, true]} />
        <Material color={c('bowl')} material="ceramic" doubleSide />
      </mesh>
      <mesh position={[0, baseH + 0.012, 0]}>
        <cylinderGeometry args={[R * 0.9, R * 0.9, 0.004, SEG]} />
        <meshStandardMaterial color="#8fc3dc" transparent opacity={0.6} roughness={0.05} />
      </mesh>
      <mesh position={[0, baseH, 0]}>
        <sphereGeometry args={[R * 0.35, SEG, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Material color={c('bowl')} material="ceramic" />
      </mesh>
      {/* The water welling out of the top and sheeting down the dome. */}
      <mesh position={[0, baseH, 0]} visible={flow > 0.01}>
        <sphereGeometry args={[R * 0.37, SEG, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#cfeaf6" transparent opacity={0.6 * flow} roughness={0.02} depthWrite={false} />
      </mesh>
      <mesh position={[0, baseH + R * 0.37, 0]} scale={[1, 0.5 + 0.5 * flow, 1]} visible={flow > 0.01}>
        <sphereGeometry args={[R * 0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#e6f5fb" transparent opacity={0.8 * flow} roughness={0.02} depthWrite={false} />
      </mesh>
      {/* The spout: little jets thrown up and out on every side, landing
          on the water past the dome. */}
      {Array.from({ length: 8 }, (_, i) => (
        <group key={i} position={[0, baseH + 0.012, 0]} rotation={[0, (i / 8) * Math.PI * 2, 0]}>
          <Spray
            on={on}
            reach={R * 0.55}
            apex={R * 0.45}
            from={R * 0.37}
            spread={0.004}
            count={10}
            speed={1.1}
            size={0.004}
            color="#9fd3ec"
          />
        </group>
      ))}
      <Waves
        on={on}
        position={[0, baseH + 0.016, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        from={R * 0.4}
        reach={R * 0.45}
        strength={0.4}
        speed={0.8}
        color="#eef7fc"
      />
      <Led on={on} position={[0, baseH * 0.3, R * 0.97]} radius={0.006} color="#8fd6ff" />
    </group>
  )
}

// A wall hung gas combi boiler: a white case with pipes out of its foot, a
// display on the fascia and a small window onto the burner, where a blue
// flame shows while it heats.
function CombiBoiler({ p, M, on }: Look) {
  const w = p('width')
  const bodyH = w * 1.65
  const d = 0.3
  const lit = useEased(on ? 1 : 0, 4)
  return (
    <group position={[0, -bodyH, 0]}>
      <Slab size={[w, bodyH, d]} radius={0.02} bevel={0.008} position={[0, 0, d / 2]}>
        {M('body')}
      </Slab>
      {/* The fascia along the foot, with its display. */}
      <Slab size={[w - 0.02, 0.1, 0.02]} radius={0.01} bevel={0.004} position={[0, 0.02, d]}>
        {M('trim')}
      </Slab>
      <mesh position={[0, 0.075, d + 0.021]}>
        <planeGeometry args={[w * 0.28, 0.035]} />
        <meshStandardMaterial color="#10171c" emissive="#7fd0ff" emissiveIntensity={1.6 * lit} />
      </mesh>
      {/* The window onto the burner. */}
      <mesh position={[0, bodyH * 0.42, d + 0.001]}>
        <circleGeometry args={[0.035, SEG]} />
        <meshStandardMaterial color={SOOT} emissive="#3d7dff" emissiveIntensity={0.5 * lit} />
      </mesh>
      <Flames
        on={on}
        width={0.05}
        height={0.035}
        count={3}
        position={[0, bodyH * 0.42 - 0.02, d + 0.004]}
        outer="#2a5cff"
        mid="#3d8dff"
        inner="#bfe4ff"
      />
      {[-0.3, -0.1, 0.1, 0.3].map((x, i) => (
        <mesh key={i} position={[x * w, -0.12, d * 0.45]}>
          <cylinderGeometry args={[0.011, 0.011, 0.24, 12]} />
          {M('pipes')}
        </mesh>
      ))}
      <Halo on={on} position={[0, 0.1, d + 0.2]} color="#7fd0ff" intensity={0.08} />
    </group>
  )
}

// A tall round hot water cylinder hung on the wall, with a dial on the
// front whose ring glows while it heats and a gauge down its side that
// climbs as the water warms.
function TankHeater({ p, M, on }: Look) {
  const w = p('width')
  const r = w / 2
  const tall = w * 2.6
  const lit = useEased(on ? 1 : 0, 4)
  const warm = useEased(on ? 1 : 0, 0.25)
  const gauge = tall * 0.5
  return (
    <group position={[0, -tall, r + 0.03]}>
      <mesh position={[0, tall / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, tall - r * 0.6, SEG]} />
        {M('body')}
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[0, tall / 2 + (s * (tall - r * 0.6)) / 2, 0]} scale={[1, 0.3, 1]}>
          <sphereGeometry args={[r, SEG, 16]} />
          {M('body')}
        </mesh>
      ))}
      {/* The dial, and the ring round it. */}
      <mesh position={[0, tall * 0.3, r + 0.004]}>
        <circleGeometry args={[r * 0.24, SEG]} />
        {M('trim')}
      </mesh>
      <mesh position={[0, tall * 0.3, r + 0.006]}>
        <ringGeometry args={[r * 0.26, r * 0.31, SEG]} />
        <meshStandardMaterial color="#3b2a22" emissive="#ff7a3a" emissiveIntensity={2 * lit} />
      </mesh>
      {/* The gauge: a slot, and the warmth rising up it. */}
      <mesh position={[0, tall * 0.42 + gauge / 2, r + 0.003]}>
        <planeGeometry args={[0.018, gauge]} />
        <meshStandardMaterial color="#2a2c2e" />
      </mesh>
      <mesh position={[0, tall * 0.42 + (gauge * warm) / 2, r + 0.005]} scale={[1, Math.max(warm, 0.001), 1]}>
        <planeGeometry args={[0.012, gauge]} />
        <meshStandardMaterial color="#ff8a4a" emissive="#ff6a2a" emissiveIntensity={1.5} />
      </mesh>
      {/* Hot out and cold in, down from its foot. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * r * 0.4, -0.05, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.25, 12]} />
          <Material color={s < 0 ? '#c0503a' : '#3a70c0'} material="metal" />
        </mesh>
      ))}
      <Halo on={on} position={[0, tall * 0.3, r + 0.2]} color="#ff9a5a" intensity={0.1} />
    </group>
  )
}

// How fast a litter box comes back to rest once it stops, in turns a second.
const LITTER_HOME = 0.3

// Rocks its children about the x axis while `on`: the entry lifts, goes
// over the back, and comes forward again the same way, never passing
// underneath. Once it stops they come back to where they started, so the
// entry always ends up facing the front again.
function Cycling({ on, children }: { on: boolean; children: ReactNode }) {
  const ref = useRef<Group>(null)
  const phase = useRef(0)
  const invalidate = useThree(state => state.invalidate)
  useLive(on)
  useFrame((_, delta) => {
    if (!ref.current) return
    shadowless(ref.current)
    const lap = Math.PI * 2
    if (on) phase.current += LITTER_TURN * lap * delta
    else {
      // Back to the nearest rest, which is a whole lap either way.
      const rest = Math.round(phase.current / lap) * lap
      const gap = rest - phase.current
      if (Math.abs(gap) < 0.0005) phase.current = rest
      else {
        phase.current += Math.sign(gap) * Math.min(Math.abs(gap), LITTER_HOME * lap * delta)
        invalidate()
      }
    }
    // A rock lifts the front, which is a turn back about x.
    ref.current.rotation.x = (-Math.PI * (1 - Math.cos(phase.current))) / 2
  })
  return <group ref={ref}>{children}</group>
}

// The round mouth of a litter box: a dark throat set into the wall it is cut
// in, and a rim round it, facing +z.
function Hatch({ r, z, deep = 0.01, trim }: { r: number; z: number; deep?: number; trim: ReactNode }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0, -deep / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, deep, SEG]} />
        <Material color={SOOT} material="matte" />
      </mesh>
      <mesh>
        <torusGeometry args={[r, 0.012, 8, SEG]} />
        {trim}
      </mesh>
    </group>
  )
}

// A self cleaning litter box in the shape of a globe: a white sphere with a
// wide opening framed by a dark bezel in its front, sitting on a base that
// holds the waste drawer, with a step before it. While on, the globe rocks
// back to sift the litter, the entry lifting over the back and coming
// forward again, and it settles facing the front when switched off.
function GlobeLitterBox({ p, c, M, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const baseH = Math.min(h * 0.3, 0.26)
  const R = Math.min(w / 2, (h - baseH) / 1.9, d * 0.42)
  const cy = h - R
  // The base runs under the back of the globe, the step out in front of it.
  const baseD = d * 0.85
  const baseZ = -d / 2 + baseD / 2
  const front = baseZ + baseD / 2
  // The opening: a cap this far round from the front pole is left off the
  // sphere, and the bezel rings its edge.
  const cap = Math.PI * 0.22
  const mouth = R * Math.sin(cap)
  const mouthZ = R * Math.cos(cap)
  return (
    <group>
      <Slab size={[w, baseH, baseD]} radius={w * 0.12} bevel={0.01} position={[0, 0, baseZ]}>
        {M('body')}
      </Slab>
      {/* The waste drawer front and its pull, and the button strip over it. */}
      <Slab size={[w * 0.8, baseH * 0.55, 0.014]} radius={0.01} bevel={0.003} position={[0, 0.015, front + 0.004]}>
        {M('trim')}
      </Slab>
      <mesh position={[0, 0.015 + baseH * 0.28, front + 0.018]}>
        <boxGeometry args={[w * 0.22, 0.006, 0.004]} />
        {M('drum')}
      </mesh>
      <mesh position={[0, baseH * 0.82, front + 0.002]}>
        <boxGeometry args={[w * 0.3, 0.018, 0.004]} />
        {M('drum')}
      </mesh>
      <Led on={on} position={[w * 0.11, baseH * 0.82, front + 0.005]} radius={0.004} />
      {/* The step, and the litter lying still in the bottom of the globe. */}
      <Slab
        size={[w * 0.7, 0.035, d - baseD + 0.04]}
        radius={0.015}
        bevel={0.005}
        position={[0, 0, front + (d - baseD) / 2 - 0.02]}
      >
        {M('trim')}
      </Slab>
      {/* Low enough to lie under the bottom of the entry, and as wide as the
          globe is there. */}
      <mesh position={[0, cy - R * 0.76, -R * 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[R * 0.64, SEG]} />
        <Material color="#cdbfa6" material="matte" />
      </mesh>
      <group position={[0, cy, -R * 0.1]}>
        <Cycling on={on}>
          {/* The globe, its front pole turned to +z so the cap comes off the front. */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <sphereGeometry args={[R, SEG, 24, 0, Math.PI * 2, cap, Math.PI - cap]} />
            {M('body')}
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <sphereGeometry args={[R - 0.006, SEG, 24, 0, Math.PI * 2, cap, Math.PI - cap]} />
            <Material color={c('drum')} material="matte" doubleSide />
          </mesh>
          <mesh position={[0, 0, mouthZ]}>
            <torusGeometry args={[mouth, 0.022, 12, SEG]} />
            {M('drum')}
          </mesh>
          {/* The dark cap over the back of the globe, which rocks with it. */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <sphereGeometry args={[R + 0.006, SEG, 16, 0, Math.PI * 2, Math.PI * 0.7, Math.PI * 0.3]} />
            {M('drum')}
          </mesh>
        </Cycling>
      </group>
    </group>
  )
}

// A hand rolled litter box: a wooden pod lying across a drawer base, a round
// entry in its front and a crank on its side. It sifts by rocking back on
// its axle, so while it is on the whole pod rocks, entry and all, and it
// comes forward to face the front again when switched off.
function MoonLitterBox({ p, M, on }: Look) {
  const w = p('width')
  const d = p('depth')
  const h = p('height')
  const baseH = h * 0.3
  const R = Math.min(h - baseH, d) * 0.48
  const len = w * 0.86
  const cy = baseH + R * 0.88
  return (
    <group>
      <Slab size={[w, baseH, d]} radius={0.02} bevel={0.006}>
        {M('body')}
      </Slab>
      {/* The drawer front and its pull. */}
      <mesh position={[0, baseH * 0.45, d / 2 + 0.005]}>
        <boxGeometry args={[w * 0.82, baseH * 0.55, 0.01]} />
        {M('drum')}
      </mesh>
      <mesh position={[0, baseH * 0.45, d / 2 + 0.018]}>
        <boxGeometry args={[w * 0.28, 0.014, 0.016]} />
        {M('trim')}
      </mesh>
      {/* The cheeks the pod rolls between, up to the axle they carry. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (len / 2 + 0.015), (baseH + cy + 0.04) / 2, 0]} castShadow>
          <boxGeometry args={[0.03, cy + 0.04 - baseH, R * 1.1]} />
          {M('body')}
        </mesh>
      ))}
      <group position={[0, cy, 0]}>
        <Cycling on={on}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[R, R, len, SEG]} />
            {M('drum')}
          </mesh>
          {[-1, 1].map(s => (
            <mesh key={s} position={[(s * len) / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[R * 0.98, 0.012, 8, SEG]} />
              {M('trim')}
            </mesh>
          ))}
          <Hatch r={R * 0.48} z={R + 0.002} deep={0.03} trim={M('trim')} />
          {/* The crank: the axle comes out through the cheek first, and the
              arm and its knob turn clear of it outside. */}
          <mesh position={[len / 2 + 0.035, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.016, 0.07, 16]} />
            {M('trim')}
          </mesh>
          <mesh position={[len / 2 + 0.08, R * 0.3, 0]}>
            <boxGeometry args={[0.02, R * 0.6 + 0.03, 0.03]} />
            {M('trim')}
          </mesh>
          <mesh position={[len / 2 + 0.115, R * 0.6, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.018, 0.018, 0.07, 16]} />
            {M('body')}
          </mesh>
        </Cycling>
      </group>
    </group>
  )
}
