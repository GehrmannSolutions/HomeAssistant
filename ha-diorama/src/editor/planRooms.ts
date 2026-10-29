import type { Point } from '#/types.ts'

// Rooms found in a picture of a plan, the way a magic wand finds an area in
// a photo: the paper between the drawn lines, as far as it reaches without
// squeezing through a gap narrower than a door. Pure, so it runs in the
// editor on the picture in this browser and in tests alike.
//
// The picture is first cut into ink and paper. The paper is then worn back
// from the ink by `gap` pixels, a square at a time, so a door's opening or a
// break in a scanned line narrower than twice that closes, and what is left
// falls apart into one piece per room. A room is its piece grown back out by
// as much, which brings its edges back to the lines around it, its outline
// traced, and straightened into a polygon of right angles.

export type Ink = {
  width: number
  height: number
  // 1 where the picture has ink, 0 where it has paper.
  ink: Uint8Array
}

// Ink and paper from a picture's grey levels, split where Otsu's method
// puts the line between the two, or from its light lines on a dark ground.
export function inkOf(grey: ArrayLike<number>, width: number, height: number, light = false): Ink {
  const histogram = new Array<number>(256).fill(0)
  for (let i = 0; i < width * height; i++) histogram[grey[i] | 0]++
  const total = width * height
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * histogram[v]
  let below = 0
  let belowSum = 0
  let best = 0
  let threshold = 128
  for (let v = 0; v < 256; v++) {
    below += histogram[v]
    if (below === 0) continue
    const above = total - below
    if (above === 0) break
    belowSum += v * histogram[v]
    const m0 = belowSum / below
    const m1 = (sum - belowSum) / above
    const between = below * above * (m0 - m1) * (m0 - m1)
    if (between > best) {
      best = between
      threshold = v
    }
  }
  const ink = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) ink[i] = (light ? grey[i] > threshold : grey[i] <= threshold) ? 1 : 0
  return { width, height, ink }
}

// The grey levels of RGBA pixels, as a canvas gives them.
export function greyOf(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const grey = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    grey[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2])
  }
  return grey
}

// Only the ink on straight runs across or down the picture at least `run`
// pixels long: the walls, without the text, the hatching of tiles, the arcs
// of doors and the other short or slanted marks in a room.
export function wallLines({ width, height, ink }: Ink, run: number): Ink {
  const keep = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    let start = -1
    for (let x = 0; x <= width; x++) {
      const on = x < width && ink[y * width + x] === 1
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        if (x - start >= run) for (let k = start; k < x; k++) keep[y * width + k] = 1
        start = -1
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let start = -1
    for (let y = 0; y <= height; y++) {
      const on = y < height && ink[y * width + x] === 1
      if (on && start < 0) start = y
      if (!on && start >= 0) {
        if (y - start >= run) for (let k = start; k < y; k++) keep[k * width + x] = 1
        start = -1
      }
    }
  }
  return { width, height, ink: keep }
}

// The openings in the walls closed: along each row and each column, a gap
// of at most `widest` pixels between two runs of ink at least `run` long is
// filled, which shuts a doorway or a window between the two ends of its wall.
export function closeOpenings({ width, height, ink }: Ink, widest: number, run: number): Ink {
  const out = new Uint8Array(ink)
  const runsOf = (length: number, at: (k: number) => number): [number, number][] => {
    const runs: [number, number][] = []
    let start = -1
    for (let k = 0; k <= length; k++) {
      const on = k < length && at(k) === 1
      if (on && start < 0) start = k
      if (!on && start >= 0) {
        if (k - start >= run) runs.push([start, k])
        start = -1
      }
    }
    return runs
  }
  for (let y = 0; y < height; y++) {
    const runs = runsOf(width, x => ink[y * width + x])
    for (let r = 0; r + 1 < runs.length; r++) {
      const [, end] = runs[r]
      const [next] = runs[r + 1]
      if (next - end <= widest) for (let x = end; x < next; x++) out[y * width + x] = 1
    }
  }
  for (let x = 0; x < width; x++) {
    const runs = runsOf(height, y => ink[y * width + x])
    for (let r = 0; r + 1 < runs.length; r++) {
      const [, end] = runs[r]
      const [next] = runs[r + 1]
      if (next - end <= widest) for (let y = end; y < next; y++) out[y * width + x] = 1
    }
  }
  return { width, height, ink: out }
}

// How far each pixel of paper is from the nearest ink, counting a step
// across, down or on the slant as one, so the paper worn back by a square.
// Ink is 0. The edge of the picture counts as paper running on.
export function distanceToInk({ width, height, ink }: Ink): Int32Array {
  const far = width + height
  const d = new Int32Array(width * height)
  for (let i = 0; i < width * height; i++) d[i] = ink[i] ? 0 : far
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (d[i] === 0) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) {
        v = Math.min(v, d[i - width] + 1)
        if (x > 0) v = Math.min(v, d[i - width - 1] + 1)
        if (x < width - 1) v = Math.min(v, d[i - width + 1] + 1)
      }
      d[i] = v
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (d[i] === 0) continue
      let v = d[i]
      if (x < width - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < height - 1) {
        v = Math.min(v, d[i + width] + 1)
        if (x < width - 1) v = Math.min(v, d[i + width + 1] + 1)
        if (x > 0) v = Math.min(v, d[i + width - 1] + 1)
      }
      d[i] = v
    }
  }
  return d
}

// The paper worn back by `gap`, cut into pieces: a label per pixel, 0 for
// none, and for each piece its size and whether it reaches the picture's
// edge, which makes it the outside rather than a room.
export type Pieces = { labels: Int32Array; sizes: number[]; outside: boolean[] }

export function piecesOf(ink: Ink, gap: number, distance = distanceToInk(ink)): Pieces {
  const { width, height } = ink
  const labels = new Int32Array(width * height)
  const sizes = [0]
  const outside = [false]
  const stack: number[] = []
  for (let start = 0; start < width * height; start++) {
    if (labels[start] !== 0 || distance[start] <= gap) continue
    const label = sizes.length
    sizes.push(0)
    outside.push(false)
    labels[start] = label
    stack.push(start)
    while (stack.length > 0) {
      const i = stack.pop()!
      sizes[label]++
      const x = i % width
      const y = (i - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) outside[label] = true
      const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]
      for (const j of next) {
        if (j < 0 || labels[j] !== 0 || distance[j] <= gap) continue
        labels[j] = label
        stack.push(j)
      }
    }
  }
  return { labels, sizes, outside }
}

// The piece a press at `seed` lands in: its own, or the nearest one within
// `reach` pixels when it lands near a line. 0 for none.
export function pieceAt(pieces: Pieces, ink: Ink, seed: Point, reach: number): number {
  const { width, height } = ink
  const sx = Math.round(seed[0])
  const sy = Math.round(seed[1])
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return 0
  let best = 0
  let bestDistance = Infinity
  for (let y = Math.max(0, sy - reach); y <= Math.min(height - 1, sy + reach); y++) {
    for (let x = Math.max(0, sx - reach); x <= Math.min(width - 1, sx + reach); x++) {
      const label = pieces.labels[y * width + x]
      if (label === 0) continue
      const d = Math.max(Math.abs(x - sx), Math.abs(y - sy))
      if (d < bestDistance) {
        bestDistance = d
        best = label
      }
    }
  }
  return best
}

// The outline of one piece, as the corners of its pixels' outer edge,
// clockwise on the picture (y down), from its top left corner.
function traceOutline(labels: Int32Array, width: number, height: number, label: number): Point[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label
  let first = -1
  for (let i = 0; i < width * height && first < 0; i++) if (labels[i] === label) first = i
  if (first < 0) return []
  const x0 = first % width
  const y0 = (first - x0) / width
  // Walk the corners of the pixel grid with the piece on the right hand,
  // starting east along the top edge of its first pixel.
  const points: Point[] = []
  let x = x0
  let y = y0
  let dx = 1
  let dy = 0
  const limit = 4 * width * height + 8
  for (let step = 0; step < limit; step++) {
    points.push([x, y])
    x += dx
    y += dy
    if (x === x0 && y === y0) break
    // Pixels around the corner (x, y): a at top left, b top right,
    // c bottom left, d bottom right.
    const a = at(x - 1, y - 1)
    const b = at(x, y - 1)
    const c = at(x - 1, y)
    const d = at(x, y)
    // Turn to keep the piece on the right hand.
    if (dx === 1) {
      // Heading east: right hand is south (d side), left is north (b side).
      if (b) [dx, dy] = [0, -1]
      else if (d) [dx, dy] = [1, 0]
      else [dx, dy] = [0, 1]
    } else if (dx === -1) {
      // West: right hand is north (a), left is south (c).
      if (c) [dx, dy] = [0, 1]
      else if (a) [dx, dy] = [-1, 0]
      else [dx, dy] = [0, -1]
    } else if (dy === 1) {
      // South: right hand is west (c), left is east (d).
      if (d) [dx, dy] = [1, 0]
      else if (c) [dx, dy] = [0, 1]
      else [dx, dy] = [-1, 0]
    } else {
      // North: right hand is east (b), left is west (a).
      if (a) [dx, dy] = [-1, 0]
      else if (b) [dx, dy] = [0, -1]
      else [dx, dy] = [1, 0]
    }
  }
  return points
}

// Corners only, where the outline turns.
function corners(points: Point[]): Point[] {
  const n = points.length
  return points.filter((p, i) => {
    const a = points[(i - 1 + n) % n]
    const b = points[(i + 1) % n]
    return (a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]) !== 0
  })
}

// An outline of right angles with every jog shorter than `tolerance` taken
// out: the steps of a scanned edge become one straight wall.
export function straighten(outline: Point[], tolerance: number): Point[] {
  let points = corners(outline)
  for (let round = 0; round < 20000 && points.length > 4; round++) {
    const n = points.length
    // The shortest edge, and the edges either side of it.
    let shortest = -1
    let length = Infinity
    for (let i = 0; i < n; i++) {
      const p = points[i]
      const q = points[(i + 1) % n]
      const l = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1])
      if (l < length) {
        length = l
        shortest = i
      }
    }
    if (length >= tolerance) break
    // A short edge between two parallel ones is a jog: the shorter of the
    // two moves onto the line of the longer, and the jog is gone.
    const i = shortest
    const before = points[(i - 1 + n) % n]
    const p = points[i]
    const q = points[(i + 1) % n]
    const after = points[(i + 2) % n]
    const lenBefore = Math.abs(p[0] - before[0]) + Math.abs(p[1] - before[1])
    const lenAfter = Math.abs(after[0] - q[0]) + Math.abs(after[1] - q[1])
    const next = [...points]
    const ib = (i - 1 + n) % n
    const iq = (i + 1) % n
    const ia = (i + 2) % n
    if (p[1] === q[1]) {
      // The jog runs across, so the edges either side of it run up or down:
      // the shorter one moves onto the longer one's x.
      if (lenBefore >= lenAfter) {
        next[iq] = [p[0], q[1]]
        next[ia] = [p[0], after[1]]
      } else {
        next[ib] = [q[0], before[1]]
        next[i] = [q[0], p[1]]
      }
    } else if (lenBefore >= lenAfter) {
      next[iq] = [q[0], p[1]]
      next[ia] = [after[0], p[1]]
    } else {
      next[ib] = [before[0], q[1]]
      next[i] = [p[0], q[1]]
    }
    points = corners(dedupe(next))
  }
  return points
}

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => {
    const q = points[(i + 1) % points.length]
    return p[0] !== q[0] || p[1] !== q[1]
  })
}

// One room from its piece: grown back out by `gap` to the lines around it,
// traced and straightened, as corners in picture pixels.
export function roomOutline(pieces: Pieces, ink: Ink, label: number, gap: number, tolerance: number): Point[] {
  const { mask, width, height, left, top } = closedPiece(pieces.labels, ink.width, ink.height, label, gap + 1)
  const outline = traceOutline(mask, width, height, 1).map(([x, y]): Point => [x + left, y + top])
  if (outline.length < 4) return []
  const straight = straighten(outline, tolerance)
  return grow(straight, gap)
}

// One piece cut out of the picture, with the slots narrower than a square of
// `by` filled: the notch a line standing into the room, a door's leaf or the
// side of a cupboard, leaves in it. A margin of `by` keeps the square inside.
function closedPiece(labels: Int32Array, width: number, height: number, label: number, by: number) {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (labels[y * width + x] === label) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  const left = x0 - by - 1
  const top = y0 - by - 1
  const w = x1 - x0 + 1 + 2 * (by + 1)
  const h = y1 - y0 + 1 + 2 * (by + 1)
  const start = new Int32Array(w * h)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (labels[y * width + x] === label) start[(y - top) * w + (x - left)] = 1
  // A square's reach is a row's reach then a column's.
  const spread = (from: Int32Array, grow: boolean): Int32Array => {
    const rows = new Int32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1
        for (let k = Math.max(0, x - by); k <= Math.min(w - 1, x + by); k++) {
          const f = from[y * w + k]
          if (grow ? f === 1 : f === 0) {
            v = grow ? 1 : 0
            break
          }
        }
        rows[y * w + x] = v
      }
    const both = new Int32Array(w * h)
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        let v = grow ? 0 : 1
        for (let k = Math.max(0, y - by); k <= Math.min(h - 1, y + by); k++) {
          const f = rows[k * w + x]
          if (grow ? f === 1 : f === 0) {
            v = grow ? 1 : 0
            break
          }
        }
        both[y * w + x] = v
      }
    return both
  }
  const mask = spread(spread(start, true), false)
  return { mask, width: w, height: h, left, top }
}

// A polygon of right angles moved outward by `by` on every side, its
// corners staying square. Clockwise on the picture, y down.
function grow(points: Point[], by: number): Point[] {
  const n = points.length
  // Signed area, positive when clockwise on a picture with y down.
  let area = 0
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    area += x1 * y2 - x2 * y1
  }
  const sign = area > 0 ? 1 : -1
  // Each edge's outward normal, then each corner moved along both of its
  // edges' normals.
  const normal = (p: Point, q: Point): Point => {
    const dx = Math.sign(q[0] - p[0])
    const dy = Math.sign(q[1] - p[1])
    // Clockwise on the picture the inside is on the right of each edge, so
    // out is on its left: north of an edge heading east.
    return [dy * sign, -dx * sign]
  }
  return points.map((p, i) => {
    const a = normal(points[(i - 1 + n) % n], p)
    const b = normal(p, points[(i + 1) % n])
    return [p[0] + (a[0] + b[0]) * by, p[1] + (a[1] + b[1]) * by]
  })
}

// Every room in the picture: the pieces that do not reach its edge and are
// at least `least` pixels in size.
export function roomsOf(ink: Ink, gap: number, tolerance: number, least: number): Point[][] {
  const pieces = piecesOf(ink, gap)
  const rooms: Point[][] = []
  for (let label = 1; label < pieces.sizes.length; label++) {
    if (pieces.outside[label] || pieces.sizes[label] < least) continue
    const outline = roomOutline(pieces, ink, label, gap, tolerance)
    if (outline.length >= 4) rooms.push(outline)
  }
  return rooms
}

// The settings of the search in meters, and what they come to in pixels of
// a picture `perMeter` pixels to the meter.
export type PlanSettings = {
  // The shortest straight run of ink taken as a wall line.
  run: number
  // The widest opening in a wall that is closed, a door or a window.
  opening: number
  // Half the narrowest gap a room does not run through.
  gap: number
  // The longest jog in an edge taken out when it is straightened.
  jog: number
  // The smallest room, in square meters.
  least: number
}

export const PLAN_SETTINGS: PlanSettings = { run: 0.4, opening: 1.3, gap: 0.15, jog: 0.15, least: 1.5 }

// A strip narrower than this and many times as long is the paper between a
// wall and a dimension line, not a room.
const STRIP_M = 1.1
const STRIP_STRETCH = 4

// The walls of a plan picture: ink on long straight runs, openings shut.
export function planWalls(ink: Ink, perMeter: number, settings: PlanSettings = PLAN_SETTINGS): Ink {
  const run = Math.max(3, Math.round(settings.run * perMeter))
  return closeOpenings(wallLines(ink, run), Math.round(settings.opening * perMeter), run)
}

// Every room of a plan picture, as corners in its pixels.
export function planRooms(ink: Ink, perMeter: number, settings: PlanSettings = PLAN_SETTINGS): Point[][] {
  const walls = planWalls(ink, perMeter, settings)
  const gap = Math.max(1, Math.round(settings.gap * perMeter))
  const rooms = roomsOf(walls, gap, Math.max(2, Math.round(settings.jog * perMeter)), settings.least * perMeter * perMeter)
  return rooms.filter(room => {
    const xs = room.map(p => p[0])
    const ys = room.map(p => p[1])
    const a = (Math.max(...xs) - Math.min(...xs)) / perMeter
    const b = (Math.max(...ys) - Math.min(...ys)) / perMeter
    return !(Math.min(a, b) < STRIP_M && Math.max(a, b) > STRIP_STRETCH * Math.min(a, b))
  })
}
