import { SEG } from '#/scene/decor/parts.tsx'
import {
  CESTITA_GLOBE,
  CESTITA_GLOBE_BOTTOM_R,
  CESTITA_GLOBE_N,
  CESTITA_GLOBE_R,
  CESTITA_GLOBE_TOP_R,
} from '#/scene/decor/tableLampSpecs.ts'

// The Cesta opal globe, as a lathe profile up from the table lamp's table.
// The table Cestita and the Wally Cestita wall lamp share it.
export function cestitaGlobeProfile(): [number, number][] {
  const [yBottom, yTop] = CESTITA_GLOBE
  const yc = (yTop + yBottom) / 2
  const n = CESTITA_GLOBE_N
  const e = 2 / n
  const a = CESTITA_GLOBE_R
  // A superellipse cut flat at both poles, so its half height reaches a
  // little past them.
  const cut = (r: number) => Math.pow(1 - Math.pow(r / a, n), 1 / n)
  const b = (yTop - yBottom) / (cut(CESTITA_GLOBE_TOP_R) + cut(CESTITA_GLOBE_BOTTOM_R))
  const points: [number, number][] = [
    [0, yBottom],
    [CESTITA_GLOBE_BOTTOM_R, yBottom],
  ]
  const steps = SEG * 4
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI / 2 + (i / steps) * Math.PI
    const x = a * Math.pow(Math.cos(t), e)
    const y = yc + b * Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), e)
    if (y <= yBottom || y >= yTop) continue
    if (y < yc && x < CESTITA_GLOBE_BOTTOM_R) continue
    if (y > yc && x < CESTITA_GLOBE_TOP_R) continue
    points.push([x, y])
  }
  points.push([CESTITA_GLOBE_TOP_R, yTop], [0, yTop])
  return points
}
