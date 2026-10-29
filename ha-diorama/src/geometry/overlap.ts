import type { Point } from '#/types.ts'

// Overlap tests between room polygons. Rooms may touch along edges and share
// corners, but their interiors must never intersect.

const EPS = 1e-9
// Offset used to probe just inside a polygon, in meters.
const PROBE_M = 0.001

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

// True when the two segments cross at a point interior to both.
export function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const rx = b[0] - a[0]
  const ry = b[1] - a[1]
  const sx = d[0] - c[0]
  const sy = d[1] - c[1]
  const denom = cross(rx, ry, sx, sy)
  if (Math.abs(denom) < EPS) return false
  const t = cross(c[0] - a[0], c[1] - a[1], sx, sy) / denom
  const u = cross(c[0] - a[0], c[1] - a[1], rx, ry) / denom
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS
}

export function pointOnBoundary(p: Point, polygon: Point[]) {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const len2 = abx * abx + aby * aby || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2))
    const dx = p[0] - (a[0] + abx * t)
    const dy = p[1] - (a[1] + aby * t)
    if (dx * dx + dy * dy < EPS) return true
  }
  return false
}

// Even-odd test. Points on the boundary count as outside.
export function pointStrictlyInside(p: Point, polygon: Point[]) {
  if (pointOnBoundary(p, polygon)) return false
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function signedArea(points: Point[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

// Points a hair inside the polygon, one per edge midpoint. They tell apart a
// shared wall (probe lands outside the neighbour) from a real overlap.
function insideProbes(polygon: Point[]): Point[] {
  const sign = signedArea(polygon) >= 0 ? 1 : -1
  const n = polygon.length
  const probes: Point[] = []
  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    // Left normal of a counter clockwise edge points inward.
    const nx = (-dy / len) * sign
    const ny = (dx / len) * sign
    probes.push([(a[0] + b[0]) / 2 + nx * PROBE_M, (a[1] + b[1]) / 2 + ny * PROBE_M])
  }
  return probes
}

// True when the polygon crosses itself.
export function selfIntersects(polygon: Point[]) {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(polygon[i], polygon[(i + 1) % n], polygon[j], polygon[(j + 1) % n])) return true
    }
  }
  return false
}

export function polygonsOverlap(a: Point[], b: Point[]) {
  const na = a.length
  const nb = b.length
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      if (segmentsCross(a[i], a[(i + 1) % na], b[j], b[(j + 1) % nb])) return true
    }
  }
  if (a.some(p => pointStrictlyInside(p, b))) return true
  if (b.some(p => pointStrictlyInside(p, a))) return true
  if (insideProbes(a).some(p => pointStrictlyInside(p, b))) return true
  if (insideProbes(b).some(p => pointStrictlyInside(p, a))) return true
  return false
}

// True when the polygon is usable as a room next to the others: simple, with
// area, and not overlapping any of them.
export function isValidRoom(polygon: Point[], others: Point[][]) {
  if (polygon.length < 3) return false
  if (Math.abs(signedArea(polygon)) < EPS) return false
  if (selfIntersects(polygon)) return false
  return !others.some(o => polygonsOverlap(polygon, o))
}

// True when a segment being drawn would enter a room: it crosses one of its
// edges or runs through its interior.
export function segmentEntersAny(a: Point, b: Point, others: Point[][]) {
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return others.some(o => {
    const n = o.length
    for (let i = 0; i < n; i++) if (segmentsCross(a, b, o[i], o[(i + 1) % n])) return true
    return pointStrictlyInside(mid, o) || pointStrictlyInside(b, o)
  })
}

// Bisects between `from` (valid) and `to` (blocked) and returns the furthest
// valid polygon on the way, or null when there is no room to move at all.
export function furthestValid(from: Point[], to: Point[], others: Point[][]): Point[] | null {
  if (from.length !== to.length) return null
  const at = (t: number) => from.map((p, i) => [p[0] + (to[i][0] - p[0]) * t, p[1] + (to[i][1] - p[1]) * t] as Point)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (isValidRoom(at(mid), others)) lo = mid
    else hi = mid
  }
  if (lo < 0.001) return null
  const reached = at(lo)
  // The bisection stops a hair short of contact. Contact usually sits on a
  // centimetre, so round toward where the move started and use that when
  // it is valid.
  const toward = (value: number, origin: number, step: number) =>
    (origin > value ? Math.ceil(value / step - 1e-9) : Math.floor(value / step + 1e-9)) * step
  const cm = reached.map(([x, y], i) => [toward(x, from[i][0], 0.01), toward(y, from[i][1], 0.01)] as Point)
  if (isValidRoom(cm, others)) return cm
  return reached.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as Point)
}

// Finds a spot for a copy of a polygon that does not touch any other, by
// stepping it out in rings around where it is. Returns the moved points, or
// null when even a wide search finds nothing free.
export function freePlacement(points: Point[], others: Point[][], gap = 0.2): Point[] | null {
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const stepX = Math.max(...xs) - Math.min(...xs) + gap
  const stepY = Math.max(...ys) - Math.min(...ys) + gap
  const moved = (dx: number, dy: number) => points.map(([x, y]) => [x + dx, y + dy] as Point)
  for (let ring = 1; ring <= 6; ring++) {
    for (let ox = -ring; ox <= ring; ox++) {
      for (let oy = -ring; oy <= ring; oy++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== ring) continue
        const target = moved(ox * stepX, oy * stepY)
        if (isValidRoom(target, others)) return target
      }
    }
  }
  return null
}
