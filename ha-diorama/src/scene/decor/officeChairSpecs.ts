// The measurements of the office chair styles, in meters. Pilma gives each
// chair's width, depth and height and nothing else, so the parts below and
// the seat heights are off the product photos, scaled by those. Each chair
// faces +z, with its seat at the height in the photos. The width and depth
// sliders lay it out again wider or deeper, every part keeping its
// thickness, and the seat height slider works as the gas lift does: the
// seat and everything on it ride up or down on the column while the base
// stays on the floor. The models are in OfficeChairs.tsx.

export type OfficeChairSpec = {
  // The chair's real width, depth and height, and its seat's height in the
  // photos, which the sliders start at.
  width: number
  depth: number
  height: number
  seat: number
}

// A five star base: how far out each castor stands from the column, the
// castors' wheel radius, the height of the hub the legs leave and of their
// tips.
export type Star = { reach: number; wheel: number; hub: number; tip: number }

// Teck: a task chair with a black mesh back in a tapered frame, a padded
// seat on a black mechanism, T arms on a polished aluminum loop that runs
// round behind the seat and holds the back, on a flat five star base.
export const TECK_STAR: Star = { reach: 0.3, wheel: 0.028, hub: 0.13, tip: 0.085 }
// The seat cushion's width, thickness and depth.
export const TECK_SEAT: [number, number, number] = [0.5, 0.085, 0.48]
// The back's foot and head widths, where its foot stands, how far it leans,
// the frame's depth and the width of its bars.
export const TECK_BACK = { foot: 0.4, head: 0.46, y: 0.515, z: -0.25, lean: 0.12, thick: 0.03, bar: 0.022 }
// The arm pads' height, how far out they stand, and their size.
export const TECK_ARM = { y: 0.63, x: 0.265, pad: [0.08, 0.025, 0.25] as [number, number, number] }

// Sling: after the Vitra Aluminium Chair EA 117. A single sling of ribbed
// leather pads runs from the front of the seat up the back between two
// cast aluminum side rails, with arms off the rails, on a polished five
// star base. The side profile the rails follow, as height and depth pairs.
export const SLING_STAR: Star = { reach: 0.3, wheel: 0.025, hub: 0.12, tip: 0.07 }
export const SLING_PATH: [number, number][] = [
  [0.47, 0.25],
  [0.445, 0.2],
  [0.435, 0.02],
  [0.44, -0.13],
  [0.49, -0.21],
  [0.64, -0.255],
  [0.8, -0.275],
  [0.96, -0.285],
]
export const SLING_HALF = 0.24

// Racer: a gaming chair after the racing bucket seats, 70 by 68 cm and
// 132 cm tall. Its seat's top, and how far the back leans.
export const RACER_STAR: Star = { reach: 0.34, wheel: 0.032, hub: 0.13, tip: 0.08 }
export const RACER = { seat: 0.48, lean: 0.2 }

export const OFFICE_CHAIRS: Record<string, OfficeChairSpec> = {
  teck: { width: 0.66, depth: 0.66, height: 0.99, seat: 0.49 },
  sling: { width: 0.58, depth: 0.6, height: 0.98, seat: 0.46 },
  racer: { width: 0.7, depth: 0.68, height: 1.32, seat: 0.48 },
}
