// The measurements of the wall lamp styles, in meters, off Santa & Cole's
// technical drawings unless a note says otherwise. Each lamp is drawn out
// from the wall along z, with y up from the lamp's own middle, which is the
// height it is hung at. The models are drawn from these in WallLamps.tsx.

export type WallLampSpec = {
  // The lamp's width, how far it stands out from the wall and its height, as
  // the style's sliders start them, which is its real size to the
  // centimeter the panel shows.
  size: number
  depth: number
  height: number
  // Where the light comes from.
  glow: [number, number, number]
  // How much shorter and shallower the lamp can get, and how much of its
  // added height and depth the light moves by.
  shrink: number
  thin: number
  rise: number
  reach: number
}

// TMM corto with plug: a beech channel 20 cm tall and 5 cm wide on the wall,
// and a Ø20 parchment shade 16 cm tall in front of it, 23 cm out in all. The
// drawing draws the channel about 3.5 deep, but the stated 23 less the
// shade's 20 leaves 3, which is taken.
export const TMM_PLATE: [number, number, number] = [0.05, 0.2, 0.03]
// The channel is a U: a back and two rails 6 mm thick.
export const TMM_RAIL = 0.006
// Two square blocks 1 cm across at the front of the channel hold the shade.
export const TMM_BLOCK = 0.01
export const TMM_SHADE_R = 0.1
export const TMM_SHADE_H = 0.16
export const TMM_SHADE_T = 0.0015

// Singular: a white linen shade 30 cm tall, 18 cm wide and 15 cm out, a U of
// straight sides 6 cm long and a half circle, open at the top and bottom. It
// hangs off a 10 cm square plate on a chrome holder.
export const SINGULAR_SHADE: [number, number, number] = [0.18, 0.3, 0.15]
export const SINGULAR_SIDE = 0.06
export const SINGULAR_SHADE_T = 0.0045
export const SINGULAR_PLATE: [number, number] = [0.1, 0.003]
// The plate runs from 1.7 to 11.7 cm above the bottom of the shade.
export const SINGULAR_PLATE_Y = -0.083
// The lamp holder, a ring Ø6 5.6 cm out on a stem 1.6 cm wide, level with
// the middle of the plate. Two struts run from it back to the shade's edges.
export const SINGULAR_RING_Z = 0.056
export const SINGULAR_RING_R: [number, number, number] = [0.03, 0.026, 0.021]
export const SINGULAR_STEM_W = 0.016
export const SINGULAR_STRUT_R = 0.0015

// Wally Cestita: the table Cestita's Ø18 opal globe on a black steel plate
// 24 cm tall and 3 cm wide, 22 cm out. A band holds the globe at its waist
// and an arm under it carries the disc it stands on.
export const WALLY_PLATE: [number, number, number] = [0.03, 0.24, 0.0186]
// The globe's middle is 13 cm out, and its foot 7.5 cm below the lamp's
// middle.
export const WALLY_GLOBE_Z = 0.13
export const WALLY_GLOBE_BOTTOM = -0.0746
export const WALLY_GLOBE_R = 0.09
export const WALLY_BAND: [number, number, number] = [0.0915, 0.0306, 0.02]
export const WALLY_BAND_T = 0.0015
// The piece between the plate and the band.
export const WALLY_NECK: [number, number] = [0.014, 0.04]
export const WALLY_DISC: [number, number] = [0.045, 0.0072]
// The arm under the disc, 1.46 cm thick and out to 17 cm. Its width is off
// the photos.
export const WALLY_ARM: [number, number, number] = [0.03, 0.0146, 0.17]

export const WALL_LAMPS: Record<string, WallLampSpec> = {
  tmm: { size: 0.2, depth: 0.23, height: 0.2, glow: [0, 0, 0.13], shrink: 0.08, thin: 0.018, rise: 0, reach: 1 },
  singular: {
    size: 0.18,
    depth: 0.15,
    height: 0.3,
    glow: [0, -0.023, SINGULAR_RING_Z],
    shrink: 0.1,
    thin: 0.05,
    rise: -0.5,
    reach: 0,
  },
  wally: {
    size: 0.18,
    depth: 0.22,
    height: 0.24,
    glow: [0, 0.025, WALLY_GLOBE_Z],
    shrink: 0.06,
    thin: 0.02,
    rise: 0,
    reach: 1,
  },
}
