import type { Point } from '#/types.ts'
import { Shape } from 'three'

export function signedArea(points: Point[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

export function ensureCounterClockwise(points: Point[]): Point[] {
  return signedArea(points) < 0 ? [...points].reverse() : points
}

export function centroid(points: Point[]): Point {
  let x = 0
  let y = 0
  for (const [px, py] of points) {
    x += px
    y += py
  }
  return [x / points.length, y / points.length]
}

// Moves every edge inward by `distance` and intersects neighbouring edges.
// Expects a counter clockwise simple polygon. Falls back to the original
// polygon when the inset would collapse it.
export function inset(points: Point[], distance: number): Point[] {
  if (distance <= 0 || points.length < 3) return points
  const n = points.length
  const lines: { px: number; py: number; dx: number; dy: number }[] = []

  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1
    // Inward normal of a counter clockwise edge is the edge direction rotated left.
    const nx = -dy / len
    const ny = dx / len
    lines.push({ px: x1 + nx * distance, py: y1 + ny * distance, dx, dy })
  }

  const result: Point[] = []
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n]
    const b = lines[i]
    const cross = a.dx * b.dy - a.dy * b.dx
    if (Math.abs(cross) < 1e-9) {
      result.push([b.px, b.py])
      continue
    }
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cross
    result.push([a.px + a.dx * t, a.py + a.dy * t])
  }

  return signedArea(result) > 0 ? result : points
}

// Builds a closed shape whose corners are rounded with quadratic curves.
// Expects a counter clockwise polygon. Convex corners use `radius` and
// concave ones `concaveRadius`, each clamped to half of the shortest adjacent
// edge. A corner `square` says yes to is left as it is.
export function roundedShape(
  points: Point[],
  radius: number,
  concaveRadius = radius,
  square?: (index: number) => boolean,
): Shape {
  const shape = new Shape()
  const n = points.length
  if (n < 3) return shape

  const corner = (i: number) => {
    const [px, py] = points[(i - 1 + n) % n]
    const [cx, cy] = points[i]
    const [nx, ny] = points[(i + 1) % n]
    const inLen = Math.hypot(cx - px, cy - py)
    const outLen = Math.hypot(nx - cx, ny - cy)
    // A right turn on a counter clockwise polygon is a concave corner.
    const concave = (cx - px) * (ny - cy) - (cy - py) * (nx - cx) < 0
    const r = square?.(i) ? 0 : Math.min(concave ? concaveRadius : radius, inLen / 2, outLen / 2)
    const start: Point = [cx + ((px - cx) / inLen) * r, cy + ((py - cy) / inLen) * r]
    const end: Point = [cx + ((nx - cx) / outLen) * r, cy + ((ny - cy) / outLen) * r]
    return { start, end, cx, cy }
  }

  const first = corner(0)
  shape.moveTo(first.start[0], first.start[1])
  for (let i = 0; i < n; i++) {
    const c = corner(i)
    shape.lineTo(c.start[0], c.start[1])
    shape.quadraticCurveTo(c.cx, c.cy, c.end[0], c.end[1])
  }
  shape.closePath()
  return shape
}
