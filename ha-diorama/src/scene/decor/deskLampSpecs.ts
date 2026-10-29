// The measurements of the desk lamp styles, in meters, up from the desk.
// Both are classics with no one drawing to go by, so they are sized off the
// usual catalog figures. The models are drawn from these in DeskLamps.tsx.

export type DeskLampSpec = {
  // The lamp's width and height as the style's sliders start them. A desk
  // lamp reaches out over the desk, so its size is the square it stands in.
  size: number
  height: number
  // Where the light comes from: how high, and how far in front of the
  // middle of that square.
  glow: [number, number]
  // How much shorter the part that lengthens with the height can get, and
  // how far the light moves up and forward for each meter it lengthens.
  shrink: number
  rise: [number, number]
}

// The balanced arm lamp, after the Anglepoise 1227: a stepped round foot, a
// lower arm of two rods on springs leaning back from it, an upper arm
// reaching forward and a cone of a shade hanging off its end.
export const ARM_FOOT: [number, number] = [0.075, 0.02]
export const ARM_FOOT_STEP: [number, number] = [0.05, 0.012]
// The middle of the foot, behind the middle of the square, so the shade
// ends over its front.
export const ARM_FOOT_Z = -0.13
export const ARM_PIVOT_Y = 0.045
export const ARM_LOWER = 0.28
export const ARM_LOWER_LEAN = (12 * Math.PI) / 180
export const ARM_UPPER = 0.26
export const ARM_UPPER_TILT = (72 * Math.PI) / 180
// The two rods of each arm stand this far apart, and the springs outside
// them run from the foot up most of the lower arm.
export const ARM_ROD_GAP = 0.024
export const ARM_ROD_R = 0.0035
export const ARM_SPRING_R = 0.006
export const ARM_SPRING_RUN: [number, number] = [0.04, 0.6]
export const ARM_KNUCKLE_R = 0.012
// The shade points down and a little forward off the end of the upper arm:
// a cone from a small neck to its open mouth, under a rounded cap.
export const ARM_SHADE_TILT = (25 * Math.PI) / 180
export const ARM_SHADE: [number, number, number] = [0.022, 0.07, 0.13]
export const ARM_CAP_R = 0.026
export const ARM_BULB: [number, number] = [0.06, 0.022]

// The banker's lamp: a brass foot and stem holding a long half round shade
// of green cased glass, white inside, with a pull chain under it.
export const BANKER_FOOT: [number, number, number] = [0.2, 0.025, 0.13]
export const BANKER_FOOT_Z = -0.03
export const BANKER_STEM_R = 0.008
export const BANKER_STEM_Z = -0.06
export const BANKER_STEM_TOP = 0.3
// The shade's length, radius and glass, and where its middle is.
export const BANKER_SHADE: [number, number, number] = [0.27, 0.068, 0.004]
export const BANKER_SHADE_AT: [number, number] = [0.33, 0.015]
export const BANKER_SHADE_TILT = (14 * Math.PI) / 180
export const BANKER_CHAIN = 0.09

export const DESK_LAMPS: Record<string, DeskLampSpec> = {
  // The light sits in the shade, on the axis a little in from the mouth.
  balanced_arm: {
    size: 0.4,
    height: 0.43,
    glow: [
      ARM_PIVOT_Y +
        ARM_LOWER * Math.cos(ARM_LOWER_LEAN) +
        ARM_UPPER * Math.cos(ARM_UPPER_TILT) -
        ARM_BULB[0] * Math.cos(ARM_SHADE_TILT),
      ARM_FOOT_Z -
        ARM_LOWER * Math.sin(ARM_LOWER_LEAN) +
        ARM_UPPER * Math.sin(ARM_UPPER_TILT) +
        ARM_BULB[0] * Math.sin(ARM_SHADE_TILT),
    ],
    shrink: 0.12,
    // A longer lower arm lifts the head and leans it back with it.
    rise: [Math.cos(ARM_LOWER_LEAN), -Math.sin(ARM_LOWER_LEAN)],
  },
  banker: {
    size: 0.28,
    height: 0.41,
    glow: [BANKER_SHADE_AT[0] - 0.02, BANKER_SHADE_AT[1]],
    shrink: 0.12,
    rise: [1, 0],
  },
}
