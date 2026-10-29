import {
  ANGLE_BOARD,
  ANGLE_DRAWERS,
  BENCHES,
  LAUTA_BENCH_LEG_FOOT,
  LAUTA_BENCH_LEG_R,
  LAUTA_BENCH_LEG_TOP,
  LAUTA_BENCH_RAIL,
  LAUTA_BENCH_SEAT,
} from '#/scene/decor/benchSpecs.ts'
import { Slab } from '#/scene/decor/parts.tsx'
import { Cap, Dowel } from '#/scene/decor/woodwork.tsx'
import { atHeight, type Vec3 } from '#/scene/decor/points.ts'
import type { ReactNode } from 'react'

type Props = {
  style: string
  w: number
  d: number
  // The seat's height.
  h: number
  // The material of a named part.
  M: (slot: string) => ReactNode
}

// A bench's size as the sliders give it, and its materials.
type Part = Omit<Props, 'style'>

function Lauta({ w, d, h, M }: Part) {
  // The rails stay where they are on the legs.
  const ky = h / BENCHES.lauta.height
  const [railH, railT] = [LAUTA_BENCH_RAIL[2], LAUTA_BENCH_RAIL[3]]
  const [railY, endY] = [LAUTA_BENCH_RAIL[0] * ky, LAUTA_BENCH_RAIL[1] * ky]
  const [r0, r1] = LAUTA_BENCH_LEG_R
  const legs = [-1, 1].flatMap(sx =>
    [-1, 1].map(sz => ({
      key: `${sx}${sz}`,
      foot: [sx * (w / 2 - LAUTA_BENCH_LEG_FOOT[0]), 0, sz * (d / 2 - LAUTA_BENCH_LEG_FOOT[1])] as Vec3,
      top: [sx * (w / 2 - LAUTA_BENCH_LEG_TOP[0]), h - 0.005, sz * (d / 2 - LAUTA_BENCH_LEG_TOP[1])] as Vec3,
    })),
  )
  // The long rails run along the front and the back low down, the end rails
  // across the ends higher up.
  const low = atHeight(legs[3].foot, legs[3].top, railY)
  const high = atHeight(legs[3].foot, legs[3].top, endY)
  return (
    <group>
      {legs.map(leg => (
        <group key={leg.key}>
          <Dowel from={leg.foot} to={leg.top} r={[r1, r0]}>
            {M('legs')}
          </Dowel>
          <Cap at={leg.top} r={r0}>
            {M('legs')}
          </Cap>
        </group>
      ))}
      <Slab
        size={[w - LAUTA_BENCH_LEG_TOP[0] * 2 + r0 * 2, LAUTA_BENCH_SEAT, d - LAUTA_BENCH_LEG_TOP[1] * 2 + r0 * 2]}
        radius={0.015}
        bevel={0.008}
        position={[0, h - LAUTA_BENCH_SEAT, 0]}
      >
        {M('seat')}
      </Slab>
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[0, railY, s * low[2]]} castShadow>
            <boxGeometry args={[low[0] * 2, railH, railT]} />
            {M('legs')}
          </mesh>
          <mesh position={[s * high[0], endY, 0]} castShadow>
            <boxGeometry args={[railT, railH, high[2] * 2]} />
            {M('legs')}
          </mesh>
        </group>
      ))}
      <Dowel from={[0, railY, -low[2]]} to={[0, railY, low[2]]} r={[0.008, 0.008]}>
        {M('legs')}
      </Dowel>
    </group>
  )
}

function Angle({ w, d, h, M }: Part) {
  const b = ANGLE_BOARD
  const { height: ch, front, back, gap, thick, count } = ANGLE_DRAWERS
  // The case fills the width between the sides, and its fronts share it.
  const inner = w - b * 2
  const fw = (inner - gap * (count + 1)) / count
  const under = h - b
  const faceZ = d / 2 - front - thick / 2
  const bodyD = d - front - back - thick
  return (
    <group>
      <Slab size={[w, b, d]} radius={0.002} bevel={0.002} position={[0, under, 0]}>
        {M('frame')}
      </Slab>
      {[-1, 1].map(s => (
        <Slab key={s} size={[b, under, d]} radius={0.002} bevel={0.002} position={[s * (w / 2 - b / 2), 0, 0]}>
          {M('frame')}
        </Slab>
      ))}
      <mesh position={[0, under - ch / 2, (back - front - thick) / 2]} castShadow>
        <boxGeometry args={[inner, ch, bodyD]} />
        {M('drawers')}
      </mesh>
      {Array.from({ length: count }, (_, i) => (
        <Slab
          key={i}
          size={[fw, ch - gap, thick]}
          radius={0.002}
          bevel={0.0015}
          position={[-inner / 2 + gap + fw / 2 + i * (fw + gap), under - ch, faceZ]}
        >
          {M('drawers')}
        </Slab>
      ))}
    </group>
  )
}

// Each bench is laid out again at the size the sliders give it, so its
// legs, boards and drawers keep their thickness.
export default function Bench({ style, ...size }: Props) {
  return style === 'angle' ? <Angle {...size} /> : <Lauta {...size} />
}
