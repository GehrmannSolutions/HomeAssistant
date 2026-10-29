import type { Hole } from '#/scene/decor/parts.tsx'

// How each sink style lays out over the worktop, shared by the sink that
// draws it and the counter that cuts the holes it sits in. Everything is in
// the sink's own frame, with y 0 the top of the worktop and the front +z.

export type SinkStyle = 'undermount' | 'belfast' | 'inset'

// One bowl: its opening at the worktop and how deep it goes.
export type Bowl = { x: number; z: number; w: number; d: number; r: number; depth: number }

export type SinkPlan = {
  style: SinkStyle
  // How thick the bowl's walls are.
  wall: number
  bowls: Bowl[]
  // Where the tap stands.
  tap: [number, number]
  // The holes the counter cuts, through the worktop and through the units.
  worktop: Hole[]
  carcass: Hole[]
}

export function sinkStyle(id: string | undefined): SinkStyle {
  return id === 'belfast' || id === 'inset' ? id : 'undermount'
}

const opening = (b: Bowl, grow: number): Hole => ({
  x: b.x,
  z: b.z,
  w: b.w + grow * 2,
  d: b.d + grow * 2,
  r: b.r + grow,
})

export function sinkPlan(style: SinkStyle, w: number, d: number): SinkPlan {
  switch (style) {
    case 'belfast': {
      // A fireclay butler sink after the Villeroy & Boch Butler 60, about 60
      // cm wide and 22 deep, with walls about 3.5 cm thick. Its top stands a
      // little over the worktop, and set forward its front shows below it.
      const wall = Math.min(0.035, w * 0.08, d * 0.08)
      const bowl = { x: 0, z: 0, w: w - wall * 2, d: d - wall * 2, r: 0.03, depth: 0.2 }
      return {
        style,
        wall,
        bowls: [bowl],
        tap: [0, -d / 2 - 0.05],
        worktop: [opening(bowl, wall / 2)],
        carcass: [opening(bowl, wall / 2)],
      }
    }
    case 'inset': {
      // A composite sink with a drainer after the Blanco Metra XL 6 S, 100 by
      // 50 cm: a flat rim on the worktop, a round cornered bowl on the left
      // and a ribbed drainer on the right. Below 75 cm wide it is the bowl on
      // its own.
      const wall = 0.012
      const rim = Math.min(0.05, w * 0.08)
      const back = Math.min(0.07, d * 0.14)
      const drainer = w >= 0.75
      const bw = drainer ? Math.min(0.46, (w - rim * 3) * 0.55) : w - rim * 2
      const bd = d - rim - back
      const bowl = {
        x: drainer ? -w / 2 + rim + bw / 2 : 0,
        z: (back - rim) / 2,
        w: bw,
        d: bd,
        r: Math.min(0.06, bw * 0.15),
        depth: 0.19,
      }
      return {
        style,
        wall,
        bowls: [bowl],
        tap: [bowl.x + bw / 2 - Math.min(0.05, bw * 0.15), -d / 2 + back / 2],
        worktop: [opening(bowl, wall / 2)],
        carcass: [opening(bowl, wall / 2)],
      }
    }
    default: {
      // A steel undermount bowl after the Blanco Andano 500-U, 54 by 44 cm
      // outside, with tight 10 mm corners. From 80 cm wide it is a bowl and a
      // half, and the tap stands on the worktop behind.
      const wall = 0.012
      const inner = w - wall * 2
      const bowls: Bowl[] =
        w >= 0.8
          ? [
              { x: -w / 2 + wall + (inner - wall * 2) * 0.3, w: (inner - wall * 2) * 0.6, r: 0.012 },
              { x: w / 2 - wall - (inner - wall * 2) * 0.2, w: (inner - wall * 2) * 0.4, r: 0.012 },
            ].map(b => ({ ...b, z: 0, d: d - wall * 2, depth: 0.19 }))
          : [{ x: 0, z: 0, w: inner, d: d - wall * 2, r: 0.012, depth: 0.19 }]
      return {
        style: 'undermount',
        wall,
        bowls,
        tap: [bowls[0].x, -d / 2 - 0.045],
        // The worktop overhangs the bowl by a few millimeters, so its cut
        // edge is what shows.
        worktop: bowls.map(b => opening(b, -0.004)),
        carcass: bowls.map(b => opening(b, wall / 2)),
      }
    }
  }
}
