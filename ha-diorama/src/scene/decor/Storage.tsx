import { Bar, Knob, Legs, Panel, Slab } from '#/scene/decor/parts.tsx'
import { Dowel } from '#/scene/decor/woodwork.tsx'
import { Fragment, useMemo, type ReactNode } from 'react'
import { LatheGeometry, Vector2 } from 'three'

// The other styles of the tables and the storage: each a real piece, laid
// out again at the size the sliders give it. The first style of each kind
// stays in FurnitureModel.

type Fill = (slot: string) => ReactNode
type Size = { w: number; d: number; h: number; M: Fill }

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

// A turned solid from a profile of [radius, height] pairs, bottom to top
// round the outside and back in over the top, so its faces point out.
function Turned({
  profile,
  scale,
  position,
  children,
}: {
  profile: [number, number][]
  scale?: [number, number, number]
  position?: [number, number, number]
  children: ReactNode
}) {
  const key = profile.flat().join(',')
  const geometry = useMemo(() => {
    const at = key.split(',').map(Number)
    const points = range(at.length / 2).map(i => new Vector2(at[i * 2], at[i * 2 + 1]))
    return new LatheGeometry(points, 32)
  }, [key])
  return (
    <mesh geometry={geometry} scale={scale} position={position} castShadow receiveShadow>
      {children}
    </mesh>
  )
}

// A dark film over a gap or a groove, so it reads as a shadow whatever
// color the piece is painted. Centered on its position, facing +z.
function Shadow({ size, position }: { size: [number, number]; position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <planeGeometry args={size} />
      <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
    </mesh>
  )
}

// Coffee tables

// A thin steel plate on four slim square legs set right at its corners,
// the legs tied near the floor by a square of bars.
export function FrameCoffeeTable({ w, d, h, M }: Size) {
  const plate = 0.012
  const leg = 0.016
  const bar = 0.012
  const barY = 0.03
  const x = w / 2 - leg / 2
  const z = d / 2 - leg / 2
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <Slab key={`${sx}${sz}`} size={[leg, h - plate, leg]} radius={0.002} position={[sx * x, 0, sz * z]}>
            {M('legs')}
          </Slab>
        )),
      )}
      {[-1, 1].map(sz => (
        <Slab key={`x${sz}`} size={[w - leg * 2, bar, bar]} radius={0.002} position={[0, barY, sz * z]}>
          {M('legs')}
        </Slab>
      ))}
      {[-1, 1].map(sx => (
        <Slab key={`z${sx}`} size={[bar, bar, d - leg * 2]} radius={0.002} position={[sx * x, barY, 0]}>
          {M('legs')}
        </Slab>
      ))}
      <Slab size={[w, plate, d]} radius={0.004} position={[0, h - plate, 0]}>
        {M('top')}
      </Slab>
    </group>
  )
}

// After the IKEA Lack: a thick top on four square legs, and a shelf between
// them near the floor.
export function BlockCoffeeTable({ w, d, h, M }: Size) {
  const top = Math.min(0.05, h * 0.12)
  const leg = Math.min(0.05, w * 0.08, d * 0.1)
  const shelf = Math.min(0.03, h * 0.07)
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <Slab
            key={`${sx}${sz}`}
            size={[leg, h - top, leg]}
            radius={0.004}
            bevel={0.002}
            position={[sx * (w / 2 - leg / 2), 0, sz * (d / 2 - leg / 2)]}
          >
            {M('legs')}
          </Slab>
        )),
      )}
      <Slab size={[w - leg * 2, shelf, d - leg * 2]} radius={0.003} bevel={0.002} position={[0, h * 0.22, 0]}>
        {M('shelf')}
      </Slab>
      <Slab size={[w, top, d]} radius={0.006} bevel={0.003} position={[0, h - top, 0]}>
        {M('top')}
      </Slab>
    </group>
  )
}

// After the Saarinen low table: an oval stone top on a single stem that
// flares into a wide foot, drawn as one turned piece.
export function TulipCoffeeTable({ w, d, h, M }: Size) {
  const top = Math.min(0.02, h * 0.06)
  const r = Math.min(w, d) / 2
  const foot = r * 0.62
  const neck = Math.min(0.045, r * 0.14)
  const y = h - top
  const profile: [number, number][] = [
    [0.001, 0],
    [foot, 0],
    [foot, 0.008],
    [foot * 0.8, 0.018],
    [foot * 0.45, y * 0.1],
    [neck * 1.3, y * 0.35],
    [neck, y * 0.55],
    [neck * 1.4, y * 0.8],
    [r * 0.45, y - 0.012],
    [r * 0.5, y - 0.004],
    [r * 0.5, y],
    [0.001, y],
  ]
  return (
    <group>
      {/* The base stretches with the top, so an oval top has an oval foot. */}
      <Turned profile={profile} scale={[w / (2 * r), 1, d / (2 * r)]}>
        {M('base')}
      </Turned>
      <mesh position={[0, y + top / 2, 0]} scale={[w, top, d]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.5, 1, 96]} />
        {M('top')}
      </mesh>
    </group>
  )
}

// Side tables

// A small top on four thin legs, with a lower shelf.
export function ShelfSideTable({ w, d, h, M }: Size) {
  const top = Math.min(0.03, h * 0.08)
  const inset = Math.min(0.05, w * 0.12, d * 0.12)
  const leg = Math.min(0.017, w * 0.04, d * 0.04)
  return (
    <group>
      <Legs width={w} depth={d} height={h - top} inset={inset} top={leg} bottom={leg * 0.7}>
        {M('legs')}
      </Legs>
      <Slab
        size={[w - inset * 1.2, Math.min(0.02, h * 0.05), d - inset * 1.2]}
        radius={0.02}
        position={[0, h * 0.3, 0]}
      >
        {M('shelf')}
      </Slab>
      <Slab size={[w, top, d]} radius={0.04} position={[0, h - top, 0]}>
        {M('top')}
      </Slab>
    </group>
  )
}

// A small cabinet on tapered legs, with a drawer for every 25 cm or so of
// its height and a slim pull on each.
export function Nightstand({ w, d, h, M }: Size) {
  const legH = Math.min(0.16, h * 0.3)
  const carcass = h - legH
  const frame = Math.min(0.015, carcass * 0.08)
  const drawers = Math.max(1, Math.min(5, Math.round(carcass / 0.25)))
  const dh = (carcass - frame * 2) / drawers
  const inset = Math.min(0.05, w * 0.12, d * 0.12)
  const leg = Math.min(0.02, w * 0.045, d * 0.045)
  const splay = Math.min(0.05, Math.max(0, ((inset - leg) * 2) / Math.max(legH, 0.01)))
  return (
    <group>
      <Legs width={w} depth={d} height={legH} inset={inset} top={leg} bottom={leg * 0.7} splay={splay}>
        {M('cabinet')}
      </Legs>
      <Slab size={[w, carcass, d]} radius={0.025} position={[0, legH, 0]}>
        {M('cabinet')}
      </Slab>
      {range(drawers).map(i => (
        <group key={i}>
          <Panel
            size={[w - frame * 2, dh - Math.min(0.012, dh * 0.15), 0.016]}
            position={[0, legH + frame + dh * i, d / 2 + 0.006]}
            radius={0.01}
          >
            {M('drawers')}
          </Panel>
          <Bar
            length={Math.min(w * 0.34, 0.16)}
            radius={0.007}
            rotation={[0, 0, Math.PI / 2]}
            position={[0, legH + frame + dh * (i + 0.72), d / 2 + 0.028]}
          >
            {M('handles')}
          </Bar>
        </group>
      ))}
    </group>
  )
}

// After the IKEA Gladom: a round tray with a raised rim, lifted on thin
// splayed legs. An oblong table has an oval tray.
export function TraySideTable({ w, d, h, M }: Size) {
  const r = w / 2
  const rim = Math.min(0.045, h * 0.1)
  const wall = 0.008
  const legs = 4
  const legR = Math.min(0.008, r * 0.04)
  const profile: [number, number][] = [
    [0.001, 0],
    [r - 0.012, 0],
    [r, 0.012],
    [r, rim],
    [r - wall, rim],
    [r - wall, wall],
    [0.001, wall],
  ]
  return (
    <group>
      <Turned profile={profile} scale={[1, 1, d / w]} position={[0, h - rim, 0]}>
        {M('tray')}
      </Turned>
      {range(legs).map(i => {
        const a = (i / legs) * Math.PI * 2 + Math.PI / 4
        const [cx, cz] = [Math.cos(a) * (w / 2), Math.sin(a) * (d / 2)]
        return (
          <Dowel key={i} from={[cx * 0.85, 0, cz * 0.85]} to={[cx * 0.6, h - rim, cz * 0.6]} r={[legR * 0.8, legR]}>
            {M('legs')}
          </Dowel>
        )
      })}
    </group>
  )
}

// Bookshelves

// After the IKEA Kallax: a grid of open cubes about 34 cm inside, in a
// thick outer frame with thinner boards between. No back and no plinth.
export function CubeShelf({ w, d, h, M }: Size) {
  const outer = Math.min(0.039, w * 0.06, h * 0.04)
  const inner = 0.016
  const cols = Math.max(1, Math.round((w - outer * 2 + inner) / (0.335 + inner)))
  const rows = Math.max(1, Math.round((h - outer * 2 + inner) / (0.335 + inner)))
  const cellW = (w - outer * 2 - inner * (cols - 1)) / cols
  const cellH = (h - outer * 2 - inner * (rows - 1)) / rows
  const inside = h - outer * 2
  return (
    <group>
      {[0, h - outer].map(y => (
        <Slab key={y} size={[w, outer, d]} radius={0.004} bevel={0.002} position={[0, y, 0]}>
          {M('cabinet')}
        </Slab>
      ))}
      {[-1, 1].map(s => (
        <Slab
          key={s}
          size={[outer, inside, d]}
          radius={0.002}
          bevel={0.001}
          position={[(s * (w - outer)) / 2, outer, 0]}
        >
          {M('cabinet')}
        </Slab>
      ))}
      {range(cols - 1).map(i => (
        <Slab
          key={`v${i}`}
          size={[inner, inside, d]}
          radius={0.002}
          bevel={0.001}
          position={[-w / 2 + outer + cellW * (i + 1) + inner * (i + 0.5), outer, 0]}
        >
          {M('cabinet')}
        </Slab>
      ))}
      {range(cols).flatMap(cIndex =>
        range(rows - 1).map(r => (
          <Slab
            key={`h${cIndex}-${r}`}
            size={[cellW, inner, d]}
            radius={0.002}
            bevel={0.001}
            position={[
              -w / 2 + outer + cellW * (cIndex + 0.5) + inner * cIndex,
              outer + cellH * (r + 1) + inner * r,
              0,
            ]}
          >
            {M('shelves')}
          </Slab>
        )),
      )}
    </group>
  )
}

// A wire ladder, its two uprights `depth` apart along z and rungs across
// them every few centimeters: the side panel of a String shelf.
function WireLadder({ height, depth, x, z = 0, M }: { height: number; depth: number; x: number; z?: number; M: Fill }) {
  const rod = 0.0035
  const rungs = Math.max(2, Math.round(height / 0.075))
  return (
    <group position={[x, 0, z]}>
      {[-1, 1].map(s => (
        <Bar key={s} length={height} radius={rod} position={[0, height / 2, (s * (depth - rod * 2)) / 2]}>
          {M('frame')}
        </Bar>
      ))}
      {range(rungs + 1).map(i => (
        <Bar
          key={i}
          length={depth - rod * 2}
          radius={rod * 0.7}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, rod + ((height - rod * 2) / rungs) * i, 0]}
        >
          {M('frame')}
        </Bar>
      ))}
    </group>
  )
}

// After the String system on floor panels: wire ladders about 80 cm apart
// with thin boards hung between them, from a hand above the floor to a
// hand below the top.
export function StringShelf({ w, d, h, M, boards }: Size & { boards: number }) {
  const bays = Math.max(1, Math.round(w / 0.8))
  const bayW = w / bays
  const board = 0.018
  const low = Math.min(0.12, h * 0.1)
  const high = h - Math.min(0.08, h * 0.06)
  const n = Math.max(2, boards)
  const panel = (slot: string) => M(slot === 'frame' ? 'cabinet' : slot)
  return (
    <group>
      {range(bays + 1).map(i => (
        <WireLadder key={i} height={h} depth={d} x={-w / 2 + 0.004 + (bayW - 0.008 / bays) * i} M={panel} />
      ))}
      {range(bays).flatMap(b =>
        range(n).map(i => (
          <Slab
            key={`${b}-${i}`}
            size={[bayW - 0.012, board, d - 0.01]}
            radius={0.004}
            bevel={0.002}
            position={[-w / 2 + bayW * (b + 0.5), low + ((high - low) / (n - 1)) * i, 0]}
          >
            {M('shelves')}
          </Slab>
        )),
      )}
    </group>
  )
}

// Desks

// After the IKEA Micke: a plain top on a board at one end and a pedestal of
// drawers at the other, a modesty panel across the back between them and
// a round cable hole near the back edge. Standing up, the top goes up on
// the board and the panel, and the pedestal stays on the floor under it.
export function PedestalDesk({ w, d, h, M, rise = 0 }: Size & { rise?: number }) {
  const top = 0.025
  const side = 0.02
  const pedW = Math.min(0.4, w * 0.3)
  const under = h - top
  const drawers = under > 0.6 ? 3 : 2
  const gap = 0.004
  const drawerH = (under - 0.03) / drawers
  const pedX = w / 2 - pedW / 2
  return (
    <group>
      <Slab size={[w, top, d]} radius={0.004} position={[0, under + rise, 0]}>
        {M('top')}
      </Slab>
      {/* The cable hole, a dark ring let into the top. */}
      <mesh position={[-w / 2 + 0.2, h + rise + 0.0005, -d / 2 + 0.08]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.002, 28]} />
        {M('handle')}
      </mesh>
      <Slab size={[side, under + rise, d - 0.02]} radius={0.003} position={[-w / 2 + side / 2 + 0.005, 0, 0]}>
        {M('legs')}
      </Slab>
      <Slab
        size={[w - pedW - side - 0.01, under * 0.45, side]}
        radius={0.003}
        position={[-pedW / 2, under * 0.5 + rise, -d / 2 + 0.04]}
      >
        {M('legs')}
      </Slab>
      <Slab size={[pedW - 0.01, under, d - 0.04]} radius={0.003} position={[pedX, 0, -0.01]}>
        {M('legs')}
      </Slab>
      {/* Raised, the top stands on a panel across the back of the pedestal. */}
      {rise > 0.005 && (
        <Slab size={[pedW - 0.01, rise, side]} radius={0.003} position={[pedX, under, -d / 2 + 0.03]}>
          {M('legs')}
        </Slab>
      )}
      {range(drawers).map(i => {
        const y = 0.03 + drawerH * i + gap / 2
        return (
          <Fragment key={i}>
            <Slab size={[pedW - 0.016, drawerH - gap, 0.016]} radius={0.003} position={[pedX, y, d / 2 - 0.03]}>
              {M('drawer')}
            </Slab>
            <Bar
              length={pedW * 0.4}
              radius={0.006}
              rotation={[0, 0, Math.PI / 2]}
              position={[pedX, y + drawerH - gap - 0.04, d / 2 - 0.012]}
            >
              {M('handle')}
            </Bar>
          </Fragment>
        )
      })}
    </group>
  )
}

// Sideboards

// After the Florence Knoll credenza: a long wooden case with four sliding
// doors, each with a round finger pull, standing on a thin frame of square
// steel legs tied by rails under the case.
export function Credenza({ w, d, h, M, hung = false }: Size & { hung?: boolean }) {
  const legH = hung ? 0 : Math.min(0.2, h * 0.28)
  const leg = 0.018
  const top = 0.02
  const H = h - legH
  const doors = Math.max(2, Math.round(w / 0.45))
  const doorW = (w - 0.03) / doors
  const doorH = H - top - 0.03
  return (
    <group>
      {hung ? null : (
        <>
          {[-1, 1].flatMap(sx =>
            [-1, 1].map(sz => (
              <Slab
                key={`${sx}${sz}`}
                size={[leg, legH, leg]}
                radius={0.002}
                position={[sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03)]}
              >
                {M('frame')}
              </Slab>
            )),
          )}
          {/* The rails the case sits on, along the length and across the ends. */}
          {[-1, 1].map(sz => (
            <Slab
              key={`x${sz}`}
              size={[w - 0.06, leg, leg]}
              radius={0.002}
              position={[0, legH - leg, sz * (d / 2 - 0.03)]}
            >
              {M('frame')}
            </Slab>
          ))}
          {[-1, 1].map(sx => (
            <Slab
              key={`z${sx}`}
              size={[leg, leg, d - 0.06]}
              radius={0.002}
              position={[sx * (w / 2 - 0.03), legH - leg, 0]}
            >
              {M('frame')}
            </Slab>
          ))}
        </>
      )}
      <Slab size={[w, H, d - 0.01]} radius={0.006} bevel={0.003} position={[0, legH, -0.005]}>
        {M('cabinet')}
      </Slab>
      {range(doors).map(i => {
        const x = -w / 2 + 0.015 + doorW * (i + 0.5)
        // The doors run on two tracks, so every other one sits a little further out.
        const z = d / 2 - 0.004 + (i % 2) * 0.006
        return (
          <Fragment key={i}>
            <Slab size={[doorW - 0.004, doorH, 0.012]} radius={0.003} position={[x, legH + 0.015, z]}>
              {M('fronts')}
            </Slab>
            <mesh
              position={[x + (i % 2 ? -1 : 1) * (doorW / 2 - 0.05), legH + 0.015 + doorH / 2, z + 0.0065]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.016, 0.016, 0.002, 24]} />
              {M('frame')}
            </mesh>
          </Fragment>
        )
      })}
    </group>
  )
}

// After the IKEA Besta: a plain carcass of 60 cm units on slim metal legs,
// with push to open fronts and no handles. The middle of three units is a
// pair of drawers.
export function PushSideboard({ w, d, h, M, hung = false }: Size & { hung?: boolean }) {
  const legH = hung ? 0 : Math.min(0.1, h * 0.15)
  const H = h - legH
  const units = Math.max(1, Math.round(w / 0.6))
  const unitW = w / units
  const gap = 0.003
  return (
    <group>
      {hung ? null : (
        <Legs
          width={w}
          depth={d}
          height={legH}
          inset={Math.min(0.05, d * 0.12)}
          top={0.016}
          bottom={0.012}
          columns={units > 2 ? units : 2}
        >
          {M('legs')}
        </Legs>
      )}
      <Slab size={[w, H, d - 0.02]} radius={0.004} bevel={0.002} position={[0, legH, -0.01]}>
        {M('cabinet')}
      </Slab>
      {range(units).map(i => {
        const x = -w / 2 + unitW * (i + 0.5)
        const drawers = units % 2 === 1 && units > 1 && i === (units - 1) / 2 ? 2 : 1
        return range(drawers).map(j => (
          <Panel
            key={`${i}-${j}`}
            size={[unitW - gap * 2, H / drawers - gap * 2, 0.018]}
            position={[x, legH + gap + (H / drawers) * j, d / 2 - 0.02]}
            radius={0.003}
          >
            {M('fronts')}
          </Panel>
        ))
      })}
    </group>
  )
}

// Dressers

// After the IKEA Malm: a plain box between two sides, its drawers without
// handles. The top edge of every front is cut back, which reads as a dark
// line to pull on.
export function PlainDresser({ w, d, h, M }: Size) {
  const side = 0.018
  const top = 0.02
  const toe = Math.min(0.03, h * 0.04)
  const rows = Math.max(2, Math.round((h - top - toe) / 0.24))
  const rowH = (h - top - toe) / rows
  const grip = Math.min(0.018, rowH * 0.12)
  return (
    <group>
      <Slab size={[w, h - top, d - 0.02]} radius={0.003} bevel={0.002} position={[0, 0, -0.01]}>
        {M('cabinet')}
      </Slab>
      <Slab size={[w, top, d]} radius={0.003} bevel={0.002} position={[0, h - top, 0]}>
        {M('cabinet')}
      </Slab>
      {range(rows).map(i => (
        <Fragment key={i}>
          <Panel size={[w - side * 2, rowH - grip, 0.018]} position={[0, toe + rowH * i, d / 2 - 0.019]} radius={0.003}>
            {M('fronts')}
          </Panel>
          {/* The grip above the front. */}
          <Shadow size={[w - side * 2, grip]} position={[0, toe + rowH * (i + 1) - grip / 2, d / 2 - 0.019]} />
        </Fragment>
      ))}
    </group>
  )
}

// After the IKEA Hemnes chest: a top that overhangs a face frame, a skirt
// between four feet, two small drawers across the top and wide ones
// below, each with round wooden knobs.
export function PaintedDresser({ w, d, h, M }: Size) {
  const top = Math.min(0.03, h * 0.04)
  const feet = Math.min(0.1, h * 0.12)
  const body = h - top - feet
  const frame = 0.022
  const wide = Math.max(1, Math.round((body - 0.2) / 0.26))
  const smallH = Math.min(0.2, body * 0.25)
  const wideH = (body - frame - smallH) / wide
  const front = (x: number, y: number, fw: number, fh: number, knobs: number, key: string) => (
    <group key={key}>
      <Panel size={[fw, fh - frame, 0.018]} position={[x, y, d / 2]} radius={0.004}>
        {M('fronts')}
      </Panel>
      {range(knobs).map(k => (
        <Knob
          key={k}
          radius={0.017}
          position={[knobs === 1 ? x : x + (k === 0 ? -fw / 4 : fw / 4), y + (fh - frame) / 2, d / 2 + 0.019]}
        >
          {M('handles')}
        </Knob>
      ))}
    </group>
  )
  const innerW = w - frame * 2
  return (
    <group>
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <Slab
            key={`${sx}${sz}`}
            size={[0.05, feet + 0.01, 0.05]}
            radius={0.004}
            bevel={0.002}
            position={[sx * (w / 2 - 0.025), 0, sz * (d / 2 - 0.035)]}
          >
            {M('cabinet')}
          </Slab>
        )),
      )}
      {/* The skirt, its lower edge rising between the feet. */}
      <Slab size={[w - 0.1, feet * 0.45, 0.02]} radius={0.003} bevel={0.002} position={[0, feet * 0.55, d / 2 - 0.02]}>
        {M('cabinet')}
      </Slab>
      <Slab size={[w, body, d - 0.02]} radius={0.003} bevel={0.002} position={[0, feet, -0.01]}>
        {M('cabinet')}
      </Slab>
      <Slab size={[w + 0.04, top, d + 0.03]} radius={0.008} bevel={0.004} position={[0, h - top, 0.005]}>
        {M('cabinet')}
      </Slab>
      {range(wide).map(i => front(0, feet + frame + wideH * i, innerW, wideH, 2, `w${i}`))}
      {[-1, 1].map(s =>
        front((s * (innerW + frame)) / 4, feet + frame + wideH * wide, (innerW - frame) / 2, smallH, 1, `s${s}`),
      )}
    </group>
  )
}

// Wardrobes

// After the IKEA Pax with Hasvik doors: a tall carcass on a plinth, with
// two doors sliding on tracks one in front of the other, each edged with an
// aluminium profile to pull on.
export function SlidingWardrobe({ w, d, h, M }: Size) {
  const rail = 0.05
  const plinth = 0.04
  const doorW = w / 2 + 0.02
  const doorH = h - rail - plinth - 0.01
  const tracks = [d / 2 - 0.03, d / 2 - 0.005]
  return (
    <group>
      <Slab size={[w - 0.04, plinth, d - 0.08]} radius={0.004} bevel={0.002} position={[0, 0, -0.04]}>
        {M('cabinet')}
      </Slab>
      <Slab size={[w, h - plinth, d - 0.07]} radius={0.004} bevel={0.002} position={[0, plinth, -0.035]}>
        {M('cabinet')}
      </Slab>
      {/* The top track and the bottom rail the doors run in. */}
      <Slab size={[w, rail, 0.07]} radius={0.004} bevel={0.002} position={[0, h - rail, d / 2 - 0.035]}>
        {M('handles')}
      </Slab>
      <Slab size={[w, plinth, 0.07]} radius={0.004} bevel={0.002} position={[0, 0, d / 2 - 0.035]}>
        {M('handles')}
      </Slab>
      {[-1, 1].map((s, i) => {
        const x = s * (w / 2 - doorW / 2)
        return (
          <group key={s} position={[x, plinth + 0.005, tracks[i] - 0.009]}>
            <Panel size={[doorW - 0.04, doorH, 0.016]} position={[0, 0, 0]} radius={0.002}>
              {M('fronts')}
            </Panel>
            {[-1, 1].map(e => (
              <Slab
                key={e}
                size={[0.02, doorH, 0.024]}
                radius={0.003}
                bevel={0.002}
                position={[(e * (doorW - 0.02)) / 2, 0, 0]}
              >
                {M('handles')}
              </Slab>
            ))}
            {[0, doorH - 0.02].map(y => (
              <Slab key={y} size={[doorW - 0.04, 0.02, 0.02]} radius={0.003} bevel={0.002} position={[0, y, 0]}>
                {M('handles')}
              </Slab>
            ))}
          </group>
        )
      })}
    </group>
  )
}

// A wooden hanger edge on from the rail, `across` wide along z: the wire
// hook over the rail, two shoulders sloping down from the middle, and the
// bar across between their tips.
function Hanger({ across, M }: { across: number; M: Size['M'] }) {
  const half = across / 2
  const drop = 0.05
  const wood = <meshStandardMaterial color="#b58a5c" roughness={0.6} />
  const slope = Math.atan2(drop, half)
  const arm = Math.hypot(half, drop)
  return (
    <group>
      <Bar length={0.05} radius={0.0022} position={[0, 0.0, 0]}>
        {M('frame')}
      </Bar>
      <mesh position={[0, 0.025, 0.012]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.013, 0.0022, 6, 16, Math.PI * 1.3]} />
        {M('frame')}
      </mesh>
      {[-1, 1].map(sz => (
        <Bar
          key={sz}
          length={arm}
          radius={0.007}
          rotation={[Math.PI / 2 + sz * slope, 0, 0]}
          position={[0, -0.03 - drop / 2, (sz * half) / 2]}
        >
          {wood}
        </Bar>
      ))}
      <Bar length={across * 0.94} radius={0.004} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.03 - drop, 0]}>
        {wood}
      </Bar>
    </group>
  )
}

// A zipped suit cover `long` long, hung from a hanger's bar, narrower over
// the shoulders and with its zip down the middle of each face.
function SuitCover({ long, across, color }: { long: number; across: number; color: string }) {
  const cloth = <meshStandardMaterial color={color} roughness={0.85} />
  return (
    <group position={[0, -0.08, 0]}>
      <Slab size={[0.06, 0.12, across * 0.8]} radius={0.025} bevel={0.012} position={[0, -0.12, 0]}>
        {cloth}
      </Slab>
      <Slab size={[0.07, long - 0.1, across]} radius={0.03} bevel={0.015} position={[0, -long, 0]}>
        {cloth}
      </Slab>
      <Slab size={[0.074, long - 0.16, 0.008]} radius={0.003} position={[0, -long + 0.04, 0]}>
        <meshStandardMaterial color="#1a1a1b" roughness={0.5} />
      </Slab>
    </group>
  )
}

// A long dress hung by its straps: a fitted bodice, a narrow waist and a
// skirt flaring to the hem, flattened the way cloth hangs.
function Dress({ long, color }: { long: number; color: string }) {
  const top = -0.085
  const at = (f: number) => top - long * f
  return (
    <Turned
      profile={[
        [0, at(1)],
        [0.25, at(1)],
        [0.19, at(0.72)],
        [0.14, at(0.42)],
        [0.1, at(0.3)],
        [0.125, at(0.17)],
        [0.14, at(0.05)],
        [0.09, top],
        [0, top],
      ]}
      scale={[0.28, 1, 1]}
    >
      <meshStandardMaterial color={color} roughness={0.7} />
    </Turned>
  )
}

// What hangs on each hanger along the rail, in turn: a suit cover, a long
// dress or nothing, with room left beside the fuller ones.
const WARDROBE = ['suit', '', 'dress', '', 'suit', '', '', 'dress', '', 'dress', '', 'suit', '']
const COVERS = ['#2b3140', '#3a3a3c', '#4a3f35']
const DRESSES = ['#6e1f2e', '#1f5a48', '#d9a6a0', '#1d1d24']

// After the IKEA Mulig: an open clothes rack of thin white tube, a rail
// across the top hung with suit covers, long dresses and a few empty
// hangers, and a shelf near the floor for shoes and boxes.
export function OpenRail({ w, d, h, M }: Size) {
  const tube = 0.011
  const post = d / 2 - 0.03
  const shelfY = Math.min(0.22, h * 0.15)
  const count = Math.max(1, Math.floor((w - 0.16) / 0.07))
  const across = Math.min(0.42, d * 0.85)
  const hang = h - 0.035
  // The clothes stop short of the shelf.
  const long = Math.min(1.05, hang - 0.18 - shelfY - 0.1)
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx} position={[(sx * (w - tube * 2)) / 2, 0, 0]}>
          {[-1, 1].map(sz => (
            <Bar key={sz} length={h} radius={tube} position={[0, h / 2, sz * post]}>
              {M('frame')}
            </Bar>
          ))}
          {/* A foot along the depth, and the head over the two posts. */}
          {[tube, h - tube].map(y => (
            <Bar key={y} length={post * 2 + tube * 2} radius={tube} rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]}>
              {M('frame')}
            </Bar>
          ))}
        </group>
      ))}
      <Bar length={w} radius={tube} rotation={[0, 0, Math.PI / 2]} position={[0, h - tube, 0]}>
        {M('frame')}
      </Bar>
      <Slab size={[w - tube * 4, 0.014, post * 2]} radius={0.004} bevel={0.002} position={[0, shelfY, 0]}>
        {M('frame')}
      </Slab>
      {range(count).map(i => {
        const x = -w / 2 + 0.08 + ((w - 0.16) / Math.max(1, count - 1)) * i
        // Hung a little askew, each turned its own way on the rail.
        const turn = Math.sin(i * 2.7) * 0.12
        return (
          <group key={i} position={[count === 1 ? 0 : x, hang, 0]} rotation={[0, turn, 0]}>
            <Hanger across={across} M={M} />
            {long > 0.3 && WARDROBE[i % WARDROBE.length] === 'suit' && (
              <SuitCover long={long} across={0.58} color={COVERS[i % COVERS.length]} />
            )}
            {long > 0.3 && WARDROBE[i % WARDROBE.length] === 'dress' && (
              <Dress long={long} color={DRESSES[i % DRESSES.length]} />
            )}
          </group>
        )
      })}
    </group>
  )
}

// Shoe racks

// After the IKEA Hemnes shoe cabinet: a shallow case on low feet with an
// overhanging top and a tilting compartment for every 55 cm or so of
// height, each front framed and pulled by a wooden knob at the top.
export function TiltShoeCabinet({ w, d, h, M }: Size) {
  const top = Math.min(0.025, h * 0.04)
  const feet = Math.min(0.08, h * 0.12)
  const body = h - top - feet
  const n = Math.max(1, Math.round(body / 0.55))
  const cellH = body / n
  const frame = 0.02
  return (
    <group>
      {[-1, 1].map(sx => (
        <Slab
          key={sx}
          size={[0.03, feet + 0.01, d - 0.03]}
          radius={0.004}
          bevel={0.002}
          position={[sx * (w / 2 - 0.035), 0, -0.01]}
        >
          {M('frame')}
        </Slab>
      ))}
      <Slab size={[w - 0.1, feet * 0.5, 0.018]} radius={0.003} bevel={0.002} position={[0, feet * 0.5, d / 2 - 0.03]}>
        {M('frame')}
      </Slab>
      <Slab size={[w, body, d - 0.03]} radius={0.004} bevel={0.002} position={[0, feet, -0.015]}>
        {M('frame')}
      </Slab>
      <Slab size={[w + 0.03, top, d + 0.01]} radius={0.006} bevel={0.003} position={[0, h - top, 0.005]}>
        {M('frame')}
      </Slab>
      {range(n).map(i => {
        const y = feet + cellH * i + frame / 2
        const fh = cellH - frame
        return (
          <group key={i}>
            <Panel size={[w - frame * 2, fh, 0.018]} position={[0, y, d / 2 - 0.03]} radius={0.004}>
              {M('fronts')}
            </Panel>
            {/* The seam under the front, and a groove round the panel
                inside its frame. */}
            <Shadow size={[w - frame * 2, frame]} position={[0, y - frame / 2, d / 2 - 0.029]} />
            {[
              [w - frame * 2 - 0.12, 0.006, 0, 0.06],
              [w - frame * 2 - 0.12, 0.006, 0, fh - 0.06],
              [0.006, fh - 0.12, -(w - frame * 2 - 0.12) / 2, fh / 2],
              [0.006, fh - 0.12, (w - frame * 2 - 0.12) / 2, fh / 2],
            ].map(([gw, gh, gx, gy], k) => (
              <Shadow key={k} size={[gw, gh]} position={[gx, y + gy, d / 2 - 0.0205]} />
            ))}
            <Knob radius={0.016} position={[0, y + fh - 0.035, d / 2 - 0.011]}>
              {M('handles')}
            </Knob>
          </group>
        )
      })}
    </group>
  )
}

// After the IKEA Tjusig bench: a slatted seat on two solid ends, with a
// slatted shelf underneath for the shoes.
export function ShoeBench({ w, d, h, M }: Size) {
  const end = 0.03
  const seat = Math.min(0.025, h * 0.06)
  const slats = Math.max(2, Math.round(d / 0.1))
  const slatD = (d - 0.02) / slats
  const shelfY = Math.min(0.1, h * 0.2)
  const inner = w - end * 2
  return (
    <group>
      {[-1, 1].map(s => (
        <Slab key={s} size={[end, h - seat, d]} radius={0.005} bevel={0.003} position={[(s * (w - end)) / 2, 0, 0]}>
          {M('frame')}
        </Slab>
      ))}
      {/* A rail under the back of the seat ties the ends together. */}
      <Slab size={[inner, 0.06, 0.02]} radius={0.003} bevel={0.002} position={[0, h - seat - 0.06, -d / 2 + 0.02]}>
        {M('frame')}
      </Slab>
      {range(slats).map(i => (
        <Fragment key={i}>
          <Slab
            size={[w, seat, slatD - 0.012]}
            radius={0.006}
            bevel={0.003}
            position={[0, h - seat, -d / 2 + 0.01 + slatD * (i + 0.5)]}
          >
            {M('seat')}
          </Slab>
          <Slab
            size={[inner, 0.018, slatD - 0.02]}
            radius={0.004}
            bevel={0.002}
            position={[0, shelfY, -d / 2 + 0.01 + slatD * (i + 0.5)]}
          >
            {M('rails')}
          </Slab>
        </Fragment>
      ))}
    </group>
  )
}

// Wall shelves. They are drawn from the wall at z 0 out along +z, their
// origin at the height they hang.

// After the IKEA Lack wall shelf: a thick board with its fixings hidden
// inside it.
export function FloatingShelf({ w, d, M }: { w: number; d: number; M: Fill }) {
  return (
    <Slab size={[w, 0.05, d]} radius={0.004} bevel={0.002} position={[0, 0, d / 2]}>
      {M('shelf')}
    </Slab>
  )
}

// After the String Pocket: two wire ladders 50 cm tall screwed to the wall
// with three thin shelves hung between them, rising from the height it
// hangs at.
export function WirePocket({ w, d, M }: { w: number; d: number; M: Fill }) {
  const tall = 0.5
  const panel = (slot: string) => M(slot === 'frame' ? 'panels' : slot)
  return (
    <group>
      {[-1, 1].map(s => (
        <WireLadder key={s} height={tall} depth={d} x={s * (w / 2 - 0.004)} z={d / 2} M={panel} />
      ))}
      {[0.02, 0.24, 0.46].map(y => (
        <Slab key={y} size={[w - 0.012, 0.014, d - 0.008]} radius={0.004} bevel={0.002} position={[0, y, d / 2]}>
          {M('shelf')}
        </Slab>
      ))}
    </group>
  )
}
