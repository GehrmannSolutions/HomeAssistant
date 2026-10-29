import { EDITOR_GRID_M, EDITOR_SNAP_PX } from '#/constants.ts'
import type { Point, RoomConfig } from '#/types.ts'

// Screen mapping. `scale` is pixels per meter, `tx` and `ty` the screen
// position of the plan origin. Plan y grows upward, screen y downward.
export type View = { scale: number; tx: number; ty: number }

export const toScreen = (view: View, [x, y]: Point): Point => [x * view.scale + view.tx, -y * view.scale + view.ty]

export const toPlan = (view: View, [px, py]: Point): Point => [(px - view.tx) / view.scale, (view.ty - py) / view.scale]

export function fitView(rooms: RoomConfig[], width: number, height: number): View {
  const points = rooms.flatMap(room => room.points)
  if (points.length === 0) return { scale: 60, tx: width / 2, ty: height / 2 }
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((width * 0.85) / spanX, (height * 0.85) / spanY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 + cy * scale }
}

export function zoomAt(view: View, factor: number, [px, py]: Point): View {
  const scale = Math.min(Math.max(view.scale * factor, 5), 800)
  const k = scale / view.scale
  return { scale, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k }
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step

// Snaps a plan point to nearby vertices, then to their x or y lines, then to
// the grid. `ignore` skips one vertex so a dragged point does not snap to itself.
// `grid` is the grid step, finer while Shift is held.
export function snap(
  point: Point,
  view: View,
  rooms: RoomConfig[],
  ignore?: { roomId: string; index: number },
  extra: Point[] = [],
  grid = EDITOR_GRID_M,
): Point {
  const radius = EDITOR_SNAP_PX / view.scale
  const candidates: Point[] = [...extra]
  for (const room of rooms) {
    room.points.forEach((p, i) => {
      if (ignore && ignore.roomId === room.id && ignore.index === i) return
      candidates.push(p)
    })
  }

  let best: Point | null = null
  let bestDist = radius
  for (const c of candidates) {
    const d = Math.hypot(c[0] - point[0], c[1] - point[1])
    if (d < bestDist) {
      best = c
      bestDist = d
    }
  }
  if (best) return [best[0], best[1]]

  let x = roundTo(point[0], grid)
  let y = roundTo(point[1], grid)
  let dx = radius
  let dy = radius
  for (const c of candidates) {
    const ddx = Math.abs(c[0] - point[0])
    const ddy = Math.abs(c[1] - point[1])
    if (ddx < dx) {
      dx = ddx
      x = c[0]
    }
    if (ddy < dy) {
      dy = ddy
      y = c[1]
    }
  }
  return [x, y]
}

export const roomCenter = (points: Point[]): Point => [
  points.reduce((s, p) => s + p[0], 0) / points.length,
  points.reduce((s, p) => s + p[1], 0) / points.length,
]

export const round = (v: number) => Math.round(v * 1000) / 1000
