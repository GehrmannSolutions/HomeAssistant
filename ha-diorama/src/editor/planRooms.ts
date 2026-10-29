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

// The pieces of `value` pixels touching side by side, with their sizes and
// boxes.
export type Parts = {
  labels: Int32Array
  area: number[]
  left: number[]
  top: number[]
  right: number[]
  bottom: number[]
}

export function partsOf(mask: Uint8Array, width: number, height: number, value: number, diagonal = false): Parts {
  const labels = new Int32Array(width * height)
  const parts: Parts = { labels, area: [0], left: [0], top: [0], right: [0], bottom: [0] }
  const stack: number[] = []
  for (let seed = 0; seed < labels.length; seed++) {
    if (mask[seed] !== value || labels[seed]) continue
    const label = parts.area.length
    let area = 0
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    labels[seed] = label
    stack.push(seed)
    while (stack.length) {
      const i = stack.pop() as number
      const x = i % width
      const y = (i - x) / width
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (mask[j] === value && !labels[j]) {
            labels[j] = label
            stack.push(j)
          }
        }
    }
    parts.area.push(area)
    parts.left.push(x0)
    parts.top.push(y0)
    parts.right.push(x1)
    parts.bottom.push(y1)
  }
  return parts
}

// Dashed and dash-dotted lines taken out: section lines, hidden edges and
// the like cross rooms and would read as the side of a wall. Along a row or
// a column, four or more short thin dashes with short gaps between them are
// such a line. The lines of walls run on for meters.
export function withoutDashes({ width, height, ink }: Ink, perMeter: number): Ink {
  const dash = Math.round(1.2 * perMeter)
  const gap = Math.max(3, Math.round(0.5 * perMeter))
  const thick = Math.max(3, Math.round(0.05 * perMeter))
  const out = new Uint8Array(ink)
  const sweep = (
    lines: number,
    length: number,
    at: (line: number, k: number) => number,
    side: (line: number, k: number) => number,
  ) => {
    for (let line = 0; line < lines; line++) {
      const dashes: [number, number][] = []
      const flush = () => {
        if (dashes.length >= 4) for (const [a, b] of dashes) for (let k = a; k < b; k++) out[at(line, k)] = 0
        dashes.length = 0
      }
      let start = -1
      for (let k = 0; k <= length; k++) {
        const on = k < length && ink[at(line, k)] === 1
        if (on && start < 0) start = k
        if (!on && start >= 0) {
          const thin = side(line, (start + k) >> 1) <= thick
          if (k - start > dash || !thin) flush()
          else {
            if (dashes.length && start - dashes[dashes.length - 1][1] > gap) flush()
            dashes.push([start, k])
          }
          start = -1
        }
      }
      flush()
    }
  }
  // How thick the ink is across a line at a pixel.
  const acrossAt = (y: number, x: number) => {
    let a = x
    let b = x
    while (a > 0 && ink[y * width + a - 1]) a--
    while (b < width - 1 && ink[y * width + b + 1]) b++
    return b - a + 1
  }
  const downAt = (x: number, y: number) => {
    let a = y
    let b = y
    while (a > 0 && ink[(a - 1) * width + x]) a--
    while (b < height - 1 && ink[(b + 1) * width + x]) b++
    return b - a + 1
  }
  sweep(
    width,
    height,
    (x, y) => y * width + x,
    (x, y) => acrossAt(y, x),
  )
  sweep(
    height,
    width,
    (y, x) => y * width + x,
    (y, x) => downAt(x, y),
  )
  return { width, height, ink: out }
}

// The cells of tiles drawn on a floor: small squarish bits of paper, at
// most `cell` pixels across.
export function tileCells({ width, height, ink }: Ink, perMeter: number): Uint8Array {
  const cells = partsOf(ink, width, height, 0)
  const cell = Math.round(0.25 * perMeter)
  const tile = cells.area.map((area, k) => {
    const w = cells.right[k] - cells.left[k] + 1
    const h = cells.bottom[k] - cells.top[k] + 1
    return k > 0 && area <= cell * cell && Math.max(w, h) <= 2.5 * Math.min(w, h)
  })
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) if (tile[cells.labels[i]]) out[i] = 1
  return out
}

// Walls drawn the way plans draw them: two lines with paper between. A
// pixel of paper lies inside a wall when its stretch of paper is as narrow
// as a wall one way and long the other way. A strip with another such strip
// beyond both of its lines is a tread of a stair or a pane of a window, not a
// wall. Tiles, text and furniture make no such strips. Every strip found is
// widened over its two lines.
export type WallMasks = { width: number; height: number; down: Uint8Array; across: Uint8Array }

export function wallStrips({ width, height, ink }: Ink, perMeter: number, tiles: Uint8Array): WallMasks {
  // The rim of a bath or a basin is narrower than the thinnest wall, the
  // inside of a bath wider than the paper between the lines of the thickest.
  const thinnest = Math.max(3, Math.round(0.065 * perMeter))
  const thickest = Math.round(0.4 * perMeter)
  const shortest = Math.round(0.25 * perMeter)
  const line = Math.max(2, Math.round(0.06 * perMeter))
  const size = width * height
  const open = width + height
  // The length of the stretch of paper through each pixel, along its row and
  // along its column. A stretch running off the picture has no end.
  const across = new Int32Array(size)
  const down = new Int32Array(size)
  for (let y = 0; y < height; y++) {
    let start = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && ink[y * width + x] === 0) continue
      const n = start === 0 || x === width ? open : x - start
      for (let k = start; k < x; k++) across[y * width + k] = n
      start = x + 1
    }
  }
  for (let x = 0; x < width; x++) {
    let start = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && ink[y * width + x] === 0) continue
      const n = start === 0 || y === height ? open : y - start
      for (let k = start; k < y; k++) down[k * width + x] = n
      start = y + 1
    }
  }
  // 1: a wall running up and down the picture, 2: one running across.
  const thin = (n: number) => n >= thinnest && n <= thickest
  const kind = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    if (ink[i]) continue
    if (thin(across[i]) && down[i] >= Math.max(shortest, STRETCH * across[i])) kind[i] = 1
    else if (thin(down[i]) && across[i] >= Math.max(shortest, STRETCH * down[i])) kind[i] = 2
  }
  // A strip runs on along the wall: the gaps of a dashed line are narrow one
  // way and long the other too, but only a line's width long.
  for (let x = 0; x < width; x++) {
    let start = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && kind[y * width + x] === 1) continue
      if (y - start < shortest) for (let k = start; k < y; k++) kind[k * width + x] = 0
      start = y + 1
    }
  }
  for (let y = 0; y < height; y++) {
    let start = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && kind[y * width + x] === 2) continue
      if (x - start < shortest) for (let k = start; k < x; k++) kind[y * width + k] = 0
      start = x + 1
    }
  }
  const upright = new Uint8Array(size)
  const lying = new Uint8Array(size)
  // What lies beyond the line next to a pixel: the kind of the first paper
  // within `line` steps, or 0.
  const beyond = (x: number, y: number, dx: number, dy: number): number => {
    for (let k = 0; k < line; k++) {
      x += dx
      y += dy
      if (x < 0 || y < 0 || x >= width || y >= height) return 0
      const i = y * width + x
      if (!ink[i]) return tiles[i] ? 3 : kind[i]
    }
    return 0
  }
  // A strip between two strips of its own kind, or between tiles, is no wall.
  const boxed = (a: number, b: number, own: number) => (a === own || a === 3) && (b === own || b === 3)
  for (let y = 0; y < height; y++) {
    let start = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && ink[y * width + x] === 0) continue
      if (x > start && !boxed(beyond(start, y, -1, 0), beyond(x - 1, y, 1, 0), 1))
        for (let k = start; k < x; k++) if (kind[y * width + k] === 1) upright[y * width + k] = 1
      start = x + 1
    }
  }
  for (let x = 0; x < width; x++) {
    let start = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && ink[y * width + x] === 0) continue
      if (y > start && !boxed(beyond(x, start, 0, -1), beyond(x, y - 1, 0, 1), 2))
        for (let k = start; k < y; k++) if (kind[k * width + x] === 2) lying[k * width + x] = 1
      start = y + 1
    }
  }
  return { width, height, down: widen(upright, width, height, line), across: widen(lying, width, height, line) }
}

// Walls drawn as one dense band: a solid wall, or a window front drawn as
// its frame and panes a few centimeters apart. Gaps of paper up to `close`
// pixels between ink are shut first, then a band is ink as thick as a wall
// one way and long the other. A single line is too thin to count.
export function wallBands({ width, height, ink }: Ink, perMeter: number, tiles: Uint8Array): WallMasks {
  const close = Math.max(1, Math.round(0.05 * perMeter))
  const thinnest = Math.max(4, Math.round(0.07 * perMeter))
  const thickest = Math.round(0.45 * perMeter)
  const shortest = Math.round(0.45 * perMeter)
  const size = width * height
  const solid = new Uint8Array(ink)
  for (let y = 0; y < height; y++) {
    let last = -1
    for (let x = 0; x < width; x++) {
      if (!ink[y * width + x]) continue
      if (last >= 0 && x - last - 1 <= close) for (let k = last + 1; k < x; k++) solid[y * width + k] = 1
      last = x
    }
  }
  for (let x = 0; x < width; x++) {
    let last = -1
    for (let y = 0; y < height; y++) {
      if (!ink[y * width + x]) continue
      if (last >= 0 && y - last - 1 <= close) for (let k = last + 1; k < y; k++) solid[k * width + x] = 1
      last = y
    }
  }
  const across = new Int32Array(size)
  const down = new Int32Array(size)
  for (let y = 0; y < height; y++) {
    let start = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && solid[y * width + x] === 1) continue
      for (let k = start; k < x; k++) across[y * width + k] = x - start
      start = x + 1
    }
  }
  for (let x = 0; x < width; x++) {
    let start = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && solid[y * width + x] === 1) continue
      for (let k = start; k < y; k++) down[k * width + x] = y - start
      start = y + 1
    }
  }
  const thin = (n: number) => n >= thinnest && n <= thickest
  // The runs of the ink itself: a band of text shut solid holds no long line,
  // the frame of a window does.
  const line = Math.round(0.4 * perMeter)
  const inkAcross = new Int32Array(size)
  const inkDown = new Int32Array(size)
  for (let y = 0; y < height; y++) {
    let start = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && ink[y * width + x] === 1) continue
      for (let k = start; k < x; k++) inkAcross[y * width + k] = x - start
      start = x + 1
    }
  }
  for (let x = 0; x < width; x++) {
    let start = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && ink[y * width + x] === 1) continue
      for (let k = start; k < y; k++) inkDown[k * width + x] = y - start
      start = y + 1
    }
  }
  const upright = new Uint8Array(size)
  const lying = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    if (!solid[i]) continue
    if (thin(across[i]) && down[i] >= Math.max(shortest, STRETCH * across[i])) upright[i] = 1
    else if (thin(down[i]) && across[i] >= Math.max(shortest, STRETCH * down[i])) lying[i] = 1
  }
  // Keep a cross-section of a band only when a long line runs through it,
  // and not when the paper in it is mostly the cells of tiles: a strip of a
  // tiled floor shuts solid too.
  const keep = (from: number, to: number, at: (k: number) => number, runs: Int32Array) => {
    let long = false
    let paper = 0
    let tiled = 0
    for (let k = from; k < to; k++) {
      const i = at(k)
      if (runs[i] >= line) long = true
      if (!ink[i]) {
        paper++
        tiled += tiles[i]
      }
    }
    return long && !(tiled > 0 && tiled * 2 > paper)
  }
  for (let y = 0; y < height; y++) {
    let start = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && upright[y * width + x] === 1) continue
      if (!keep(start, x, k => y * width + k, inkDown)) for (let k = start; k < x; k++) upright[y * width + k] = 0
      start = x + 1
    }
  }
  for (let x = 0; x < width; x++) {
    let start = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && lying[y * width + x] === 1) continue
      if (!keep(start, y, k => k * width + x, inkAcross)) for (let k = start; k < y; k++) lying[k * width + x] = 0
      start = y + 1
    }
  }
  // What is left of a band must still be long along it, not the sliver where
  // a line of tiles crosses.
  for (let x = 0; x < width; x++) {
    let start = 0
    for (let y = 0; y <= height; y++) {
      if (y < height && upright[y * width + x] === 1) continue
      if (y - start < shortest) for (let k = start; k < y; k++) upright[k * width + x] = 0
      start = y + 1
    }
  }
  for (let y = 0; y < height; y++) {
    let start = 0
    for (let x = 0; x <= width; x++) {
      if (x < width && lying[y * width + x] === 1) continue
      if (x - start < shortest) for (let k = start; k < x; k++) lying[y * width + k] = 0
      start = x + 1
    }
  }
  const grow = Math.max(2, Math.round(0.06 * perMeter))
  return { width, height, down: widen(upright, width, height, grow), across: widen(lying, width, height, grow) }
}

// A wall that stops short of another wall ahead of it, the side of a door
// next to a corner, carried on to it: along the wall's way, a run of wall at
// least `run` long that has other wall within `reach` beyond its end is
// extended to it.
function extend(
  mask: Uint8Array,
  any: Uint8Array,
  width: number,
  height: number,
  rows: boolean,
  reach: number,
  run: number,
): Uint8Array {
  const out = new Uint8Array(mask)
  const lines = rows ? height : width
  const length = rows ? width : height
  const at = (line: number, k: number) => (rows ? line * width + k : k * width + line)
  for (let line = 0; line < lines; line++) {
    let start = -1
    for (let k = 0; k <= length; k++) {
      const on = k < length && mask[at(line, k)] === 1
      if (on && start < 0) start = k
      if (!on && start >= 0) {
        if (k - start >= run) {
          for (let j = k; j < Math.min(length, k + reach); j++)
            if (any[at(line, j)]) {
              for (let f = k; f < j; f++) out[at(line, f)] = 1
              break
            }
          for (let j = start - 1; j >= Math.max(0, start - reach); j--)
            if (any[at(line, j)]) {
              for (let f = j + 1; f < start; f++) out[at(line, f)] = 1
              break
            }
        }
        start = -1
      }
    }
  }
  return out
}

// The openings of walls running one way closed: along that way, a gap of at
// most `door` pixels between two runs of wall at least `run` long is filled,
// and a wider one up to `widest` when the panes of a window run through it,
// ink along at least a third of it. A wall running across is never bridged
// up and down, so two walls facing each other over a narrow room stay apart,
// and a hall between the ends of two walls in line stays open.
function bridge(
  mask: Uint8Array,
  ink: Uint8Array,
  width: number,
  height: number,
  rows: boolean,
  door: number,
  widest: number,
  run: number,
): Uint8Array {
  const out = new Uint8Array(mask)
  const lines = rows ? height : width
  const length = rows ? width : height
  const at = (line: number, k: number) => (rows ? line * width + k : k * width + line)
  const panes = (line: number, a: number, b: number) => {
    let best = 0
    for (let l = Math.max(0, line - 2); l <= Math.min(lines - 1, line + 2); l++) {
      let n = 0
      for (let k = a; k < b; k++) n += ink[at(l, k)]
      best = Math.max(best, n)
    }
    return best >= (b - a) / 3
  }
  for (let line = 0; line < lines; line++) {
    let start = -1
    let end = -1
    for (let k = 0; k <= length; k++) {
      const on = k < length && mask[at(line, k)] === 1
      if (on && start < 0) start = k
      if (!on && start >= 0) {
        if (k - start >= run) {
          const gap = start - end
          if (end >= 0 && (gap <= door || (gap <= widest && panes(line, end, start))))
            for (let j = end; j < start; j++) out[at(line, j)] = 1
          end = k
        }
        start = -1
      }
    }
  }
  return out
}

// How much longer than wide a stretch of paper or ink must be to be a wall.
const STRETCH = 1.8

// Every set pixel grown into a square of `by` pixels round it.
function widen(set: Uint8Array, width: number, height: number, by: number): Uint8Array {
  const rows = new Uint8Array(set.length)
  for (let y = 0; y < height; y++) {
    let last = -by - 1
    for (let x = 0; x < width; x++) {
      if (set[y * width + x]) last = x
      if (x - last <= by) rows[y * width + x] = 1
    }
    last = width + by + 1
    for (let x = width - 1; x >= 0; x--) {
      if (set[y * width + x]) last = x
      if (last - x <= by) rows[y * width + x] = 1
    }
  }
  const out = new Uint8Array(set.length)
  for (let x = 0; x < width; x++) {
    let last = -by - 1
    for (let y = 0; y < height; y++) {
      if (rows[y * width + x]) last = y
      if (y - last <= by) out[y * width + x] = 1
    }
    last = height + by + 1
    for (let y = height - 1; y >= 0; y--) {
      if (rows[y * width + x]) last = y
      if (last - y <= by) out[y * width + x] = 1
    }
  }
  return out
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
      const next = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ]
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

export const PLAN_SETTINGS: PlanSettings = { run: 0.4, opening: 2.6, gap: 0.05, jog: 0.15, least: 1 }

// Half the widest chink between two pieces of wall that is shut.
const SEAL_M = 0.15

// The widest door beside a corner, with the short piece of wall next to it.
const DOOR_M = 1.1

// A strip narrower than this and many times as long is the paper between a
// wall and a dimension line, not a room.
const STRIP_M = 1.1
const STRIP_STRETCH = 4

// The walls of a plan picture: ink on long straight runs, openings shut.
export function planWalls(ink: Ink, perMeter: number, settings: PlanSettings = PLAN_SETTINGS): Ink {
  return wallsOfPlan(ink, perMeter, settings).walls
}

// The walls of a plan picture as found, `found`, and with their openings
// closed and their chinks shut, `walls`.
function wallsOfPlan(ink: Ink, perMeter: number, settings: PlanSettings): { found: Ink; walls: Ink; bands: Ink } {
  const run = Math.max(3, Math.round(settings.run * perMeter))
  const { width, height } = ink
  const clean = withoutDashes(ink, perMeter)
  const tiles = tileCells(clean, perMeter)
  const strips = wallStrips(clean, perMeter, tiles)
  const bands = wallBands(clean, perMeter, tiles)
  const down = new Uint8Array(width * height)
  const across = new Uint8Array(width * height)
  for (let i = 0; i < down.length; i++) {
    down[i] = strips.down[i] | bands.down[i]
    across[i] = strips.across[i] | bands.across[i]
  }
  // The frame round the sheet is no wall of the house: a thin piece, long,
  // close to an edge of the picture.
  const raw = new Uint8Array(width * height)
  for (let i = 0; i < raw.length; i++) raw[i] = down[i] | across[i]
  const pieces = partsOf(raw, width, height, 1, true)
  const frame = pieces.area.map((area, k) => {
    if (!k) return false
    const w = pieces.right[k] - pieces.left[k] + 1
    const h = pieces.bottom[k] - pieces.top[k] + 1
    const thin = area / (w + h) <= 0.1 * perMeter
    const long = w >= 0.4 * width || h >= 0.4 * height
    const edge = Math.min(pieces.left[k], pieces.top[k], width - 1 - pieces.right[k], height - 1 - pieces.bottom[k])
    return thin && long && edge <= 0.08 * Math.min(width, height)
  })
  for (let i = 0; i < raw.length; i++)
    if (frame[pieces.labels[i]]) {
      down[i] = 0
      across[i] = 0
    }
  const found = new Uint8Array(width * height)
  for (let i = 0; i < found.length; i++) found[i] = down[i] | across[i]
  const widest = Math.round(settings.opening * perMeter)
  const door = Math.round(DOOR_M * perMeter)
  // Panes drawn faint come out of a scan dotted, so look for them in the ink
  // before dashes were taken out.
  const upright = bridge(down, ink.ink, width, height, false, door, widest, run)
  const lying = bridge(across, ink.ink, width, height, true, door, widest, run)
  const any = new Uint8Array(width * height)
  for (let i = 0; i < any.length; i++) any[i] = upright[i] | lying[i]
  // Only a wall of some length is carried on, not the edge of a basin.
  const long = Math.round(0.8 * perMeter)
  const upright2 = extend(upright, any, width, height, false, door, long)
  const lying2 = extend(lying, any, width, height, true, door, long)
  const walls = new Uint8Array(width * height)
  for (let i = 0; i < walls.length; i++) walls[i] = upright2[i] | lying2[i]
  // Chinks between pieces of wall, up to `seal` across, shut: grown, then
  // worn back by as much.
  const seal = Math.max(1, Math.round(SEAL_M * perMeter))
  const grown = widen(walls, width, height, seal)
  for (let i = 0; i < grown.length; i++) grown[i] = grown[i] ? 0 : 1
  const worn = widen(grown, width, height, seal)
  for (let i = 0; i < walls.length; i++) walls[i] = worn[i] ? 0 : 1
  const fronts = new Uint8Array(width * height)
  for (let i = 0; i < fronts.length; i++) fronts[i] = (bands.down[i] | bands.across[i]) & found[i]
  return {
    found: { width, height, ink: found },
    walls: { width, height, ink: walls },
    bands: { width, height, ink: fronts },
  }
}

// Every room of a plan picture, as corners in its pixels.
export function planRooms(ink: Ink, perMeter: number, settings: PlanSettings = PLAN_SETTINGS): Point[][] {
  return planRoomsIn(planWalls(ink, perMeter, settings), perMeter, settings)
}

function planRoomsIn(walls: Ink, perMeter: number, settings: PlanSettings): Point[][] {
  const gap = Math.max(1, Math.round(settings.gap * perMeter))
  const rooms = roomsOf(
    walls,
    gap,
    Math.max(2, Math.round(settings.jog * perMeter)),
    settings.least * perMeter * perMeter,
  )
  return rooms.filter(room => {
    const xs = room.map(p => p[0])
    const ys = room.map(p => p[1])
    const a = (Math.max(...xs) - Math.min(...xs)) / perMeter
    const b = (Math.max(...ys) - Math.min(...ys)) / perMeter
    return !(Math.min(a, b) < STRIP_M && Math.max(a, b) > STRIP_STRETCH * Math.min(a, b))
  })
}

// What a plan picture shows, in its pixels: the rooms, their sides moved to
// the middle of the walls they share; the doors and windows; and how thick
// the outer walls are.
export type PlanOpening = {
  // The middle of the opening, and its width along the wall.
  at: Point
  width: number
  // Whether the wall runs up and down the picture.
  upright: boolean
  // A door between two rooms or to the outside, or a window.
  door: boolean
  // The rooms on either side, by their place in `rooms`; -1 is outside.
  rooms: [number, number]
}

export type PlanReading = { rooms: Point[][]; openings: PlanOpening[]; outer: number }

export function readPlan(ink: Ink, perMeter: number, settings: PlanSettings = PLAN_SETTINGS): PlanReading {
  const { width, height } = ink
  const { found, walls, bands } = wallsOfPlan(ink, perMeter, settings)
  // The walls as found are drawn this much wider than their lines.
  const grow = Math.max(2, Math.round(0.06 * perMeter))
  const rooms = planRoomsIn(walls, perMeter, settings)
  const labels = paintRooms(rooms, width, height)
  const reach = Math.round(0.6 * perMeter)
  // From a point on a room's side, outward: how many pixels of wall, and the
  // room beyond them, 0 for none.
  const probe = (x: number, y: number, dx: number, dy: number): [number, number] => {
    let k = 0
    while (k < 3 && inside(x + dx * k, y + dy * k) && !walls.ink[at(x + dx * k, y + dy * k)]) k++
    let d = 0
    while (d < reach && inside(x + dx * (k + d), y + dy * (k + d)) && walls.ink[at(x + dx * (k + d), y + dy * (k + d))])
      d++
    for (let e = 0; e < 4; e++) {
      const px = x + dx * (k + d + e)
      const py = y + dy * (k + d + e)
      if (!inside(px, py)) return [d, 0]
      const l = labels[at(px, py)]
      if (l) return [d, l]
    }
    return [d, 0]
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height
  const at = (x: number, y: number) => Math.round(y) * width + Math.round(x)
  const outerSeen: number[] = []
  const moved = rooms.map((room, r) => {
    const n = room.length
    const shifts: { normal: Point; by: number }[] = []
    for (let i = 0; i < n; i++) {
      const a = room[i]
      const b = room[(i + 1) % n]
      const flat = Math.abs(a[1] - b[1]) < Math.abs(a[0] - b[0])
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      let normal: Point = flat ? [0, -1] : [-1, 0]
      if (pointIn(room, mid[0] + normal[0] * 2, mid[1] + normal[1] * 2)) normal = [-normal[0], -normal[1]]
      const length = flat ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1])
      const near: number[] = []
      const far: number[] = []
      let samples = 0
      for (let t = 6; t <= length - 6; t += 4) {
        const f = t / length
        const [d, l] = probe(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, normal[0], normal[1])
        samples++
        if (l && l !== r + 1) near.push(d)
        else if (!l) far.push(d)
      }
      let by = 0
      if (samples && near.length * 2 >= samples) by = median(near) / 2
      else if (samples && far.length * 2 >= samples) {
        // An outer side goes out to the inner face of its wall.
        by = Math.min(grow, median(far))
        outerSeen.push(median(far) - 2 * grow)
      }
      shifts.push({ normal, by })
    }
    return room.map((p, i): Point => {
      const before = shifts[(i - 1 + n) % n]
      const after = shifts[i]
      return [
        p[0] + before.normal[0] * before.by + after.normal[0] * after.by,
        p[1] + before.normal[1] * before.by + after.normal[1] * after.by,
      ]
    })
  })
  const openings = [...openingsOf(found, walls, labels, perMeter), ...frontsOf(bands, walls, labels, perMeter)]
  return { rooms: moved, openings, outer: outerSeen.length ? Math.max(0, median(outerSeen)) : 0 }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

function pointIn(polygon: Point[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Each room painted with its place in the list plus one.
function paintRooms(rooms: Point[][], width: number, height: number): Int32Array {
  const labels = new Int32Array(width * height)
  rooms.forEach((room, r) => {
    const xs = room.map(p => p[0])
    const ys = room.map(p => p[1])
    const x0 = Math.max(0, Math.floor(Math.min(...xs)))
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)))
    const y0 = Math.max(0, Math.floor(Math.min(...ys)))
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)))
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (pointIn(room, x + 0.5, y + 0.5)) labels[y * width + x] = r + 1
  })
  return labels
}

// The openings closed in the walls: what was added to the walls as found,
// in pieces at least half a meter along the wall. A piece between two rooms
// is a door; one to the outside a window, unless no panes run through it.
function openingsOf(found: Ink, walls: Ink, labels: Int32Array, perMeter: number): PlanOpening[] {
  const { width, height } = walls
  const added = new Uint8Array(width * height)
  for (let i = 0; i < added.length; i++) added[i] = walls.ink[i] && !found.ink[i] ? 1 : 0
  const parts = partsOf(added, width, height, 1, true)
  const shortest = 0.5 * perMeter
  const reach = Math.round(0.8 * perMeter)
  const out: PlanOpening[] = []
  for (let k = 1; k < parts.area.length; k++) {
    const w = parts.right[k] - parts.left[k] + 1
    const h = parts.bottom[k] - parts.top[k] + 1
    const upright = h > w
    if (Math.max(w, h) < shortest) continue
    const cx = (parts.left[k] + parts.right[k]) / 2
    const cy = (parts.top[k] + parts.bottom[k]) / 2
    const side = (sign: number): number => {
      for (let d = 1; d < reach; d++) {
        const x = Math.round(upright ? cx + sign * d : cx)
        const y = Math.round(upright ? cy : cy + sign * d)
        if (x < 0 || y < 0 || x >= width || y >= height) return -1
        const i = y * width + x
        if (walls.ink[i]) continue
        return labels[i] ? labels[i] - 1 : -1
      }
      return -1
    }
    const a = side(-1)
    const b = side(1)
    if (a === b || (a < 0 && b < 0)) continue
    out.push({ at: [cx, cy], width: Math.max(w, h), upright, door: a >= 0 && b >= 0, rooms: [a, b] })
  }
  return out
}

// Window fronts: a band on the outside of a room, far thinner than a wall,
// is the frame and panes of a run of windows. Each is cut into windows no
// wider than `widest`.
function frontsOf(bands: Ink, walls: Ink, labels: Int32Array, perMeter: number): PlanOpening[] {
  const { width, height } = bands
  const parts = partsOf(bands.ink, width, height, 1, true)
  const shortest = 0.6 * perMeter
  // The frame and panes, drawn a little wider like every wall found.
  const thickest = 0.3 * perMeter
  const widest = 2.5 * perMeter
  const reach = Math.round(0.8 * perMeter)
  const out: PlanOpening[] = []
  for (let k = 1; k < parts.area.length; k++) {
    const w = parts.right[k] - parts.left[k] + 1
    const h = parts.bottom[k] - parts.top[k] + 1
    const upright = h > w
    const length = Math.max(w, h)
    if (length < shortest || parts.area[k] / length > thickest) continue
    const cx = (parts.left[k] + parts.right[k]) / 2
    const cy = (parts.top[k] + parts.bottom[k]) / 2
    const side = (sign: number): number => {
      for (let d = 1; d < reach; d++) {
        const x = Math.round(upright ? cx + sign * d : cx)
        const y = Math.round(upright ? cy : cy + sign * d)
        if (x < 0 || y < 0 || x >= width || y >= height) return -1
        const i = y * width + x
        if (walls.ink[i]) continue
        return labels[i] ? labels[i] - 1 : -1
      }
      return -1
    }
    const a = side(-1)
    const b = side(1)
    if (a < 0 === b < 0) continue
    const pieces = Math.ceil(length / widest)
    const step = length / pieces
    for (let n = 0; n < pieces; n++) {
      const along = (upright ? parts.top[k] : parts.left[k]) + step * (n + 0.5)
      out.push({ at: upright ? [cx, along] : [along, cy], width: step, upright, door: false, rooms: [a, b] })
    }
  }
  return out
}
