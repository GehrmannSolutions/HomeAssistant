import {
  DEAN_BAND,
  DEAN_LEG_R,
  DEAN_SEAT,
  DEAN_STRETCHER,
  DEAN_TOP,
  DEAN_WEAVE,
  KEULA_BACK,
  KEULA_LEG_R,
  KEULA_PAD,
  KEULA_TOP,
  LAUTA_LEG_FOOT,
  LAUTA_LEG_R,
  LAUTA_LEG_TOP,
  LAUTA_RAIL,
  LAUTA_SEAT,
  STOOLS,
} from '#/scene/decor/stoolSpecs.ts'
import { Cushion, Slab } from '#/scene/decor/parts.tsx'
import { Cap, Dowel } from '#/scene/decor/woodwork.tsx'
import { atHeight, type Vec3 } from '#/scene/decor/points.ts'
import { useMemo, type ReactNode } from 'react'
import { ExtrudeGeometry, Shape } from 'three'

type Props = {
  style: string
  w: number
  d: number
  // The seat's height.
  h: number
  // The material of a named part.
  M: (slot: string) => ReactNode
}

// A stool's size as the sliders give it, and its materials.
type Part = Omit<Props, 'style'>

// Mirrors a point across the stool's middle, left to right.
const flip = (v: Vec3, sx: number): Vec3 => [sx * v[0], v[1], v[2]]

function Lauta({ w, d, h: seat, M }: Part) {
  const spec = STOOLS.lauta
  const [kx, ky, kz] = [w / spec.width, seat / spec.seat, d / spec.depth]
  const [railH, railT] = [LAUTA_RAIL[1], LAUTA_RAIL[2]]
  const railY = LAUTA_RAIL[0] * ky
  const legs = [-1, 1].flatMap(sx =>
    [-1, 1].map(sz => ({
      key: `${sx}${sz}`,
      foot: [sx * LAUTA_LEG_FOOT[0] * kx, 0, sz * LAUTA_LEG_FOOT[1] * kz] as Vec3,
      top: [sx * LAUTA_LEG_TOP[0] * kx, seat - 0.005, sz * LAUTA_LEG_TOP[1] * kz] as Vec3,
    })),
  )
  // The low rails run across the front and the back, the side rails along
  // the sides just under the seat.
  const low = atHeight(legs[3].foot, legs[3].top, railY)
  const high = atHeight(legs[3].foot, legs[3].top, seat - LAUTA_SEAT - 0.035)
  return (
    <group>
      {legs.map(leg => (
        <group key={leg.key}>
          <Dowel from={leg.foot} to={leg.top} r={[LAUTA_LEG_R[1], LAUTA_LEG_R[0]]}>
            {M('legs')}
          </Dowel>
          <Cap at={leg.top} r={LAUTA_LEG_R[0]}>
            {M('legs')}
          </Cap>
        </group>
      ))}
      <Slab size={[w - 0.02, LAUTA_SEAT, d - 0.04]} radius={0.015} bevel={0.008} position={[0, seat - LAUTA_SEAT, 0]}>
        {M('seat')}
      </Slab>
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[0, railY, s * low[2]]} castShadow>
            <boxGeometry args={[low[0] * 2, railH, railT]} />
            {M('legs')}
          </mesh>
          <mesh position={[s * high[0], high[1], 0]} castShadow>
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

function Dean({ w, d, h: seat, M }: Part) {
  const spec = STOOLS.dean
  // The back stands as high over the seat at any seat height, and the
  // stretchers stay where they are on the legs.
  const lift = seat - spec.seat
  const ky = seat / spec.seat
  const [thin, thick] = DEAN_LEG_R
  const x = w / 2 - thick - 0.005
  const fFoot: Vec3 = [x, 0, d / 2 - 0.02]
  const fTop: Vec3 = [x - 0.005, seat + 0.01, d / 2 - 0.03]
  const rFoot: Vec3 = [x, 0, -d / 2 + 0.02]
  const knee: Vec3 = [x - 0.005, seat - DEAN_SEAT, -d / 2 + 0.08]
  const head: Vec3 = [x - 0.005, DEAN_TOP + lift - 0.01, -d / 2 + 0.055]
  const [topH, bottomH] = [DEAN_BAND[2], DEAN_BAND[3]]
  const [topY, bottomY] = [DEAN_BAND[0] + lift, DEAN_BAND[1] + lift]
  const back = atHeight(knee, head, (topY + bottomY) / 2)
  const span = back[0] * 2
  // The open weave between the bands, cord on a square grid.
  const cords = (() => {
    const out: { key: string; from: Vec3; to: Vec3 }[] = []
    const y0 = bottomY + bottomH / 2
    const y1 = topY - topH / 2
    const n = Math.round(span / DEAN_WEAVE)
    for (let i = 1; i < n; i++) {
      const cx = -span / 2 + (i * span) / n
      out.push({ key: `v${i}`, from: [cx, y0, back[2]], to: [cx, y1, back[2]] })
    }
    const m = Math.round((y1 - y0) / DEAN_WEAVE)
    for (let j = 1; j < m; j++) {
      const cy = y0 + (j * (y1 - y0)) / m
      out.push({ key: `h${j}`, from: [-span / 2, cy, back[2]], to: [span / 2, cy, back[2]] })
    }
    return out
  })()
  const [lowY, sideY] = DEAN_STRETCHER.map(y => y * ky)
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx}>
          <Dowel from={flip(fFoot, sx)} to={flip(fTop, sx)} r={[thin, thick]}>
            {M('legs')}
          </Dowel>
          <Cap at={flip(fTop, sx)} r={thick}>
            {M('legs')}
          </Cap>
          <Dowel from={flip(rFoot, sx)} to={flip(knee, sx)} r={[thin, thick]}>
            {M('legs')}
          </Dowel>
          <Dowel from={flip(knee, sx)} to={flip(head, sx)} r={[thick, thick * 0.95]}>
            {M('legs')}
          </Dowel>
          <mesh position={flip(knee, sx)}>
            <sphereGeometry args={[thick, 32, 16]} />
            {M('legs')}
          </mesh>
          <Cap at={flip(head, sx)} r={thick * 0.95}>
            {M('legs')}
          </Cap>
          <Dowel
            from={flip(atHeight(fFoot, fTop, sideY), sx)}
            to={flip(atHeight(rFoot, knee, sideY), sx)}
            r={[0.01, 0.01]}
          >
            {M('legs')}
          </Dowel>
        </group>
      ))}
      {[atHeight(fFoot, fTop, lowY), atHeight(rFoot, knee, lowY)].map(at => (
        <Dowel key={at[2]} from={[-at[0], lowY, at[2]]} to={[at[0], lowY, at[2]]} r={[0.01, 0.01]}>
          {M('legs')}
        </Dowel>
      ))}
      <Slab
        size={[w - 0.03, DEAN_SEAT, fTop[2] - knee[2] + 0.02]}
        radius={0.015}
        bevel={0.01}
        position={[0, seat - DEAN_SEAT, (fTop[2] + knee[2]) / 2]}
      >
        {M('seat')}
      </Slab>
      {[
        [topY, topH],
        [bottomY, bottomH],
      ].map(([y, h]) => (
        <Slab key={y} size={[span, h, 0.03]} radius={0.012} bevel={0.01} position={[0, y - h / 2, back[2]]}>
          {M('seat')}
        </Slab>
      ))}
      {cords.map(cord => (
        <Dowel key={cord.key} from={cord.from} to={cord.to} r={[0.0025, 0.0025]}>
          {M('seat')}
        </Dowel>
      ))}
    </group>
  )
}

// Keula's back: a horseshoe of oak seen from the front, the posts running up
// into a broad crest, bowed back in plan toward its middle. Its foot is the
// origin and it rises along +y, `W` out to either side.
function keulaArch(height: number, W: number) {
  const { post: t, thick, crest, corner: R, bow } = KEULA_BACK
  const r = R - t * 0.7
  const b = 0.008
  const s = new Shape()
  s.moveTo(-W, 0)
  s.lineTo(-W, height - R)
  s.absarc(-W + R, height - R, R, Math.PI, Math.PI / 2, true)
  s.lineTo(W - R, height)
  s.absarc(W - R, height - R, R, Math.PI / 2, 0, true)
  s.lineTo(W, 0)
  s.lineTo(W - t, 0)
  s.lineTo(W - t, height - crest - r)
  s.absarc(W - t - r, height - crest - r, r, 0, Math.PI / 2, false)
  s.lineTo(-W + t + r, height - crest)
  s.absarc(-W + t + r, height - crest - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-W + t, 0)
  s.closePath()
  const geo = new ExtrudeGeometry(s, {
    depth: thick - b * 2,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b * 0.9,
    bevelSegments: 4,
    curveSegments: 48,
  })
  geo.translate(0, 0, b - thick / 2)
  // Bow the crest back: the middle sits `bow` behind the posts.
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    pos.setZ(i, pos.getZ(i) - (bow * Math.max(W * W - x * x, 0)) / (W * W))
  }
  geo.computeVertexNormals()
  return geo
}

function Keula({ w, d, h: seat, M }: Part) {
  const spec = STOOLS.keula
  const lift = seat - spec.seat
  const half = KEULA_BACK.half * (w / spec.width)
  const [thin, thick] = KEULA_LEG_R
  const under = seat - KEULA_PAD
  const railH = 0.035
  const fFoot: Vec3 = [w / 2 - 0.03, 0, d / 2 - 0.025]
  const fTop: Vec3 = [w / 2 - 0.045, under, d / 2 - 0.07]
  const rFoot: Vec3 = [w / 2 - 0.03, 0, -d / 2 + 0.015]
  const post = half - KEULA_BACK.post / 2
  const rTop: Vec3 = [post, under - 0.02, -d / 2 + 0.07]
  const archH = KEULA_TOP + lift - rTop[1]
  const arch = useMemo(() => keulaArch(archH / Math.cos(KEULA_BACK.lean), half), [archH, half])
  const lowY = 0.2 * (seat / spec.seat)
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx}>
          <Dowel from={flip(fFoot, sx)} to={flip(fTop, sx)} r={[thin, thick]}>
            {M('legs')}
          </Dowel>
          <Dowel from={flip(rFoot, sx)} to={flip(rTop, sx)} r={[thin, thick]}>
            {M('legs')}
          </Dowel>
          <mesh position={[sx * fTop[0], under - railH / 2, (fTop[2] + rTop[2]) / 2]} castShadow>
            <boxGeometry args={[0.022, railH, fTop[2] - rTop[2]]} />
            {M('legs')}
          </mesh>
        </group>
      ))}
      {[fTop, rTop].map(at => (
        <mesh key={at[2]} position={[0, under - railH / 2, at[2]]} castShadow>
          <boxGeometry args={[at[0] * 2, railH, 0.022]} />
          {M('legs')}
        </mesh>
      ))}
      <mesh geometry={arch} position={[0, rTop[1], rTop[2]]} rotation={[-KEULA_BACK.lean, 0, 0]} castShadow>
        {M('legs')}
      </mesh>
      {[atHeight(fFoot, fTop, lowY), atHeight(rFoot, rTop, lowY)].map(at => (
        <Dowel key={at[2]} from={[-at[0], lowY, at[2]]} to={[at[0], lowY, at[2]]} r={[0.008, 0.008]}>
          {M('legs')}
        </Dowel>
      ))}
      <Dowel
        from={[0, lowY, atHeight(rFoot, rTop, lowY)[2]]}
        to={[0, lowY, atHeight(fFoot, fTop, lowY)[2]]}
        r={[0.008, 0.008]}
      >
        {M('legs')}
      </Dowel>
      <Cushion size={[w, KEULA_PAD, d - 0.1]} position={[0, under, 0.01]}>
        {M('seat')}
      </Cushion>
    </group>
  )
}

const STYLES: Record<string, (props: Part) => ReactNode> = { lauta: Lauta, dean: Dean, keula: Keula }

// Each stool is laid out again at the size the sliders give it: its legs
// grow longer and its seat wider, while its back stands as high over the
// seat and every part keeps its thickness.
export default function Stool({ style, ...size }: Props) {
  const Model = STYLES[style] ?? Lauta
  return <Model {...size} />
}
