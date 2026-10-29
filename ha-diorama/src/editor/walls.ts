import { isValidRoom } from '#/geometry/overlap.ts'
import type { Point } from '#/types.ts'

// Nearest point on the polygon's outline, and the rotation that makes a
// wall item face into the room from there.
export function snapToWall(p: Point, points: Point[]): { point: Point; rotation: number } {
  const n = points.length
  let best = { dist: Infinity, point: p, rotation: 0 }
  const ccw = isValidRoom(points, []) && signedAreaOf(points) > 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const len2 = abx * abx + aby * aby || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2))
    const q: Point = [a[0] + abx * t, a[1] + aby * t]
    const dist = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (dist < best.dist) {
      // Inward normal: left of the edge on a counter clockwise polygon.
      const len = Math.sqrt(len2)
      const nx = ((ccw ? -aby : aby) / len) * 1
      const ny = ((ccw ? abx : -abx) / len) * 1
      // The wall model faces plan -y at rotation 0, so it faces the normal at angle(n) + 90.
      const rotation = ((((Math.atan2(ny, nx) * 180) / Math.PI + 90) % 360) + 360) % 360
      best = {
        dist,
        point: [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100],
        rotation: Math.round(rotation),
      }
    }
  }
  return best
}

function signedAreaOf(points: Point[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}
