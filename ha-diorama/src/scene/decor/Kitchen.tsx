import { Bar, Halo, Led, Material, Panel, SEG, Slab, Steam, Tube } from '#/scene/decor/parts.tsx'
import { CEILING_HEIGHT_M } from '#/theme.ts'
import { useFrame } from '@react-three/fiber'
import { useLive } from '#/scene/live.ts'
import { useRef, type ReactNode } from 'react'
import type { Group } from 'three'

// What every kitchen fitting draws with: its slots as materials and colors,
// and how far it is switched on.
export type Fit = {
  M: (slot: string) => ReactNode
  c: (slot: string) => string
  m: (slot: string) => string
  on: boolean
  lit: number
  level: number
  // How far a door stands open while it is on, 0 to 1, eased.
  open: number
}

// The white liner inside a fridge or a dishwasher.
const LINER = '#eef0f0'

// A box open at the front, so a door swung back shows inside it: a back,
// two ends, a top and a bottom, `t` thick, from y 0 to `h` and `d` deep
// back from `z`. The outside is `skin`, and a white liner covers the back.
function Carcass({
  w,
  h,
  d,
  z,
  t = 0.02,
  skin,
}: {
  w: number
  h: number
  d: number
  z: number
  t?: number
  skin: ReactNode
}) {
  const back = z - d
  return (
    <group>
      <mesh position={[0, h / 2, back + t / 2]}>
        <boxGeometry args={[w, h, t]} />
        {skin}
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[(s * (w - t)) / 2, h / 2, back + d / 2]}>
          <boxGeometry args={[t, h, d]} />
          {skin}
        </mesh>
      ))}
      {[t / 2, h - t / 2].map(y => (
        <mesh key={y} position={[0, y, back + d / 2]}>
          <boxGeometry args={[w - 2 * t, t, d]} />
          {skin}
        </mesh>
      ))}
      <mesh position={[0, h / 2, back + t + 0.001]}>
        <planeGeometry args={[w - 2 * t, h - 2 * t]} />
        <meshStandardMaterial color={LINER} roughness={0.5} />
      </mesh>
    </group>
  )
}

// A compartment's inside: glass shelves, and a few things standing on
// them, with a light at the top that comes on as the door opens.
function Larder({
  w,
  y0,
  y1,
  z,
  d,
  shelves,
  open,
  drawers = false,
}: {
  w: number
  y0: number
  y1: number
  z: number
  d: number
  shelves: number
  open: number
  drawers?: boolean
}) {
  const step = (y1 - y0) / (shelves + 1)
  const mid = z - d / 2
  const food = ['#d8503c', '#f2d25c', '#7fae5a', '#f4f1e8']
  return (
    <group>
      {Array.from({ length: shelves }, (_, i) => {
        const y = y0 + step * (i + 1)
        return drawers ? (
          <mesh key={i} position={[0, y - step / 2, mid + 0.02]}>
            <boxGeometry args={[w - 0.02, step - 0.02, d - 0.06]} />
            <meshStandardMaterial color="#dfe8ec" roughness={0.3} transparent opacity={0.7} />
          </mesh>
        ) : (
          <mesh key={i} position={[0, y, mid]}>
            <boxGeometry args={[w, 0.006, d - 0.02]} />
            <meshStandardMaterial color="#cfe3e8" roughness={0.1} transparent opacity={0.45} />
          </mesh>
        )
      })}
      {!drawers &&
        Array.from({ length: shelves }, (_, i) => {
          const y = y0 + step * (i + 1) + 0.003
          return food.slice(i % 2, (i % 2) + 2).map((color, k) => (
            <mesh key={`${i}:${k}`} position={[(k - 0.5) * w * 0.4 + (i % 2) * 0.04, y + 0.05, mid - d * 0.1]}>
              {k === 0 ? <boxGeometry args={[0.1, 0.1, 0.08]} /> : <cylinderGeometry args={[0.035, 0.035, 0.1, 20]} />}
              <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
          ))
        })}
      {/* The lamp in the roof of the compartment. */}
      <mesh position={[0, y1 - 0.004, mid]}>
        <boxGeometry args={[w * 0.3, 0.006, 0.04]} />
        <meshStandardMaterial color="#f5f3ee" emissive="#fff4df" emissiveIntensity={2 * open} />
      </mesh>
      <Halo on={open > 0.5} position={[0, (y0 + y1) / 2, z + 0.05]} color="#fff1d8" intensity={0.25} />
    </group>
  )
}

// Door bins on the inside of a fridge door, `h` tall from `y`, in the
// door's own frame with its inner face at z 0.
function Bins({ w, y, h }: { w: number; y: number; h: number }) {
  const n = Math.max(1, Math.floor(h / 0.35))
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[0, y + (h / n) * (i + 0.3), -0.035]}>
          <boxGeometry args={[w * 0.8, 0.06, 0.07]} />
          <meshStandardMaterial color="#dfe8ec" roughness={0.3} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  )
}

// A dark recess cut into a door, the pocket a handleless front is pulled
// by. It is a dark box pushed through the door's face, so it reads as a
// hollow from any side it shows on.
function Pocket({
  size,
  position,
  children,
}: {
  size: [number, number, number]
  position: [number, number, number]
  children: ReactNode
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      {children}
    </mesh>
  )
}

// A fridge freezer after the Samsung Bespoke RB38C7B6AS9, 59.5 by 65.8 by
// 203 cm: two flat doors, the fridge over the freezer about 1.3 m to 0.7 m,
// a pocket grip cut into the edge of each door where they meet, and a toe
// grille under the lower door. Below 1.2 m it is an under counter fridge
// with one door and its grip at the top. The doors hinge on the left, or on
// the right when `flip` is set, and the grips move to the other edge.
export function Fridge({ w, d, h, flip, fit }: { w: number; d: number; h: number; flip: boolean; fit: Fit }) {
  const { M, open } = fit
  const side = flip ? -1 : 1
  const door = 0.05
  const toe = Math.min(0.06, h * 0.04)
  const gap = 0.006
  const front = d / 2
  const body = d - door
  const tall = h >= 1.2
  // The freezer's share of the doors, from the Bespoke's 0.7 m in 2 m.
  const low = tall ? (h - toe) * 0.345 : 0
  const doors = tall
    ? [
        { y: toe, h: low - gap / 2, grip: 'top' as const },
        { y: toe + low + gap / 2, h: h - toe - low - gap / 2, grip: 'bottom' as const },
      ]
    : [{ y: toe, h: h - toe, grip: 'top' as const }]
  const grip = Math.min(0.32, h * 0.16)
  const dw = w - 0.004
  const inside = w - 0.04
  const mouth = front - door
  // While it is on the doors stand open, swung out on their hinges.
  const swing = open * 1.75
  return (
    <group>
      <Carcass w={w} h={h} d={body} z={mouth} skin={M('body')} />
      {/* The shelf between the freezer and the fridge. */}
      {tall && (
        <mesh position={[0, toe + low, mouth - body / 2]}>
          <boxGeometry args={[inside, 0.04, body - 0.02]} />
          {M('body')}
        </mesh>
      )}
      <Larder
        w={inside}
        y0={tall ? toe + low + 0.02 : 0.02}
        y1={h - 0.02}
        z={mouth}
        d={body - 0.02}
        shelves={tall ? 3 : 2}
        open={open}
      />
      {tall && (
        <Larder w={inside} y0={0.02} y1={toe + low - 0.02} z={mouth} d={body - 0.02} shelves={2} open={0} drawers />
      )}
      {/* The toe grille, set back under the lower door. */}
      <mesh position={[0, toe / 2, mouth + 0.004]}>
        <boxGeometry args={[w - 0.03, toe - 0.008, 0.02]} />
        {M('handles')}
      </mesh>
      {doors.map((dr, i) => (
        // Each door turns about its hinge, at the front of the edge away
        // from its grip.
        <group key={i} position={[(-side * w) / 2 + side * 0.002, 0, front]} rotation={[0, -side * swing, 0]}>
          <Panel size={[dw, dr.h, door]} position={[(side * dw) / 2, dr.y, -door / 2]} radius={0.01}>
            {M('doors')}
          </Panel>
          <group position={[(side * dw) / 2, 0, -door]}>
            <Bins w={inside} y={dr.y + 0.05} h={dr.h - 0.1} />
          </group>
          {/* The pocket grip, in the door's outer edge by the split. */}
          <Pocket
            size={[0.018, grip, door * 0.7]}
            position={[
              side * (dw - 0.006),
              dr.grip === 'top' ? dr.y + dr.h - grip / 2 - 0.01 : dr.y + grip / 2 + 0.01,
              -door * 0.35 + 0.001,
            ]}
          >
            {M('handles')}
          </Pocket>
        </group>
      ))}
    </group>
  )
}

// A side by side fridge freezer after the Samsung RS68A8840S9, 91.2 by 71.6
// by 178 cm: the freezer behind the narrower door on the left and the
// fridge on the right, both full height, with a long bar handle down each
// side of the split, an ice and water dispenser let into the freezer door
// and a toe grille under both.
export function SideBySide({ w, d, h, fit }: { w: number; d: number; h: number; fit: Fit }) {
  const { M, open } = fit
  const door = 0.06
  const toe = Math.min(0.06, h * 0.04)
  const gap = 0.006
  const front = d / 2
  const mouth = front - door
  const body = d - door
  const split = -w / 2 + w * 0.44
  const leaves: [number, number][] = [
    [-w / 2, split - gap / 2],
    [split + gap / 2, w / 2],
  ]
  const handle = Math.min(1.1, (h - toe) * 0.6)
  const handleY = toe + (h - toe) * 0.55
  const stand = 0.035
  // The dispenser, a dark recess at chest height in the middle of the
  // freezer door.
  const disp: [number, number] = [Math.min(0.2, w * 0.24), Math.min(0.32, h * 0.18)]
  const dispY = Math.min(h - disp[1] / 2 - 0.25, 1.1)
  // While it is on both doors stand open, each on its outer edge.
  const swing = open * 1.75
  return (
    <group>
      <Carcass w={w} h={h} d={body} z={mouth} skin={M('body')} />
      {/* The wall between the freezer and the fridge. */}
      <mesh position={[split, h / 2, mouth - body / 2]}>
        <boxGeometry args={[0.04, h - 0.04, body - 0.02]} />
        {M('body')}
      </mesh>
      <group position={[(-w / 2 + split) / 2, 0, 0]}>
        <Larder
          w={split + w / 2 - 0.06}
          y0={0.02}
          y1={h - 0.02}
          z={mouth}
          d={body - 0.02}
          shelves={4}
          open={0}
          drawers
        />
      </group>
      <group position={[(split + w / 2) / 2, 0, 0]}>
        <Larder w={w / 2 - split - 0.06} y0={0.02} y1={h - 0.02} z={mouth} d={body - 0.02} shelves={4} open={open} />
      </group>
      <mesh position={[0, toe / 2, mouth + 0.004]}>
        <boxGeometry args={[w - 0.03, toe - 0.008, 0.02]} />
        {M('handles')}
      </mesh>
      {leaves.map(([a, b], i) => {
        // The freezer hangs on its left edge and the fridge on its right.
        const hinge = i ? b : a
        const dir = i ? -1 : 1
        const lw = b - a - 0.002
        // The handle by the split, in the leaf's own frame.
        const hx = split + (i ? 1 : -1) * 0.045 - hinge
        return (
          <group key={i} position={[hinge, 0, front]} rotation={[0, -dir * swing, 0]}>
            <Panel size={[lw, h - toe, door]} position={[(dir * lw) / 2, toe, -door / 2]} radius={0.01}>
              {M('doors')}
            </Panel>
            <group position={[(dir * lw) / 2, 0, -door]}>
              <Bins w={lw - 0.06} y={toe + 0.1} h={h - toe - 0.3} />
            </group>
            {/* The bar handle, on two posts, by the split. */}
            <Bar length={handle} radius={0.012} position={[hx, handleY, stand]}>
              {M('handles')}
            </Bar>
            {[-1, 1].map(s => (
              <mesh
                key={s}
                position={[hx, handleY + s * (handle / 2 - 0.05), stand / 2]}
                rotation={[Math.PI / 2, 0, 0]}
              >
                <cylinderGeometry args={[0.009, 0.009, stand, 12]} />
                {M('handles')}
              </mesh>
            ))}
            {i === 0 && (
              <group position={[(dir * lw) / 2 - 0.02, 0, 0]}>
                <mesh position={[0, dispY, 0.001]}>
                  <boxGeometry args={[disp[0], disp[1], 0.03]} />
                  <meshStandardMaterial color="#1c1f21" roughness={0.5} />
                </mesh>
                {/* Its panel above it, and the spout in its top. */}
                <mesh position={[0, dispY + disp[1] / 2 + 0.04, 0.0015]}>
                  <planeGeometry args={[disp[0], 0.05]} />
                  <meshStandardMaterial color="#15181a" />
                </mesh>
                <mesh position={[0, dispY + disp[1] / 2 - 0.03, 0.004]}>
                  <boxGeometry args={[0.03, 0.04, 0.03]} />
                  {M('handles')}
                </mesh>
              </group>
            )}
          </group>
        )
      })}
    </group>
  )
}

// A lit window in a door: dark glass that glows warm while it runs.
function Window({
  size,
  position,
  fit,
  glow = 0.6,
}: {
  size: [number, number]
  position: [number, number, number]
  fit: Fit
  glow?: number
}) {
  return (
    <mesh position={position}>
      <planeGeometry args={size} />
      <Material
        color={fit.c('glass')}
        material={fit.m('glass')}
        emissive={[1, 0.72, 0.35]}
        emissiveIntensity={glow * fit.lit}
      />
    </mesh>
  )
}

// A bar handle standing off a door on two posts.
function BarHandle({ length, y, z, fit }: { length: number; y: number; z: number; fit: Fit }) {
  const off = 0.04
  return (
    <group>
      <Bar length={length} radius={0.01} rotation={[0, 0, Math.PI / 2]} position={[0, y, z + off]}>
        {fit.M('handle')}
      </Bar>
      {[-1, 1].map(s => (
        <mesh key={s} position={[(s * length) / 2 - s * 0.03, y, z + off / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.007, 0.007, off, 12]} />
          {fit.M('handle')}
        </mesh>
      ))}
    </group>
  )
}

// A built in oven after the Bosch Series 8 HBG7741B1, 59.4 by 54.8 by 59.5
// cm: a front all in black glass, a 10 cm control strip across the top with
// a display in the middle and touch keys either side, and a door with a
// long bar handle and a window that glows while it bakes.
export function Oven({ w, d, h, fit }: { w: number; d: number; h: number; fit: Fit }) {
  const { M } = fit
  const front = d / 2
  const strip = Math.min(0.1, h * 0.17)
  const doorH = h - strip - 0.004
  const face = 0.03
  return (
    <group>
      <Slab size={[w - 0.01, h - 0.01, d - face]} radius={0.01} bevel={0.004} position={[0, 0.005, -face / 2]}>
        {M('body')}
      </Slab>
      <Panel size={[w, strip, face]} position={[0, h - strip, front - face / 2]} radius={0.006}>
        {M('body')}
      </Panel>
      {/* The display, and a row of touch keys either side of it. */}
      <mesh position={[0, h - strip / 2, front + 0.0005]}>
        <planeGeometry args={[Math.min(0.11, w * 0.2), strip * 0.45]} />
        <Material
          color={fit.c('display')}
          material="ceramic"
          emissive={[1, 0.62, 0.3]}
          emissiveIntensity={0.9 * fit.lit}
        />
      </mesh>
      {[-1, 1].flatMap(s =>
        [0, 1, 2].map(i => (
          <mesh key={`${s}${i}`} position={[s * (w * 0.16 + i * w * 0.07), h - strip / 2, front + 0.0005]}>
            <circleGeometry args={[0.005, 16]} />
            <meshStandardMaterial color="#8a8f92" />
          </mesh>
        )),
      )}
      <Panel size={[w, doorH, face]} position={[0, 0, front - face / 2]} radius={0.006}>
        {M('body')}
      </Panel>
      <Window size={[w * 0.7, doorH * 0.52]} position={[0, doorH * 0.42, front + 0.0005]} fit={fit} />
      <BarHandle length={w * 0.8} y={doorH - 0.05} z={front} fit={fit} />
    </group>
  )
}

// A countertop microwave after the Bosch Serie 2 FFL023MS2B, 44 by 35 by 26
// cm: a black glass door across most of the front with the window in it,
// and a steel column on the right with a small display, a dial and the
// button that opens the door.
export function Microwave({ w, d, h, fit }: { w: number; d: number; h: number; fit: Fit }) {
  const { M } = fit
  const front = d / 2
  const face = 0.02
  const column = Math.min(w * 0.26, 0.12)
  const doorW = w - column - 0.004
  const doorX = -w / 2 + doorW / 2
  const colX = w / 2 - column / 2
  return (
    <group>
      <Slab size={[w, h, d - face]} radius={0.012} bevel={0.006} position={[0, 0, -face / 2]}>
        {M('body')}
      </Slab>
      <Panel size={[doorW, h - 0.006, face]} position={[doorX, 0.003, front - face / 2]} radius={0.008}>
        {M('door')}
      </Panel>
      <Window
        size={[doorW * 0.74, (h - 0.006) * 0.66]}
        position={[doorX - doorW * 0.04, h / 2, front + 0.0005]}
        fit={fit}
        glow={0.9}
      />
      <Panel size={[column, h - 0.006, face]} position={[colX, 0.003, front - face / 2]} radius={0.008}>
        {M('body')}
      </Panel>
      <mesh position={[colX, h * 0.8, front + 0.0005]}>
        <planeGeometry args={[column * 0.6, h * 0.1]} />
        <Material color="#16191b" material="ceramic" emissive={[0.6, 1, 0.7]} emissiveIntensity={0.9 * fit.lit} />
      </mesh>
      <mesh position={[colX, h * 0.5, front + 0.008]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[column * 0.26, column * 0.28, 0.016, 32]} />
        {M('knobs')}
      </mesh>
      <Slab
        size={[column * 0.55, h * 0.1, 0.008]}
        radius={0.004}
        bevel={0.002}
        position={[colX, h * 0.14, front + 0.004]}
      >
        {M('knobs')}
      </Slab>
    </group>
  )
}

// A freestanding dishwasher after the Bosch Serie 6 SMS6ZCI00G, 60 by 60 by
// 84.5 cm: a worktop on a steel cabinet, a 7 cm control fascia along the top
// of the door with a display and keys, the grip cut in under it, and a
// plinth set back at the toe.
export function Dishwasher({ w, d, h, fit }: { w: number; d: number; h: number; fit: Fit }) {
  const { M, open } = fit
  const front = d / 2
  const top = 0.025
  const face = 0.03
  const toe = Math.min(0.08, h * 0.1)
  const fascia = Math.min(0.07, h * 0.09)
  const doorTop = h - top - 0.004
  const mouth = front - face
  const body = d - face
  const tub = h - top - toe
  const inside = w - 0.05
  const racks = [toe + 0.06, toe + tub * 0.55]
  return (
    <group>
      <group position={[0, toe, 0]}>
        <Carcass w={w - 0.004} h={tub} d={body} z={mouth} skin={M('body')} />
      </group>
      {/* Two wire racks, plates standing in the lower one and cups in the
          upper. */}
      {racks.map((y, r) => (
        <group key={r} position={[0, y, mouth - body / 2]}>
          {[-1, 1].map(s => (
            <mesh key={s} position={[(s * inside) / 2, 0.04, 0]}>
              <boxGeometry args={[0.004, 0.08, body - 0.06]} />
              <meshStandardMaterial color="#c3c9cc" metalness={0.2} roughness={0.4} />
            </mesh>
          ))}
          {[-1, 1].map(s => (
            <mesh key={s} position={[0, 0.04, (s * (body - 0.06)) / 2]}>
              <boxGeometry args={[inside, 0.08, 0.004]} />
              <meshStandardMaterial color="#c3c9cc" metalness={0.2} roughness={0.4} />
            </mesh>
          ))}
          <mesh>
            <boxGeometry args={[inside, 0.004, body - 0.06]} />
            <meshStandardMaterial color="#c3c9cc" metalness={0.2} roughness={0.4} />
          </mesh>
          {r === 0
            ? Array.from({ length: 7 }, (_, i) => (
                <mesh key={i} position={[-inside * 0.36 + i * inside * 0.12, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.1, 0.1, 0.008, SEG]} />
                  <meshStandardMaterial color="#f4f2ec" roughness={0.3} />
                </mesh>
              ))
            : [-1, 0, 1].map(i => (
                <mesh key={i} position={[i * inside * 0.28, 0.05, 0]} rotation={[Math.PI, 0, 0]}>
                  <cylinderGeometry args={[0.04, 0.032, 0.09, 20]} />
                  <meshStandardMaterial color="#f4f2ec" roughness={0.3} />
                </mesh>
              ))}
        </group>
      ))}
      <Slab size={[w, top, d]} radius={0.01} bevel={0.004} position={[0, h - top, 0]}>
        {M('top')}
      </Slab>
      {/* The plinth, set back under the door. */}
      <mesh position={[0, toe / 2, front - face + 0.008]}>
        <boxGeometry args={[w - 0.01, toe, 0.016]} />
        {M('controls')}
      </mesh>
      {/* The door, hinged along its foot, drops open while it is on. */}
      <group position={[0, toe, front]} rotation={[open * 1.5, 0, 0]}>
        <group position={[0, -toe, 0]}>
          <Panel size={[w - 0.004, fascia, face]} position={[0, doorTop - fascia, -face / 2]} radius={0.004}>
            {M('door')}
          </Panel>
          <mesh position={[0, doorTop - fascia / 2, 0.0005]}>
            <planeGeometry args={[Math.min(0.12, w * 0.2), fascia * 0.4]} />
            <Material
              color={fit.c('controls')}
              material="ceramic"
              emissive={[0.7, 0.85, 1]}
              emissiveIntensity={1.6 * fit.lit}
            />
          </mesh>
          {[-3, -2, -1, 1, 2, 3].map(i => (
            <mesh key={i} position={[i * w * 0.07 + Math.sign(i) * w * 0.05, doorTop - fascia / 2, 0.0005]}>
              <circleGeometry args={[0.005, 16]} />
              {M('controls')}
            </mesh>
          ))}
          {/* The grip: a dark slot under the fascia, cut only part way into
              the door, and the door carried on behind it. Run through the
              whole door, its back face lay on the inner face and fought it. */}
          <mesh position={[0, doorTop - fascia - 0.012, -face * 0.25 + 0.001]}>
            <boxGeometry args={[w * 0.7, 0.024, face * 0.5]} />
            {M('controls')}
          </mesh>
          <mesh position={[0, doorTop - fascia - 0.012, -face * 0.75]}>
            <boxGeometry args={[w - 0.004, 0.024, face * 0.5]} />
            {M('door')}
          </mesh>
          <Panel size={[w - 0.004, doorTop - fascia - 0.024 - toe, face]} position={[0, toe, -face / 2]} radius={0.004}>
            {M('door')}
          </Panel>
          {/* The steel inner face of the door. */}
          <mesh position={[0, (doorTop + toe) / 2, -face - 0.001]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[inside, doorTop - toe - 0.04]} />
            <meshStandardMaterial color="#cdd2d4" metalness={0.2} roughness={0.35} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

// Where the zones or burners of a hob go: one column on a narrow domino,
// two on a standard 60 cm hob and a third, in the middle, from 75 cm. Each
// place has a radius fitted to its share of the top, scaled by the size the
// reference gives it.
function hobPlaces(w: number, d: number, sizes: number[][]) {
  const cols = w < 0.45 ? 1 : w < 0.75 ? 2 : 3
  const cellW = w / cols
  const cellD = d / 2
  const places: { x: number; z: number; r: number; i: number }[] = []
  for (let col = 0; col < cols; col++) {
    const x = -w / 2 + cellW * (col + 0.5)
    // The middle column holds one big zone rather than two.
    if (cols === 3 && col === 1) {
      places.push({ x, z: 0, r: Math.min(cellW, d) * 0.4, i: places.length })
      continue
    }
    const pair = sizes[Math.min(col === 0 ? 0 : 1, sizes.length - 1)]
    for (let row = 0; row < 2; row++) {
      const z = -d / 2 + cellD * (row + 0.5)
      places.push({ x, z, r: Math.min(cellW, cellD) * 0.5 * pair[row], i: places.length })
    }
  }
  return places
}

// A hob. The induction style is after the Bosch Serie 6 PIE631FB1E: a
// frameless black glass top, 59.2 by 52.2 cm, with four printed zones of
// 18, 21, 14.5 and 18 cm and a touch strip along the front that glow red
// while it cooks. The gas style is after the Bosch Serie 6 PGH6B5B90: a
// brushed steel top, 58.2 by 52 cm, four burners under two cast iron grids
// and a row of knobs along the front, the flames blue while it runs.
export function Hob({ style, w, d, fit }: { style: string; w: number; d: number; fit: Fit }) {
  return style === 'gas' ? <GasHob w={w} d={d} fit={fit} /> : <InductionHob w={w} d={d} fit={fit} />
}

function InductionHob({ w, d, fit }: { w: number; d: number; fit: Fit }) {
  const { M, c, lit, level } = fit
  const glass = 0.006
  const strip = Math.min(0.07, d * 0.14)
  // Back and front zone on each side, as a share of their cell: the left
  // pair 18 and 21 cm, the right 14.5 and 18 cm.
  const places = hobPlaces(w - 0.04, d - strip - 0.02, [
    [0.72, 0.84],
    [0.58, 0.72],
  ])
  const zoneZ = -strip / 2
  const glow = 1.6 * level * lit
  return (
    <group>
      <Slab size={[w, glass, d]} radius={0.006} bevel={0.002} position={[0, 0, 0]}>
        {M('glass')}
      </Slab>
      {places.map(z => (
        <group key={z.i} position={[z.x, glass + 0.0004, z.z + zoneZ]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh>
            <ringGeometry args={[z.r - 0.003, z.r, SEG * 2]} />
            <meshStandardMaterial color={c('zones')} emissive="#ff4a1a" emissiveIntensity={glow} />
          </mesh>
          {/* The coil under the glass shows through as a red disc when on. */}
          <mesh position={[0, 0, -0.0002]}>
            <circleGeometry args={[z.r * 0.92, SEG * 2]} />
            <meshStandardMaterial
              color={c('glass')}
              emissive="#ff3a10"
              emissiveIntensity={0.9 * glow}
              transparent
              opacity={lit}
            />
          </mesh>
        </group>
      ))}
      {/* The touch strip: a slider in the middle and keys either side. */}
      <group position={[0, glass + 0.0004, d / 2 - strip / 2 - 0.005]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh>
          <planeGeometry args={[Math.min(0.2, w * 0.34), 0.008]} />
          <meshStandardMaterial color={c('zones')} emissive="#ff4a1a" emissiveIntensity={0.6 * lit} />
        </mesh>
        {[-3, -2, -1, 1, 2, 3].map(i => (
          <mesh key={i} position={[Math.sign(i) * Math.min(0.12, w * 0.2) + i * 0.022, 0, 0]}>
            <ringGeometry args={[0.004, 0.0055, 20]} />
            <meshStandardMaterial color={c('zones')} emissive="#ff4a1a" emissiveIntensity={0.4 * lit} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// A bar of the cast iron grid, laid flat from one point to another.
function Rail({ from, to, y, fit }: { from: [number, number]; to: [number, number]; y: number; fit: Fit }) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  return (
    <mesh position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]}>
      <boxGeometry args={[length, 0.012, 0.008]} />
      {fit.M('grids')}
    </mesh>
  )
}

// The flame of a gas burner: a ring of small tongues leaning out from the
// crown, a pale blue core in each deep blue one, with a soft glow on the
// ring under them. Each tongue flickers on its own.
function GasFlame({ radius, y, level }: { radius: number; y: number; level: number }) {
  const count = Math.max(14, Math.round(radius * 900))
  const tongues = useRef<(Group | null)[]>([])
  useLive(level > 0.001)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    tongues.current.forEach((g, i) => {
      if (!g) return
      const f = 0.8 + 0.2 * Math.sin(t * 17 + i * 2.3) + 0.12 * Math.sin(t * 31 + i * 5.1)
      g.scale.set(1, f * (0.45 + 0.55 * level), 1)
    })
  })
  const tall = 0.022
  return (
    <group position={[0, y, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.004, 8, SEG]} />
        <meshBasicMaterial color="#6fa2ff" transparent opacity={0.9 * level} toneMapped={false} />
      </mesh>
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2
        return (
          <group key={i} position={[Math.cos(a) * radius, 0, Math.sin(a) * radius]} rotation={[0, -a, 0]}>
            {/* Leaning out and up, as the gas leaves the crown sideways. */}
            <group rotation={[0, 0, -0.75]}>
              <group ref={el => void (tongues.current[i] = el)}>
                <mesh position={[0, tall / 2, 0]}>
                  <coneGeometry args={[0.005, tall, 8]} />
                  <meshBasicMaterial
                    color="#2f63ff"
                    transparent
                    opacity={0.75 * level}
                    toneMapped={false}
                    depthWrite={false}
                  />
                </mesh>
                <mesh position={[0, tall * 0.3, 0]}>
                  <coneGeometry args={[0.0028, tall * 0.55, 8]} />
                  <meshBasicMaterial
                    color="#bcd6ff"
                    transparent
                    opacity={0.9 * level}
                    toneMapped={false}
                    depthWrite={false}
                  />
                </mesh>
              </group>
            </group>
          </group>
        )
      })}
    </group>
  )
}

function GasHob({ w, d, fit }: { w: number; d: number; fit: Fit }) {
  const { M, lit, level } = fit
  const top = 0.01
  const band = Math.min(0.08, d * 0.16)
  const field = d - band
  const fieldZ = -band / 2
  // Standard burners on the left, the wok behind and the small economy
  // burner in front on the right.
  const places = hobPlaces(w - 0.02, field - 0.02, [
    [0.6, 0.6],
    [0.8, 0.45],
  ])
  const cols = w < 0.45 ? 1 : w < 0.75 ? 2 : 3
  const cellW = (w - 0.02) / cols
  const gridY = top + 0.03
  const flame = level * lit
  return (
    <group>
      <Slab size={[w, top, d]} radius={0.01} bevel={0.003} position={[0, 0, 0]}>
        {M('top')}
      </Slab>
      {places.map(b => {
        const wok = b.r > 0.8 * Math.min(cellW, (field - 0.02) / 2) * 0.5
        const crown = b.r * 0.55
        return (
          <group key={b.i} position={[b.x, top, b.z + fieldZ]}>
            {/* The drip bowl, the brass crown and its black cap. */}
            <mesh position={[0, 0.002, 0]}>
              <cylinderGeometry args={[crown * 1.25, crown * 1.35, 0.004, SEG]} />
              {M('top')}
            </mesh>
            <mesh position={[0, 0.012, 0]}>
              <cylinderGeometry args={[crown, crown * 1.05, 0.016, SEG]} />
              {M('burners')}
            </mesh>
            <mesh position={[0, 0.022, 0]}>
              <cylinderGeometry args={[crown * 0.85, crown * 0.95, 0.006, SEG]} />
              {M('grids')}
            </mesh>
            {wok && (
              <mesh position={[0, 0.026, 0]}>
                <cylinderGeometry args={[crown * 0.4, crown * 0.45, 0.008, SEG]} />
                {M('burners')}
              </mesh>
            )}
            {flame > 0.01 && <GasFlame radius={crown * 1.04} y={0.014} level={flame} />}
          </group>
        )
      })}
      {/* Cast iron grids, one per column: a frame round each cell and a
          finger from each side of it reaching in to hold the pan. */}
      {Array.from({ length: cols }).map((_, col) => {
        const x0 = -(w - 0.02) / 2 + cellW * col + 0.006
        const x1 = x0 + cellW - 0.012
        const z0 = fieldZ - (field - 0.02) / 2
        const z1 = fieldZ + (field - 0.02) / 2
        const mid = (z0 + z1) / 2
        const rails: [[number, number], [number, number]][] = [
          [
            [x0, z0],
            [x1, z0],
          ],
          [
            [x0, z1],
            [x1, z1],
          ],
          [
            [x0, z0],
            [x0, z1],
          ],
          [
            [x1, z0],
            [x1, z1],
          ],
        ]
        if (!(cols === 3 && col === 1))
          rails.push([
            [x0, mid],
            [x1, mid],
          ])
        const cells = places.filter(b => Math.abs(b.x - (x0 + x1) / 2) < cellW / 2)
        for (const b of cells) {
          const bz = b.z + fieldZ
          const inner = b.r * 0.62
          const halfZ = cols === 3 && col === 1 ? (z1 - z0) / 2 : (z1 - z0) / 4
          const cx = b.x
          rails.push([
            [x0, bz],
            [cx - inner, bz],
          ])
          rails.push([
            [cx + inner, bz],
            [x1, bz],
          ])
          rails.push([
            [cx, bz - halfZ],
            [cx, bz - inner],
          ])
          rails.push([
            [cx, bz + inner],
            [cx, bz + halfZ],
          ])
        }
        return (
          <group key={col}>
            {rails.map(([a, b], i) => (
              <Rail key={i} from={a} to={b} y={gridY} fit={fit} />
            ))}
            {/* Rubber feet at the corners. */}
            {[
              [x0, z0],
              [x1, z0],
              [x0, z1],
              [x1, z1],
            ].map(([fx, fz], i) => (
              <mesh key={`f${i}`} position={[fx, top + (gridY - top) / 2, fz]}>
                <boxGeometry args={[0.012, gridY - top, 0.012]} />
                {M('grids')}
              </mesh>
            ))}
          </group>
        )
      })}
      {/* Knobs along the front, one per burner. */}
      {places.map((_, i) => {
        const x = -w / 2 + (w * (i + 1)) / (places.length + 1)
        return (
          <group key={`k${i}`} position={[x, top, d / 2 - band / 2]}>
            <mesh position={[0, 0.012, 0]}>
              <cylinderGeometry args={[0.019, 0.021, 0.024, 32]} />
              {M('knobs')}
            </mesh>
            <mesh position={[0, 0.0245, -0.008]}>
              <boxGeometry args={[0.004, 0.002, 0.014]} />
              {M('top')}
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// A box hood after the Bosch DWB66DM50: a thin steel canopy 5.3 cm deep
// with a chimney about 25 by 20 cm up to the ceiling, set against the wall
// behind. Underneath, steel grease filters side by side and two LED spots at
// the front. A ceiling item hangs from nothing, so the canopy is placed by
// how far below the ceiling it sits: its underside is 1.55 m off the floor,
// about 65 cm over a hob.
export function Hood({ w, d, fit }: { w: number; d: number; fit: Fit }) {
  const { M, c, lit, level } = fit
  const canopy = 0.053
  const y = -(CEILING_HEIGHT_M - 1.55)
  const chimney: [number, number] = [Math.min(0.25, w * 0.45), Math.min(0.2, d * 0.45)]
  const filters = Math.max(1, Math.round((w - 0.06) / 0.28))
  const fw = (w - 0.06) / filters
  return (
    <group>
      <Slab size={[w, canopy, d]} radius={0.006} bevel={0.003} position={[0, y, 0]}>
        {M('canopy')}
      </Slab>
      <Slab
        size={[chimney[0], -y - canopy, chimney[1]]}
        radius={0.004}
        bevel={0.002}
        position={[0, y + canopy, -d / 2 + chimney[1] / 2]}
      >
        {M('chimney')}
      </Slab>
      {/* The grease filters, a little proud of the underside. */}
      {Array.from({ length: filters }, (_, i) => (
        <Slab
          key={i}
          size={[fw - 0.006, 0.004, d - 0.1]}
          radius={0.004}
          bevel={0.001}
          position={[-w / 2 + 0.03 + fw * (i + 0.5), y - 0.004, -0.02]}
        >
          {M('filter')}
        </Slab>
      ))}
      {/* Two LED spots in the front strip, lit with the fan. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * w * 0.3, y - 0.001, d / 2 - 0.035]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.018, SEG]} />
          <meshStandardMaterial color={c('filter')} emissive="#ffe2b8" emissiveIntensity={2 * level * lit} />
        </mesh>
      ))}
      {/* The touch keys along the right of the front edge. */}
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} position={[w / 2 - 0.05 - i * 0.03, y + canopy / 2, d / 2 + 0.0005]}>
          <circleGeometry args={[0.006, 20]} />
          {M('controls')}
        </mesh>
      ))}
    </group>
  )
}

// A flush ceiling extractor after the Novy Pureline 6830, 86.8 by 50.8 cm:
// a flat panel in the ceiling with a slot all the way round it that the air
// is drawn through, and an LED strip along each long side that comes up
// with the fan.
export function CeilingExtractor({ w, d, fit }: { w: number; d: number; fit: Fit }) {
  const { M, c, lit, level } = fit
  const frame = 0.012
  const edge = Math.min(0.03, w * 0.05, d * 0.05)
  const slot = 0.012
  const inner: [number, number] = [w - (edge + slot) * 2, d - (edge + slot) * 2]
  return (
    <group>
      <Slab size={[w, frame, d]} radius={0.006} bevel={0.002} position={[0, -frame, 0]}>
        {M('panel')}
      </Slab>
      {/* The slot, a dark ring just under the frame's face. */}
      <Slab
        size={[w - edge * 2, 0.002, d - edge * 2]}
        radius={0.004}
        bevel={0}
        position={[0, -frame - 0.001, 0]}
        holes={[{ x: 0, z: 0, w: inner[0], d: inner[1], r: 0.003 }]}
      >
        {M('grille')}
      </Slab>
      {/* The middle panel, the part that lifts off to reach the filters. */}
      <Slab size={[inner[0], 0.004, inner[1]]} radius={0.003} bevel={0.001} position={[0, -frame - 0.003, 0]}>
        {M('panel')}
      </Slab>
      {[-1, 1].map(s => (
        <mesh key={s} position={[0, -frame - 0.0035, s * (inner[1] / 2 - 0.025)]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[inner[0] - 0.08, 0.012]} />
          <meshStandardMaterial color={c('panel')} emissive="#ffe2b8" emissiveIntensity={1.8 * level * lit} />
        </mesh>
      ))}
    </group>
  )
}

// A coffee machine in one of three styles, from the big espresso machine
// down to a pod machine a hand wide.
export function CoffeeMachine({ style, w, d, h, fit }: { style?: string; w: number; d: number; h: number; fit: Fit }) {
  const body =
    style === 'bambino' ? (
      <CompactEspresso w={w} d={d} h={h} fit={fit} />
    ) : style === 'pod' ? (
      <PodMachine w={w} d={d} h={h} fit={fit} />
    ) : (
      <LineaEspresso w={w} d={d} h={h} fit={fit} />
    )
  // While it is on, a warm light over the cup and a wisp of steam off the
  // hot top.
  return (
    <group>
      {body}
      <Halo on={fit.on} position={[0, h * 0.35, d / 2 + 0.04]} color="#ffd2a0" intensity={0.12} distance={0.5} />
      <Steam on={fit.on} position={[0, h + 0.01, 0]} radius={w * 0.1} rise={0.22} count={8} strength={0.1} />
    </group>
  )
}

// A compact espresso machine after the Sage Bambino, 19.5 by 32 by 31 cm: a
// brushed steel box with a head over the cup recess, a portafilter with a
// black handle, four round buttons across the head's front, a steam wand on
// its right and a drip tray at the foot of the recess.
function CompactEspresso({ w, d, h, fit }: { w: number; d: number; h: number; fit: Fit }) {
  const { M } = fit
  const recess = d * 0.28
  const headY = Math.min(h * 0.42, 0.14)
  const group = Math.min(0.029, w * 0.15)
  const buttons = 4
  const pitch = Math.min(0.03, (w - 0.04) / buttons)
  return (
    <group>
      <Slab size={[w, h, d - recess]} radius={0.02} bevel={0.006} position={[0, 0, -recess / 2]}>
        {M('body')}
      </Slab>
      <Slab size={[w, h - headY, recess]} radius={0.02} bevel={0.006} position={[0, headY, d / 2 - recess / 2]}>
        {M('body')}
      </Slab>
      {/* The drip tray, and its grate. */}
      <Slab size={[w - 0.01, 0.028, recess]} radius={0.01} bevel={0.003} position={[0, 0, d / 2 - recess / 2]}>
        {M('steel')}
      </Slab>
      <mesh position={[0, 0.0285, d / 2 - recess / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w - 0.04, recess - 0.03]} />
        <meshStandardMaterial color="#1c1f21" roughness={0.6} />
      </mesh>
      {/* The group head and the portafilter locked in under it. */}
      <group position={[0, headY, d / 2 - recess * 0.5]}>
        <mesh position={[0, -0.01, 0]}>
          <cylinderGeometry args={[group, group, 0.02, SEG]} />
          {M('steel')}
        </mesh>
        <mesh position={[0, -0.034, 0]}>
          <cylinderGeometry args={[group * 1.05, group * 0.85, 0.028, SEG]} />
          {M('steel')}
        </mesh>
        <Tube
          radius={0.011}
          points={[
            [0, -0.034, group * 0.8],
            [0, -0.038, group + 0.04],
            [0, -0.046, group + 0.1],
          ]}
        >
          {M('handle')}
        </Tube>
      </group>
      {/* The buttons across the head's front, lit while it is on. */}
      {Array.from({ length: buttons }, (_, i) => (
        <group key={i} position={[(i - (buttons - 1) / 2) * pitch, h - 0.045, d / 2 + 0.002]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.009, 0.009, 0.006, 24]} />
            {M('handle')}
          </mesh>
          <Led on={fit.on} radius={0.003} color="#f2f5f7" position={[0, 0, 0.004]} />
        </group>
      ))}
      {/* The steam wand, out of the right of the head and down. */}
      <Tube
        radius={0.005}
        points={[
          [w / 2 - 0.02, headY + 0.02, d / 2 - 0.01],
          [w / 2 + 0.01, headY - 0.005, d / 2 + 0.005],
          [w / 2 + 0.015, headY - 0.1, d / 2 + 0.01],
        ]}
      >
        {M('steel')}
      </Tube>
    </group>
  )
}

// A pod machine after the Nespresso Essenza Mini, 8.4 by 33 by 20.4 cm: a
// narrow body rounded over the top, the brewing head overhanging its front
// with a lever to load the capsule, a spout under it, a cup grid at the
// foot, and a clear water tank on its back. Two buttons on top glow while
// it is on.
function PodMachine({ w, d, h, fit }: { w: number; d: number; h: number; fit: Fit }) {
  const { M } = fit
  const tank = d * 0.3
  const over = d * 0.34
  const headH = h * 0.36
  const r = Math.min(w / 2 - 0.002, 0.03)
  return (
    <group>
      {/* The base, the full length of the machine. */}
      <Slab size={[w, 0.02, d]} radius={Math.min(0.015, r)} bevel={0.004}>
        {M('body')}
      </Slab>
      {/* The body between the tank and the cup. */}
      <Slab
        size={[w, h, d - tank - over]}
        radius={r}
        bevel={0.006}
        position={[0, 0, -d / 2 + tank + (d - tank - over) / 2]}
      >
        {M('body')}
      </Slab>
      {/* The head over the cup, with the lever lying along its top. */}
      <Slab size={[w, headH, over]} radius={r} bevel={0.006} position={[0, h - headH, d / 2 - over / 2]}>
        {M('body')}
      </Slab>
      <Slab
        size={[w * 0.5, 0.012, over * 0.85]}
        radius={0.005}
        bevel={0.002}
        position={[0, h, d / 2 - over / 2 - 0.01]}
      >
        {M('accent')}
      </Slab>
      {/* The spout under the head. */}
      <mesh position={[0, h - headH - 0.008, d / 2 - over * 0.45]}>
        <cylinderGeometry args={[0.009, 0.007, 0.016, 20]} />
        {M('accent')}
      </mesh>
      {/* The cup grid, over a drip tray at the foot. */}
      <Slab size={[w - 0.008, 0.012, over - 0.01]} radius={0.004} bevel={0.002} position={[0, 0.02, d / 2 - over / 2]}>
        {M('accent')}
      </Slab>
      {/* The water tank, clear, with the water in it. */}
      <Slab
        size={[w - 0.006, h * 0.86, tank]}
        radius={Math.min(r, 0.02)}
        bevel={0.004}
        position={[0, 0.02, -d / 2 + tank / 2]}
      >
        <meshPhysicalMaterial color="#d7e3e8" transparent opacity={0.35} roughness={0.08} />
      </Slab>
      <Slab
        size={[w - 0.02, h * 0.5, tank - 0.02]}
        radius={0.01}
        bevel={0.002}
        position={[0, 0.025, -d / 2 + tank / 2]}
      >
        <meshStandardMaterial color="#a9c6d2" transparent opacity={0.4} roughness={0.1} />
      </Slab>
      {/* The two buttons on top of the body, behind the lever. */}
      {[0, 1].map(i => (
        <group key={i} position={[0, h + 0.002, -d / 2 + tank + 0.025 + i * 0.03]}>
          <mesh>
            <cylinderGeometry args={[0.01, 0.01, 0.006, 24]} />
            {M('accent')}
          </mesh>
          <Led on={fit.on} radius={0.004} color="#f2f5f7" position={[0, 0.003, 0]} />
        </group>
      ))}
    </group>
  )
}

// An espresso machine after the La Marzocco Linea Mini, 36 by 45 by 38 cm:
// a steel box on short feet with colored side panels, the group head under
// its front, a portafilter with a wooden handle and a paddle over it, a
// steam wand on the right and a hot water tap on the left, a drip tray in
// the recess below and a rail round the cup tray on top.
function LineaEspresso({ w, d, h, fit }: { w: number; d: number; h: number; fit: Fit }) {
  const { M } = fit
  const feet = 0.015
  const body = h - feet
  // The recess the cups stand in, under the head, as a share of the depth.
  const recess = d * 0.3
  // The cups stand under the head at the same height however tall the
  // machine is made; only the box above it grows.
  const headY = feet + Math.min(body * 0.5, 0.19)
  const side = 0.012
  const group = Math.min(0.036, w * 0.1)
  const slots = Math.max(2, Math.floor((w - 0.06) / 0.02))
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}${sz}`} position={[sx * (w / 2 - 0.04), feet / 2, sz * (d / 2 - 0.05)]}>
            <cylinderGeometry args={[0.012, 0.014, feet, 16]} />
            {M('steel')}
          </mesh>
        )),
      )}
      {/* The back block, full height, and the head over the recess. */}
      <Slab size={[w - side * 2, body, d - recess]} radius={0.01} bevel={0.004} position={[0, feet, -recess / 2]}>
        {M('steel')}
      </Slab>
      <Slab
        size={[w - side * 2, body - (headY - feet), recess]}
        radius={0.01}
        bevel={0.004}
        position={[0, headY, d / 2 - recess / 2]}
      >
        {M('steel')}
      </Slab>
      {/* The colored side panels. */}
      {[-1, 1].map(s => (
        <Slab key={s} size={[side, body, d]} radius={0.004} bevel={0.002} position={[s * (w / 2 - side / 2), feet, 0]}>
          {M('body')}
        </Slab>
      ))}
      {/* The drip tray, a grate over the base of the recess. */}
      <Slab
        size={[w - side * 2 - 0.01, 0.03, recess - 0.01]}
        radius={0.006}
        bevel={0.002}
        position={[0, feet, d / 2 - recess / 2]}
      >
        {M('steel')}
      </Slab>
      {Array.from({ length: slots }, (_, i) => (
        <mesh key={i} position={[-(slots - 1) * 0.01 + i * 0.02, feet + 0.0305, d / 2 - recess / 2]}>
          <boxGeometry args={[0.004, 0.001, recess - 0.03]} />
          <meshStandardMaterial color="#1c1f21" roughness={0.6} />
        </mesh>
      ))}
      {/* The group head, the portafilter hanging from it and its handle. */}
      <group position={[0, headY, d / 2 - recess * 0.45]}>
        <mesh position={[0, -0.012, 0]}>
          <cylinderGeometry args={[group, group * 1.05, 0.024, SEG]} />
          {M('steel')}
        </mesh>
        <mesh position={[0, -0.04, 0]}>
          <cylinderGeometry args={[group * 1.02, group * 0.9, 0.032, SEG]} />
          {M('steel')}
        </mesh>
        <Tube
          radius={0.012}
          points={[
            [0, -0.04, group * 0.8],
            [0, -0.045, group + 0.05],
            [0, -0.055, group + 0.12],
          ]}
        >
          {M('wood')}
        </Tube>
      </group>
      {/* The brew paddle on top of the head. */}
      <Bar
        length={0.07}
        radius={0.007}
        rotation={[0, 0, Math.PI / 2 - 0.3]}
        position={[0.02, feet + body + 0.012, d / 2 - recess * 0.45]}
      >
        {M('wood')}
      </Bar>
      {/* The steam wand on the right and the hot water tap on the left, each
          with its wooden knob on the side panel. */}
      {[-1, 1].map(s => (
        <group key={s}>
          <Tube
            radius={0.0055}
            points={[
              [s * (w / 2 - side - 0.03), headY + 0.01, d / 2 - 0.02],
              [s * (w / 2 - side - 0.025), headY - 0.02, d / 2 + 0.01],
              [s * (w / 2 - side - 0.02), headY - (s > 0 ? 0.14 : 0.06), d / 2 + 0.025],
            ]}
          >
            {M('steel')}
          </Tube>
          <mesh
            position={[s * (w / 2 + 0.012), headY + body * 0.25, d / 2 - recess * 0.5]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.018, 0.02, 0.024, SEG]} />
            {M('wood')}
          </mesh>
        </group>
      ))}
      {/* The rail round the cup tray on top. */}
      {[-1, 1].map(s => (
        <Bar
          key={s}
          length={d - 0.06}
          radius={0.004}
          rotation={[Math.PI / 2, 0, 0]}
          position={[s * (w / 2 - side - 0.01), feet + body + 0.02, 0]}
        >
          {M('steel')}
        </Bar>
      ))}
      <Bar
        length={w - side * 2 - 0.02}
        radius={0.004}
        rotation={[0, 0, Math.PI / 2]}
        position={[0, feet + body + 0.02, -d / 2 + 0.03]}
      >
        {M('steel')}
      </Bar>
      <Led on={fit.on} radius={0.005} position={[-w / 2 + side + 0.03, headY + body * 0.3, d / 2 + 0.001]} />
    </group>
  )
}

// A kettle, the modern jug by default or the pour over gooseneck.
export function Kettle({ style, size, fit }: { style?: string; size: number; fit: Fit }) {
  if (style === 'gooseneck') return <Gooseneck size={size} fit={fit} />
  return <JugKettle size={size} fit={fit} />
}

// A jug kettle after the Xiaomi Mi Smart Kettle Pro: a plain upright
// cylinder narrowing a touch to the top, a flat lid with a round release
// button, a small pouring lip at the front and a D handle behind, on a
// round power base with a ring that glows while it boils. `size` is the
// jug's width.
function JugKettle({ size, fit }: { size: number; fit: Fit }) {
  const { M, c, lit } = fit
  const r = size / 2
  const base = r * 0.2
  const h = r * 2.5
  const top = base + h
  return (
    <group>
      <mesh position={[0, base / 2, 0]}>
        <cylinderGeometry args={[r * 1.04, r * 1.06, base, SEG * 2]} />
        {M('fittings')}
      </mesh>
      <mesh position={[0, base + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.98, r * 1.04, SEG * 2]} />
        <meshStandardMaterial color={c('fittings')} emissive="#8fd0ff" emissiveIntensity={1.4 * lit} />
      </mesh>
      <mesh position={[0, base + h / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.94, r, h, SEG * 2]} />
        {M('body')}
      </mesh>
      {/* The lid, flush with the rim, and its release button. */}
      <mesh position={[0, top + r * 0.02, 0]}>
        <cylinderGeometry args={[r * 0.9, r * 0.94, r * 0.04, SEG * 2]} />
        {M('fittings')}
      </mesh>
      <mesh position={[-r * 0.45, top + r * 0.05, 0]}>
        <cylinderGeometry args={[r * 0.14, r * 0.14, r * 0.04, 24]} />
        {M('body')}
      </mesh>
      {/* The pouring lip, a short flared beak at the front of the rim. */}
      <mesh position={[r * 0.97, top - r * 0.06, 0]} rotation={[0, 0, -Math.PI / 2 - 0.5]} scale={[1, 1, 1.4]}>
        <coneGeometry args={[r * 0.14, r * 0.3, 3, 1, true]} />
        <meshStandardMaterial color={c('body')} side={2} roughness={0.5} />
      </mesh>
      {/* The D handle off the back. */}
      <Tube
        radius={r * 0.11}
        points={[
          [-r * 0.9, top - r * 0.15, 0],
          [-r * 1.35, top - r * 0.2, 0],
          [-r * 1.5, base + h * 0.55, 0],
          [-r * 1.4, base + h * 0.2, 0],
          [-r * 0.92, base + h * 0.12, 0],
        ]}
      >
        {M('fittings')}
      </Tube>
      <Steam
        on={fit.on}
        position={[r * 1.02, top + r * 0.1, 0]}
        radius={r * 0.35}
        rise={r * 3}
        count={10}
        strength={0.16}
        speed={0.5}
      />
    </group>
  )
}

// A pour over kettle after the Fellow Stagg EKG: a squat drum with a flat
// lid and a tall knob, a thin gooseneck spout rising from low on its front,
// a tall hoop handle behind, on a round base with a dial. `size` is the
// drum's width, and everything else follows it.
function Gooseneck({ size, fit }: { size: number; fit: Fit }) {
  const { M, c, m, lit } = fit
  const r = size / 2
  const base = r * 0.22
  const h = r * 1.35
  const top = base + h
  return (
    <group>
      <mesh position={[0, base / 2, 0]}>
        <cylinderGeometry args={[r * 1.12, r * 1.16, base, SEG * 2]} />
        {M('body')}
      </mesh>
      {/* The dial on the front of the base, with a ring that glows while
          it heats. */}
      <mesh position={[0, base / 2, r * 1.15]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[base * 0.35, base * 0.35, r * 0.1, 24]} />
        {M('fittings')}
      </mesh>
      <mesh position={[0, base + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 1.02, r * 1.1, SEG * 2]} />
        <meshStandardMaterial color={c('body')} emissive="#ff9a55" emissiveIntensity={1.2 * lit} />
      </mesh>
      <mesh position={[0, base + h / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.97, r, h, SEG * 2]} />
        {M('body')}
      </mesh>
      {/* The lid, a touch inset, and its tall knob. */}
      <mesh position={[0, top + r * 0.03, 0]}>
        <cylinderGeometry args={[r * 0.8, r * 0.84, r * 0.06, SEG * 2]} />
        {M('body')}
      </mesh>
      <mesh position={[0, top + r * 0.06 + r * 0.2, 0]}>
        <cylinderGeometry args={[r * 0.1, r * 0.13, r * 0.4, 24]} />
        {M('fittings')}
      </mesh>
      {/* The gooseneck, out from low on the drum, up and over. */}
      <Tube
        radius={r * 0.07}
        points={[
          [r * 0.85, base + h * 0.15, 0],
          [r * 1.25, base + h * 0.35, 0],
          [r * 1.45, base + h * 0.85, 0],
          [r * 1.62, base + h * 1.15, 0],
          [r * 1.9, base + h * 1.1, 0],
          [r * 2.05, base + h * 0.98, 0],
        ]}
      >
        <Material color={c('body')} material={m('body')} />
      </Tube>
      {/* The handle, a tall hoop off the back. */}
      <Tube
        radius={r * 0.1}
        points={[
          [-r * 0.9, base + h * 0.95, 0],
          [-r * 1.4, base + h * 1.1, 0],
          [-r * 1.62, base + h * 0.7, 0],
          [-r * 1.5, base + h * 0.2, 0],
          [-r * 0.95, base + h * 0.15, 0],
        ]}
      >
        {M('fittings')}
      </Tube>
      <Steam
        on={fit.on}
        position={[r * 2.05, base + h * 0.98, 0]}
        radius={r * 0.25}
        rise={r * 2.5}
        count={10}
        strength={0.16}
        speed={0.5}
      />
    </group>
  )
}
