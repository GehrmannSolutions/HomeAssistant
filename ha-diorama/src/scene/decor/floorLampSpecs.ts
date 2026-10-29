// The measurements of the floor lamp styles, in meters, off Santa & Cole's
// technical drawings unless a note says otherwise. Heights are up from the
// floor. The models are drawn from these in FloorLamps.tsx.

export type FloorLampSpec = {
  // The lamp's width, depth and height as the style's sliders start them,
  // which is its real size to the centimeter the panel shows.
  size: number
  depth: number
  height: number
  // How far the lamp's own middle sits from the middle of its footprint
  // along x, for a lamp whose shade reaches out past its foot.
  offset: number
  // Where the light comes from, before the lamp is moved by its offset.
  glow: [number, number, number]
  // How much shorter and shallower the lamp can get, and how much of its
  // added height the light rises by.
  shrink: number
  thin: number
  rise: number
}

// TMM: 166 cm to the top of the mast, on a cross foot 50 cm across, with a
// Ø30 shade hung off one side of the mast. The plan's 60 cm runs from the
// end of a leg to the far side of the shade. The shade's 20 cm is drawn at
// 19.5, so it keeps the stated height around the drawn middle.
export const TMM_TOP = 1.66
export const TMM_MAST = 0.032
// The mast is square up to here and round above, where the shade slides.
export const TMM_SQUARE_TOP = 0.835
// The four legs are boards on edge, with a foot at each end and the edge
// cut back between them.
export const TMM_LEG: [number, number, number] = [0.25, 0.052, 0.013]
export const TMM_FOOT: [number, number] = [0.05, 0.006]
export const TMM_SHADE_R = 0.15
export const TMM_SHADE: [number, number] = [1.24, 1.44]
// The shade's near side is 4.8 cm out from the middle of the mast.
export const TMM_SHADE_X = 0.198
// A ring round the mast at the top and bottom of the shade holds it on.
export const TMM_RING_R = 0.021
export const TMM_RING_H = 0.007
// The bracket inside the shade reaches its middle, where the bulb stands
// and the cable drops from. The drawing has them 9 cm out, by the near side
// of the shade, but a bulb seen there through the top looked out of place.
export const TMM_BULB_X = TMM_SHADE_X
export const TMM_BRACKET: [number, number] = [TMM_BULB_X, 0.022]

// FAD: the drawing gives 120 to 150 cm for the adjustable one and is drawn
// at 120, which is its size here. The foot is 49 cm across, the shade Ø42
// at the top and Ø45 at the bottom, 24 cm tall. The plan's Ø45 is the
// bottom of the shade seen from above.
export const FAD_TOP = 1.2
export const FAD_SHADE: [number, number] = [0.96, 1.2]
export const FAD_SHADE_R: [number, number] = [0.21, 0.225]
// The column is a Ø5 oak cylinder split into four by a cross of slots that
// run down it, closed by solid blocks at the top, the middle and the foot.
export const FAD_COLUMN_R = 0.025
export const FAD_COLUMN_TOP = 0.847
export const FAD_SLOT = 0.017
export const FAD_BLOCKS: [number, number][] = [
  [0, 0.1],
  [0.401, 0.447],
  [0.783, 0.847],
]
// The steel rod the shade stands on slides out of the column. At the
// lowest setting it reaches down to here inside it.
export const FAD_ROD_R = 0.0055
export const FAD_ROD_FOOT = 0.546
// The legs, 12 mm boards through the slots, and their feet.
export const FAD_LEG: [number, number, number] = [0.245, 0.055, 0.012]
export const FAD_FOOT: [number, number] = [0.05, 0.008]
// The holder the bulb sits in. Not in the drawing, so it is placed in the
// shade the way the photos show it.
export const FAD_HOLDER: [number, number] = [1.0, 1.05]

// Lámina 165: a black rod 187.5 cm tall on a Ø21 base, and a curved
// aluminium sheet 9 cm across and 168.6 cm tall behind it. The drawing puts
// its 187.5 tick at the top of the sheet, but it only measures right to the
// top of the rod, which is where it is taken to.
export const LAMINA_TOP = 1.875
export const LAMINA_BASE_R = 0.105
export const LAMINA_BASE_H = 0.045
export const LAMINA_BASE_BEVEL = 0.01
export const LAMINA_ROD_R = 0.0095
export const LAMINA_COLLAR: [number, number] = [0.0165, 0.002]
// The sheet is a round arc about the rod, 5 cm across its radius, its deepest
// point 4.7 cm behind the rod's middle.
export const LAMINA_SHEET: [number, number] = [0.133, 1.819]
export const LAMINA_SHEET_R = 0.05
export const LAMINA_SHEET_W = 0.09
export const LAMINA_SHEET_BACK = 0.047
// The LED down the back of the rod, facing the sheet. Its width is off the
// photos.
export const LAMINA_LED_W = 0.008
// The dimmer on the base, in front of the rod. Its height is off the photos.
export const LAMINA_KNOB: [number, number, number] = [0.054, 0.01, 0.005]
// The two arms that hold the sheet off the rod, 2 cm wide in the plan. The
// drawing hides them behind the rod, so their heights are off the photos.
export const LAMINA_ARM_W = 0.02
export const LAMINA_ARMS = [0.15, 1.8]

export const FLOOR_LAMPS: Record<string, FloorLampSpec> = {
  tmm: {
    size: 0.6,
    depth: 0.5,
    height: TMM_TOP,
    offset: 0.049,
    glow: [TMM_BULB_X, 1.32, 0],
    shrink: 0.35,
    thin: 0.3,
    rise: 1,
  },
  fad: { size: 0.49, depth: 0.49, height: FAD_TOP, offset: 0, glow: [0, 1.08, 0], shrink: 0.1, thin: 0.3, rise: 1 },
  lamina: { size: 0.21, depth: 0.21, height: 1.88, offset: 0, glow: [0, 0.976, 0.004], shrink: 1, thin: 0, rise: 0.5 },
}
