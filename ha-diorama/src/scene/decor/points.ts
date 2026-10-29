export type Vec3 = [number, number, number]

// Where the line from `a` to `b` crosses height `y`, for setting a
// stretcher between two splayed legs.
export function atHeight(a: Vec3, b: Vec3, y: number): Vec3 {
  const t = (y - a[1]) / (b[1] - a[1])
  return [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t]
}
