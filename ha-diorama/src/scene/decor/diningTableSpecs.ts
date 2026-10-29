// The measurements of the dining table styles, in meters. Pilma gives each
// table's length, depth and height and nothing else, so the sections below
// are off the product photos, scaled by those. The width, depth and height
// sliders lay the table out again rather than stretch it, so the legs and
// the top keep their thickness at any size. The models are in
// DiningTables.tsx.

// New Viok 160: a 2 cm natural oak top, its underside chamfered, on four
// lacquered steel angles at the corners. Each angle is two plates that
// narrow toward the floor, and a steel rail runs under each long side.
export const VIOK_TOP = 0.02
export const VIOK_TOP_EDGE = 0.009
export const VIOK_CHAMFER = 0.02
export const VIOK_PLATE = 0.004
// How wide each plate of an angle is at the top and at the floor.
export const VIOK_LEG: [number, number] = [0.07, 0.045]
// The rail, how tall and thick, and how far in from the long edge.
export const VIOK_RAIL: [number, number, number] = [0.045, 0.02, 0.03]

// Deva 180: a cream porcelain top 1.2 cm thick with rounded corners, laid in
// a solid teak frame, on four teak legs flush with its corners. Each leg is
// 7 cm square with its outer corner rounded as the top's is.
export const DEVA_TOP = 0.012
export const DEVA_CORNER = 0.05
// The teak frame under the porcelain, its band all the way round and the
// apron set in under it.
export const DEVA_BAND = 0.02
export const DEVA_APRON: [number, number] = [0.03, 0.02]
export const DEVA_LEG = 0.07

// Spider 200: a 3 cm recycled teak top with a chamfered underside, on two
// trestles of 4 cm square teak. At each end a straight leg stands under one
// long edge, and a leaning leg and a long brace run from the top down to a
// shared foot under the other. The far end is the near one turned half
// round, which is what gives the table its name.
export const SPIDER_TOP = 0.03
export const SPIDER_TOP_EDGE = 0.012
export const SPIDER_CHAMFER = 0.035
export const SPIDER_MEMBER = 0.04
// How far the trestles stand in from the ends and the legs from the long
// edges.
export const SPIDER_INSET: [number, number] = [0.12, 0.08]
// Where the leaning leg meets the top, as a share of the depth from the
// middle toward the straight leg, and how far in along the length the brace
// meets the top.
export const SPIDER_LEAN = 0.35
export const SPIDER_BRACE = 0.3
