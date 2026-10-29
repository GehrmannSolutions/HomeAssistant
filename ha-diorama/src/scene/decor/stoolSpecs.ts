// The measurements of the stool styles, in meters. Pilma gives each stool's
// width, depth and height and nothing else, so the parts below are off the
// product photos, scaled by those. Each stool faces +z and is laid out
// again at the size the sliders give it. Its height slider is the seat's
// height, which is what matters at a counter and what anything set on the
// stool stands on, and a back stands as high over the seat at any height.
// The models are in Stools.tsx.

export type StoolSpec = {
  // The stool's real width, depth and seat height, which the sliders start
  // at.
  width: number
  depth: number
  seat: number
}

// Lauta 65: an oak frame of round legs splayed a little, with a woven paper
// cord seat on it. Flat rails tie the legs under the seat at the sides and
// low down at the front and back, where a dowel joins them. It stands 68 cm
// to the top of its seat.
// Where the legs' middles are at the seat and at the floor, their radius at
// each, and the seat's thickness.
export const LAUTA_LEG_TOP: [number, number] = [0.195, 0.135]
export const LAUTA_LEG_FOOT: [number, number] = [0.21, 0.155]
export const LAUTA_LEG_R: [number, number] = [0.016, 0.013]
export const LAUTA_SEAT = 0.07
// The low rails' height above the floor, their height and thickness.
export const LAUTA_RAIL: [number, number, number] = [0.22, 0.035, 0.02]

// Dean 90: a teak frame with a woven rattan seat 65 cm up and a back up to
// 90 cm, an open weave framed by wrapped bands. The rear legs run on up into
// the posts that hold it. Round stretchers tie the legs low down.
export const DEAN_TOP = 0.9
export const DEAN_LEG_R: [number, number] = [0.014, 0.017]
export const DEAN_SEAT = 0.06
// The back's bands: the top one's and the bottom one's middle heights and
// their heights. The weave between them is cord on a 2.2 cm grid.
export const DEAN_BAND: [number, number, number, number] = [0.865, 0.735, 0.045, 0.03]
export const DEAN_WEAVE = 0.022
// The stretchers' heights, front and back and at the sides.
export const DEAN_STRETCHER: [number, number] = [0.18, 0.22]

// Keula 65: an oak frame whose rear legs rise past the seat into a
// horseshoe back, one piece with a broad crest bent round in plan. A thin
// leather seat sits on rails, and dowels tie the legs low down. Pilma gives
// its height as 65 cm, which is the seat. The back's height, 93 cm, is off
// the photos.
export const KEULA_TOP = 0.93
export const KEULA_LEG_R: [number, number] = [0.013, 0.02]
export const KEULA_PAD = 0.035
// The back: its half width, the posts' width and thickness, the crest's
// height, the outer corners' radius, how far the crest bows back in the
// middle and how far the back leans.
export const KEULA_BACK = { half: 0.215, post: 0.036, thick: 0.03, crest: 0.06, corner: 0.12, bow: 0.04, lean: 0.1 }

export const STOOLS: Record<string, StoolSpec> = {
  lauta: { width: 0.45, depth: 0.35, seat: 0.68 },
  dean: { width: 0.47, depth: 0.51, seat: 0.65 },
  keula: { width: 0.45, depth: 0.54, seat: 0.65 },
}
