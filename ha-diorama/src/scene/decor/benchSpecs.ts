// The measurements of the bench styles, in meters. Pilma gives each bench's
// length, depth and height and nothing else, so the parts below are off the
// product photos, scaled by those. Each bench faces +z and is laid out again
// at the length, depth and height the sliders give it, so its legs and
// boards keep their thickness. The models are in Benches.tsx.

export type BenchSpec = {
  // The bench's real length, depth and seat height, which the sliders start
  // at.
  width: number
  depth: number
  height: number
}

// Lauta 130: the Lauta stool drawn out long, an oak frame of four round
// legs splayed a little, with a woven paper cord seat. The stated length and
// depth are across the feet. Flat rails tie the legs low down along the
// front and back, where a dowel joins them in the middle, and higher up at
// the ends.
// How far in from the ends and the sides the legs' middles are at the seat
// and at the floor, and their radius at each.
export const LAUTA_BENCH_LEG_TOP: [number, number] = [0.05, 0.035]
export const LAUTA_BENCH_LEG_FOOT: [number, number] = [0.013, 0.015]
export const LAUTA_BENCH_LEG_R: [number, number] = [0.016, 0.013]
// The seat's thickness.
export const LAUTA_BENCH_SEAT = 0.05
// The long rails' and the end rails' heights, and the rails' height and
// thickness.
export const LAUTA_BENCH_RAIL: [number, number, number, number] = [0.13, 0.32, 0.035, 0.02]

// Angle 170: recycled teak boards, a top that turns down at both ends into
// solid sides, with a lacquered steel case of three drawers hung under the
// top between them.
// The boards' thickness.
export const ANGLE_BOARD = 0.03
// The drawer case: its height under the top, how far its fronts stand back
// from the top's front edge and its back from the top's back edge, the gap
// between the fronts, the fronts' thickness, and how many drawers.
export const ANGLE_DRAWERS = { height: 0.13, front: 0.01, back: 0.03, gap: 0.004, thick: 0.015, count: 3 }

export const BENCHES: Record<string, BenchSpec> = {
  lauta: { width: 1.3, depth: 0.42, height: 0.44 },
  angle: { width: 1.7, depth: 0.49, height: 0.45 },
}
