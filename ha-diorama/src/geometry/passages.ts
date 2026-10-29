import { betweenOf } from '#/decoration/between.ts'
import { decorationKind, footprint } from '#/decoration/catalog.ts'
import { ensureCounterClockwise } from '#/geometry/polygon.ts'
import type { DecorationConfig, Point, RoomConfig } from '#/types.ts'

// Two rooms that share a stretch of outline with no door in it are open to
// each other, a living room and the dining room beside it. From either one
// a sign on the floor just past that stretch leads to the other, the way a
// press on a door leads through it. A door gets a sign too, just past it.

// How near another room's outline has to run to count as shared, and the
// shortest stretch a person could walk through, in meters.
const TOUCH_M = 0.02
const MIN_STRETCH_M = 0.5
// How far past the shared stretch the sign starts.
export const PASSAGE_GAP_M = 0.2

// The sign, pointing along plan +x from its back edge, which sits at the
// origin: a triangle, rounded all over, that fills this outline.
export const PASSAGE_ARROW: Point[] = [
  [0, -0.43],
  [0.5, 0],
  [0, 0.43],
]
// How round its corners are on the plan beyond the rounding of its edges.
export const PASSAGE_CORNER_RADIUS_M = 0.03

// The kinds a person walks through. A window in the shared stretch leaves
// it open, a door closes it off and the sign goes just past the door.
export const DOOR_KINDS = new Set(['door', 'sliding_door', 'garage_door'])

// A way from one room into the next: the middle of the stretch they share,
// or the door between them, and the way out of `from` there, as a unit
// vector on the plan.
export type Passage = { from: string; to: string; at: Point; out: Point }

// The sign's width across the way it points, and how near a wall piece has
// to hang to a stretch to stand in front of its sign.
const ARROW_WIDTH_M = 0.86
const HANGS_ON_M = 0.15

// A piece on a wall, a window or a curtain, as where it hangs and how wide.
type Hung = { at: Point; width: number }

// Where along a stretch from `start` to `end` of an edge the sign goes: the
// middle of the widest gap the pieces hung there leave it, so a window in the
// middle of an opening does not stand in front of it. `blocked` is where the
// sign's middle would put it behind one. The middle of the stretch when
// nothing is in the way, or when there is no gap at all.
function clearOf(start: number, end: number, blocked: [number, number][]) {
  // The sign kept wholly on the stretch where it is long enough for that.
  const half = Math.min(ARROW_WIDTH_M / 2, (end - start) / 2)
  const low = start + half
  const high = end - half
  let cursor = low
  let best = { from: low, to: low }
  for (const [from, to] of [...blocked].sort((x, y) => x[0] - y[0])) {
    if (Math.min(from, high) - cursor > best.to - best.from) best = { from: cursor, to: Math.min(from, high) }
    cursor = Math.max(cursor, to)
  }
  if (high - cursor > best.to - best.from) best = { from: cursor, to: high }
  return best.to > best.from ? (best.from + best.to) / 2 : (start + end) / 2
}

// The middle of the longest stretch of `a`'s outline that `b`'s runs along,
// kept clear of the pieces hung there, and the way out of `a` there. Null
// when they share none long enough.
function sharedStretch(a: Point[], b: Point[], hung: Hung[] = []): { at: Point; out: Point } | null {
  const outline = ensureCounterClockwise(a)
  let best: { at: Point; out: Point; length: number } | null = null
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % outline.length]
    const length = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (length < MIN_STRETCH_M) continue
    const dx = (q[0] - p[0]) / length
    const dy = (q[1] - p[1]) / length
    for (let j = 0; j < b.length; j++) {
      const r = b[j]
      const s = b[(j + 1) % b.length]
      // Both ends of the other edge on this edge's line.
      const off = (v: Point) => Math.abs((v[0] - p[0]) * dy - (v[1] - p[1]) * dx)
      if (off(r) > TOUCH_M || off(s) > TOUCH_M) continue
      const along = (v: Point) => (v[0] - p[0]) * dx + (v[1] - p[1]) * dy
      const start = Math.max(0, Math.min(along(r), along(s)))
      const end = Math.min(length, Math.max(along(r), along(s)))
      if (end - start < MIN_STRETCH_M || (best && end - start <= best.length)) continue
      const blocked = hung.flatMap(item => {
        if (off(item.at) > HANGS_ON_M) return []
        const t = along(item.at)
        return t + item.width / 2 > start && t - item.width / 2 < end
          ? [[t - item.width / 2 - ARROW_WIDTH_M / 2, t + item.width / 2 + ARROW_WIDTH_M / 2] as [number, number]]
          : []
      })
      const middle = clearOf(start, end, blocked)
      // Outward from a counter clockwise outline is to the right of its edges.
      best = { at: [p[0] + dx * middle, p[1] + dy * middle], out: [dy, -dx], length: end - start }
    }
  }
  return best && { at: best.at, out: best.out }
}

// Where `at` meets the nearest edge of `points`, and the way out of them
// across that edge.
function nearestEdge(points: Point[], at: Point): { at: Point; out: Point } {
  const outline = ensureCounterClockwise(points)
  let best = { at, out: [0, 1] as Point, distance: Infinity }
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % outline.length]
    const length = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (length === 0) continue
    const dx = (q[0] - p[0]) / length
    const dy = (q[1] - p[1]) / length
    const t = Math.max(0, Math.min(length, (at[0] - p[0]) * dx + (at[1] - p[1]) * dy))
    const foot: Point = [p[0] + dx * t, p[1] + dy * t]
    const distance = Math.hypot(at[0] - foot[0], at[1] - foot[1])
    if (distance < best.distance) best = { at: foot, out: [dy, -dx], distance }
  }
  return { at: best.at, out: best.out }
}

// A room beside `room`: the door kind that leads into it, when one does,
// and the sign that leads into it, past the door or the stretch they share.
export type Neighbour = { id: string; door: string | null; passage: Passage | null }

// Every room beside `room`, through a door or open to it.
export function neighboursOf(room: RoomConfig, rooms: RoomConfig[], decorations: DecorationConfig[]): Neighbour[] {
  const doors = decorations
    .filter(item => DOOR_KINDS.has(item.kind))
    .map(item => ({ kind: item.kind, position: item.position, rooms: betweenOf(item, rooms)?.rooms ?? [] }))
    .filter(door => door.rooms.includes(room.id))
  const hung = decorations.flatMap(item => {
    const kind = decorationKind(item.kind)
    return kind?.mount === 'wall' ? [{ at: item.position, width: footprint(kind, item.params, item.variant)[0] }] : []
  })
  const result: Neighbour[] = []
  for (const other of rooms) {
    if (other.id === room.id) continue
    const door = doors.find(d => d.rooms.includes(other.id))
    const stretch = door ? nearestEdge(room.points, door.position) : sharedStretch(room.points, other.points, hung)
    if (!stretch) continue
    result.push({ id: other.id, door: door?.kind ?? null, passage: { from: room.id, to: other.id, ...stretch } })
  }
  return result
}

// Every way out of `room` into a room beside it, leaving out the ones the
// room hides.
export function passagesOf(room: RoomConfig, rooms: RoomConfig[], decorations: DecorationConfig[]): Passage[] {
  return neighboursOf(room, rooms, decorations).flatMap(neighbour =>
    neighbour.passage && !room.hide_arrows?.includes(neighbour.id) ? [neighbour.passage] : [],
  )
}

// `outline` turned and moved into place for a passage's sign on the plan.
function place(passage: Passage, outline: Point[]): Point[] {
  const [ox, oy] = passage.out
  const bx = passage.at[0] + ox * PASSAGE_GAP_M
  const by = passage.at[1] + oy * PASSAGE_GAP_M
  return outline.map(([x, y]): Point => [bx + ox * x - oy * y, by + oy * x + ox * y])
}

// Where a passage's sign lies on the plan, so the camera can keep it in the
// picture.
export function passageFootprint(passage: Passage): Point[] {
  return place(passage, PASSAGE_ARROW)
}

// The sharp core of a passage's sign on the plan: its outline drawn in by
// `by` all round, which the rounding then grows back out to the outline.
export function passageCore(passage: Passage, by: number): Point[] {
  const outline = ensureCounterClockwise(PASSAGE_ARROW)
  const n = outline.length
  const normalOf = (a: Point, b: Point): Point => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    return [(b[1] - a[1]) / length, -(b[0] - a[0]) / length]
  }
  const core = outline.map((c, i): Point => {
    const n1 = normalOf(outline[(i - 1 + n) % n], c)
    const n2 = normalOf(c, outline[(i + 1) % n])
    const k = by / (1 + n1[0] * n2[0] + n1[1] * n2[1])
    return [c[0] - (n1[0] + n2[0]) * k, c[1] - (n1[1] + n2[1]) * k]
  })
  return place(passage, core)
}
