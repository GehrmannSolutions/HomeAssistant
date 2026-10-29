import { ensureCounterClockwise } from '#/geometry/polygon.ts'
import {
  CEILING_HEIGHT_M,
  OUTER_WALL_THICKNESS_M,
  ROOM_SLAB_EDGE_RADIUS_M,
  ROOM_SLAB_THICKNESS_M,
  WALL_THICKNESS_M,
} from '#/theme.ts'
import type { Point, RoomConfig, WallsConfig } from '#/types.ts'

// The walls along the rooms' outlines, worked out on the plan as upright
// blocks: a footprint of four corners, and the heights they stand between.
//
// A stretch two rooms share is one wall between them, standing astride the
// line they share, unless one of them is open to the other. The rest of an
// outline is an outer wall, standing just outside the floor so the room
// keeps all of it. Where two outer walls meet at a corner their ends are cut
// at the angle between them, so they close the corner without overlapping.
// A door or a window in a wall leaves its opening: a door from the floor up,
// a window between its sill and its top.

// Edges this near each other count as one line, in meters, so two rooms
// drawn a little apart still share their wall.
const SAME_LINE_M = 0.15
// The shortest stretch two rooms have to share to have a wall between them.
const MIN_SHARED_M = 0.05
// How near a wall's line a door or a window has to be to open it.
const OPENING_REACH_M = 0.4
// Lengths and heights shorter than this are nothing.
const EPSILON_M = 0.001
// Walls start as deep as the floor's slab goes, so an outer wall stands
// on the ground beside it rather than floating at the floor's top.
export const WALL_FOOT_M = -(ROOM_SLAB_THICKNESS_M + ROOM_SLAB_EDGE_RADIUS_M)

// A door or a window in a wall: where it is on the plan, how wide, and the
// heights its opening runs between.
export type Opening = { at: Point; width: number; bottom: number; top: number }

// One of the rooms a wall stands beside: a point on the wall's line, and
// the way out of that room across it, as a unit vector on the plan.
export type WallSide = { room: string; at: Point; out: Point }

export type WallBlock = {
  // The footprint on the plan, counter clockwise.
  corners: [Point, Point, Point, Point]
  bottom: number
  top: number
  // The rooms the wall stands beside, one for an outer wall, two between.
  rooms: string[]
  sides: WallSide[]
  // Above the cut of a full wall: it is left out while the camera looks at
  // the wall from outside the room it bounds.
  upper: boolean
}

// How high the walls of a room stand, and where a full wall is cut while
// the camera looks over it. No cut for half walls or a height in meters.
export function wallHeights(walls: WallsConfig, rooms: RoomConfig[]): { top: number; cut: number | null } {
  const ceiling = (room: RoomConfig) => room.ceiling ?? walls.ceiling ?? CEILING_HEIGHT_M
  const half = walls.half ?? (walls.ceiling ?? CEILING_HEIGHT_M) / 2
  const height = walls.height ?? 'full'
  if (height === 'half') return { top: half, cut: null }
  if (typeof height === 'number') return { top: height, cut: null }
  const top = Math.max(...rooms.map(ceiling))
  return { top, cut: walls.cutaway === false || half >= top ? null : half }
}

// Whether two rooms beside each other have no wall between them.
export function openBetween(a: RoomConfig, b: RoomConfig): boolean {
  return (a.open_to?.includes(b.id) ?? false) || (b.open_to?.includes(a.id) ?? false)
}

type Stretch = { from: number; to: number; other: RoomConfig | null }

type Edge = {
  start: Point
  dir: Point
  out: Point
  length: number
  stretches: Stretch[]
}

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const along = (edge: Edge, t: number, off: number): Point => [
  edge.start[0] + edge.dir[0] * t + edge.out[0] * off,
  edge.start[1] + edge.dir[1] * t + edge.out[1] * off,
]

// The edges of a room's outline, counter clockwise, each cut into the
// stretches it shares with another room and the ones it has on its own.
function edgesOf(room: RoomConfig, rooms: RoomConfig[]): Edge[] {
  const outline = ensureCounterClockwise(room.points)
  const edges: Edge[] = []
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % outline.length]
    const length = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (length < EPSILON_M) continue
    const dir: Point = [(q[0] - p[0]) / length, (q[1] - p[1]) / length]
    // Outward from a counter clockwise outline is to the right of its edges.
    const out: Point = [dir[1], -dir[0]]
    const shared: Stretch[] = []
    for (const other of rooms) {
      if (other.id === room.id) continue
      const points = other.points
      for (let j = 0; j < points.length; j++) {
        const r = points[j]
        const s = points[(j + 1) % points.length]
        const off = (v: Point) => Math.abs((v[0] - p[0]) * dir[1] - (v[1] - p[1]) * dir[0])
        if (off(r) > SAME_LINE_M || off(s) > SAME_LINE_M) continue
        const tr = dot([r[0] - p[0], r[1] - p[1]], dir)
        const ts = dot([s[0] - p[0], s[1] - p[1]], dir)
        const from = Math.max(0, Math.min(tr, ts))
        const to = Math.min(length, Math.max(tr, ts))
        if (to - from >= MIN_SHARED_M) shared.push({ from, to, other })
      }
    }
    shared.sort((a, b) => a.from - b.from)
    const stretches: Stretch[] = []
    let cursor = 0
    for (const s of shared) {
      const from = Math.max(s.from, cursor)
      if (s.to - from < MIN_SHARED_M) continue
      if (from - cursor > EPSILON_M) stretches.push({ from: cursor, to: from, other: null })
      stretches.push({ from, to: s.to, other: s.other })
      cursor = s.to
    }
    if (length - cursor > EPSILON_M) stretches.push({ from: cursor, to: length, other: null })
    edges.push({ start: p, dir, out, length, stretches })
  }
  return edges
}

// How far the outer face of an outer wall reaches past the end of its edge
// to meet the next wall's outer face at the corner: a wall thickness out on
// a corner that turns away from the room, a thickness back on one that turns
// into it, nothing on a straight run.
function miter(a: Edge, b: Edge, thickness: number): { end: number; start: number } {
  const cos = dot(a.out, b.out)
  // A corner sharper than this is left square.
  if (1 + cos < 0.1) return { end: 0, start: 0 }
  const corner: Point = [(a.out[0] + b.out[0]) / (1 + cos), (a.out[1] + b.out[1]) / (1 + cos)]
  return {
    end: dot([corner[0] - a.out[0], corner[1] - a.out[1]], a.dir) * thickness,
    start: dot([corner[0] - b.out[0], corner[1] - b.out[1]], b.dir) * thickness,
  }
}

// A straight run of wall along one edge: its stretch of the edge, how far
// its two faces stand from the edge's line, and how far the outer face
// reaches past each end of the stretch.
type Run = {
  edge: Edge
  from: number
  to: number
  inner: number
  outer: number
  startShift: number
  endShift: number
  rooms: RoomConfig[]
  sides: WallSide[]
}

// What is left of [from, to] once the given spans are taken out of it.
function subtract(from: number, to: number, spans: [number, number][]): [number, number][] {
  let left: [number, number][] = [[from, to]]
  for (const [a, b] of spans) {
    left = left.flatMap(([x, y]): [number, number][] => {
      if (b <= x || a >= y) return [[x, y]]
      const parts: [number, number][] = []
      if (a - x > EPSILON_M) parts.push([x, a])
      if (y - b > EPSILON_M) parts.push([b, y])
      return parts
    })
  }
  return left
}

function blocksOf(run: Run, openings: Opening[], walls: WallsConfig): WallBlock[] {
  const { edge, from, to } = run
  const { top, cut } = wallHeights(walls, run.rooms)
  // The openings in this run, as stretches along it with their heights.
  const holes = openings.flatMap(opening => {
    const v: Point = [opening.at[0] - edge.start[0], opening.at[1] - edge.start[1]]
    if (Math.abs(dot(v, edge.out)) > OPENING_REACH_M) return []
    const t = dot(v, edge.dir)
    const a = Math.max(from, t - opening.width / 2)
    const b = Math.min(to, t + opening.width / 2)
    return b - a > EPSILON_M ? [{ a, b, bottom: opening.bottom, top: opening.top }] : []
  })
  const cuts = [...new Set([from, to, ...holes.flatMap(h => [h.a, h.b])])].sort((x, y) => x - y)
  const blocks: WallBlock[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i]
    const t1 = cuts[i + 1]
    if (t1 - t0 < EPSILON_M) continue
    const over = holes.filter(h => h.a <= t0 + EPSILON_M && h.b >= t1 - EPSILON_M)
    const solid = subtract(
      WALL_FOOT_M,
      top,
      over.map(h => [h.bottom, h.top]),
    )
    // The outer face reaches past the run's own ends, to meet the next wall.
    const o0 = t0 === from ? t0 + run.startShift : t0
    const o1 = t1 === to ? t1 + run.endShift : t1
    const corners: [Point, Point, Point, Point] = [
      along(edge, t0, run.inner),
      along(edge, o0, run.outer),
      along(edge, o1, run.outer),
      along(edge, t1, run.inner),
    ]
    const rooms = run.rooms.map(room => room.id)
    for (const [y0, y1] of solid) {
      const spans: [number, number, boolean][] =
        cut !== null && y0 < cut - EPSILON_M && y1 > cut + EPSILON_M
          ? [
              [y0, cut, false],
              [cut, y1, true],
            ]
          : [[y0, y1, cut !== null && y0 >= cut - EPSILON_M]]
      for (const [bottom, height, upper] of spans) {
        blocks.push({ corners, bottom, top: height, rooms, sides: run.sides, upper })
      }
    }
  }
  return blocks
}

// Every wall of the home, given the doors and windows in them.
export function wallsOf(rooms: RoomConfig[], walls: WallsConfig, openings: Opening[]): WallBlock[] {
  const thickness = walls.thickness ?? WALL_THICKNESS_M
  const outer = walls.outer ?? OUTER_WALL_THICKNESS_M
  const runs: Run[] = []
  rooms.forEach((room, index) => {
    const edges = edgesOf(room, rooms)
    edges.forEach((edge, i) => {
      const next = edges[(i + 1) % edges.length]
      const previous = edges[(i - 1 + edges.length) % edges.length]
      for (const stretch of edge.stretches) {
        const middle = along(edge, (stretch.from + stretch.to) / 2, 0)
        const other = stretch.other
        if (other) {
          // A wall between two rooms is drawn once, by the first of them, and
          // not at all where they are open to each other. It runs on by half
          // its thickness at both ends, to close the corners it turns.
          if (openBetween(room, other) || rooms.indexOf(other) < index) continue
          runs.push({
            edge,
            from: stretch.from - thickness / 2,
            to: stretch.to + thickness / 2,
            inner: -thickness / 2,
            outer: thickness / 2,
            startShift: 0,
            endShift: 0,
            rooms: [room, other],
            sides: [
              { room: room.id, at: middle, out: edge.out },
              { room: other.id, at: middle, out: [-edge.out[0], -edge.out[1]] },
            ],
          })
          continue
        }
        // An outer wall meets the next one round a corner when both run up
        // to it on their own.
        const last = previous.stretches[previous.stretches.length - 1]
        const first = next.stretches[0]
        const startShift =
          stretch.from < EPSILON_M && last && last.other === null && previous.length - last.to < EPSILON_M
            ? miter(previous, edge, outer).start
            : 0
        const endShift =
          edge.length - stretch.to < EPSILON_M && first && first.other === null && first.from < EPSILON_M
            ? miter(edge, next, outer).end
            : 0
        runs.push({
          edge,
          from: stretch.from,
          to: stretch.to,
          inner: 0,
          outer,
          startShift,
          endShift,
          rooms: [room],
          sides: [{ room: room.id, at: middle, out: edge.out }],
        })
      }
    })
  })
  return runs.flatMap(run => blocksOf(run, openings, walls))
}

// Whether the camera, standing over `camera` on the plan, sees a wall from
// outside the room on `side` of it, where the wall would stand in its way.
export function seenFromOutside(side: WallSide, camera: Point): boolean {
  return dot([camera[0] - side.at[0], camera[1] - side.at[1]], side.out) > 0
}

// Whether the top of a full wall stands, for a camera over `camera` on the
// plan. With a room in view, only that room's side of it counts. With the
// whole home in view, a wall between two rooms keeps its top unless the
// cutaway is `all`, and an outer wall drops it while the camera is outside.
export function topShown(
  sides: WallSide[],
  camera: Point,
  focus: string | null,
  cutaway: WallsConfig['cutaway'] = true,
): boolean {
  if (cutaway === false) return true
  const mine = focus === null ? sides : sides.filter(side => side.room === focus)
  if (mine.length === 0) return false
  if (focus === null && mine.length > 1 && cutaway !== 'all') return true
  return !mine.some(side => seenFromOutside(side, camera))
}
