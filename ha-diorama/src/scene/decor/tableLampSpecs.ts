// The measurements of the table lamp styles, in meters, off Santa & Cole's
// technical drawings unless a note says otherwise. Heights are up from the
// table. The models are drawn from these in TableLamps.tsx.

export type TableLampSpec = {
  // The lamp's width and height as the style's sliders start them, which is
  // its real size to the centimeter the panel shows.
  size: number
  height: number
  // How high the light comes from.
  glow: number
  // How much shorter the part that lengthens with the height can get, and
  // how much of that lengthening the light rises by.
  shrink: number
  rise: number
}

// Cestita: 22 cm across its four posts and 36 cm to the top of the handle.
// The drawing's 29 cm tick matches nothing standing up, so it is taken to be
// the height with the handle folded down.
export const CESTITA_POST: [number, number] = [0.0104, 0.011]
export const CESTITA_POST_R = 0.1048
export const CESTITA_TALL_POST = 0.25
export const CESTITA_SHORT_POST = 0.195
// The bent wood: the ring the globe sits in, the handle and the two arches
// of the foot are all strips two centimeters wide.
export const CESTITA_STRIP_W = 0.02
export const CESTITA_RING: [number, number] = [0.165, 0.1846]
export const CESTITA_RING_R = 0.0996
export const CESTITA_RING_T = 0.005
export const CESTITA_HANDLE_T = 0.0054
export const CESTITA_HANDLE_TOP = 0.36
export const CESTITA_HANDLE_FOOT = 0.22
export const CESTITA_PIVOT_Y = 0.235
export const CESTITA_ARCH_T = 0.006
// The arches start on a post 1.5 cm off the table, bend in round a 2.2 cm
// radius and slope up to a flat 7 cm crossing under the globe, its top 8.9 cm
// up. The run is the flat half width and the slope's rise over its run.
export const CESTITA_ARCH_FOOT = 0.015
export const CESTITA_ARCH_BEND = 0.022
export const CESTITA_ARCH_RUN: [number, number] = [0.035, 0.23]
export const CESTITA_ARCH_TOP = 0.089
// The opal globe, a flattened ball with flat poles.
export const CESTITA_GLOBE: [number, number] = [0.089, 0.284]
export const CESTITA_GLOBE_R = 0.0891
export const CESTITA_GLOBE_TOP_R = 0.0363
export const CESTITA_GLOBE_BOTTOM_R = 0.036
export const CESTITA_GLOBE_N = 2.8
export const CESTITA_CAP: [number, number, number] = [0.0268, 0.284, 0.287]
export const CESTITA_NECK: [number, number, number] = [0.036, 0.085, 0.089]
export const CESTITA_HOLDER: [number, number, number] = [0.0107, 0.038, 0.085]

// Sylvestrina: a Ø12.7 disc on a Ø11.3 foot, with a Ø3.8 glass tube 35.5 cm
// to the top. The drawing's 33 cm runs from the top of the disc.
export const SYLVESTRINA_FOOT: [number, number] = [0.0565, 0.011]
export const SYLVESTRINA_DISC: [number, number] = [0.0635, 0.025]
export const SYLVESTRINA_DISC_EDGE = 0.0065
export const SYLVESTRINA_TUBE_R = 0.019
export const SYLVESTRINA_SLEEVE_TOP = 0.073
export const SYLVESTRINA_TOP = 0.355
// The white diffuser inside the tube, standing on the black sleeve.
export const SYLVESTRINA_DIFFUSER: [number, number] = [0.015, 0.203]

// Maija 15: fourteen stacked metal rings, each flaring from Ø12 to Ø15, on
// three brass feet, 33 cm tall. The drawing's Ø18 is the width across the
// feet seen from the side. From above they stand in a Ø20.8 circle, which is
// the lamp's size here.
export const MAIJA_RINGS = 14
export const MAIJA_SHADE: [number, number] = [0.06, 0.33]
export const MAIJA_RING_TOP_R = 0.0603
export const MAIJA_RING_BOTTOM_R = 0.075
export const MAIJA_PIN_R = 0.053
export const MAIJA_SLOT: [number, number] = [0.0405, 0.0435]
export const MAIJA_ROD_R = 0.00315
export const MAIJA_BALL_R = 0.0045
export const MAIJA_KNEE_Y = 0.04
export const MAIJA_FOOT_R = 0.0994
// The methacrylate diffuser is not in the drawing: sized off the photos.
export const MAIJA_DIFFUSER: [number, number, number] = [0.045, 0.1, 0.3]

// Básica Mínima: a Ø8.5 bronze disc, a Ø3 birch column with a bronze sleeve
// at its foot, and a Ø12 to Ø10 parchment shade, 30 cm tall. The drawing is
// not to scale across, so the widths are the stated ones and the heights are
// measured off it. The stitch spacing is counted off the photos.
export const BASICA_DISC: [number, number] = [0.0425, 0.0025]
export const BASICA_COLUMN_R = 0.015
export const BASICA_SLEEVE_TOP = 0.052
export const BASICA_COLUMN_TOP = 0.181
export const BASICA_SHADE: [number, number] = [0.18, 0.3]
export const BASICA_SHADE_R: [number, number] = [0.06, 0.05]
export const BASICA_STITCH = 0.01

// Hue Iris: 18.8 cm wide, 19.4 cm tall and 20.4 cm deep, from Philips'
// stated size. The disc is tilted back so its face looks up into the room,
// and the parts in it are measured off the product photos: an opal dome in
// a ring of frosted glass, a white shell behind them and a small round
// foot under its lower edge.
export const IRIS_R = 0.094
export const IRIS_THICK = 0.032
export const IRIS_DOME_R = 0.064
export const IRIS_TILT = (34 * Math.PI) / 180
export const IRIS_FOOT: [number, number] = [0.045, 0.012]
export const IRIS_CENTER = 0.1

export const TABLE_LAMPS: Record<string, TableLampSpec> = {
  cestita: { size: 0.22, height: 0.36, glow: 0.186, shrink: 0.07, rise: 0 },
  sylvestrina: { size: 0.13, height: 0.36, glow: 0.138, shrink: 0.1, rise: 0.5 },
  maija: { size: 0.21, height: 0.33, glow: 0.195, shrink: 0.04, rise: 1 },
  basica_minima: { size: 0.12, height: 0.3, glow: 0.235, shrink: 0.1, rise: 1 },
  iris: { size: 0.188, height: 0.194, glow: 0.11, shrink: 0.04, rise: 1 },
}
