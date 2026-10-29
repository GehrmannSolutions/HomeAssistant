import {
  DINING_CHAIRS,
  OIA_BACK_T,
  OIA_LEAN,
  OIA_LEG,
  OIA_SEAT,
  SURA_BOARD,
  SURA_FRONT_LEG,
  SURA_REAR_LEG,
  SURA_SEAT,
  VARMA_BACK,
  VARMA_LEG,
  VARMA_RAIL,
  VARMA_SEAT,
  VARMA_STRETCHER,
} from '#/scene/decor/diningChairSpecs.ts'
import { Cushion, Slab } from '#/scene/decor/parts.tsx'
import { ArcBack, Dowel } from '#/scene/decor/woodwork.tsx'
import { atHeight, type Vec3 } from '#/scene/decor/points.ts'
import { type ReactNode } from 'react'

type Props = {
  style: string
  w: number
  d: number
  h: number
  // The material of a named part.
  M: (slot: string) => ReactNode
}

// A chair's size as the sliders give it, and its materials.
type Size = Omit<Props, 'style'>

function Oia({ w, d, h, M }: Size) {
  const ky = h / DINING_CHAIRS.oia.height
  const t = OIA_SEAT[1]
  const top = OIA_SEAT[0] * ky
  const [upper, lower] = OIA_LEG.map(s => s / 2) as [number, number]
  const x = w / 2 - upper
  const front = d / 2 - upper
  const rear = -d / 2 + upper
  // The back's foot, which the rear legs run up into.
  const backZ = rear + 0.04
  const backH = (h - (top - t)) / Math.cos(OIA_LEAN)
  return (
    <group>
      {[-1, 1].map(sx => (
        <group key={sx}>
          <Dowel from={[sx * x, top - t, front]} to={[sx * x, 0, front]} r={[upper, lower]} square>
            {M('legs')}
          </Dowel>
          <Dowel from={[sx * x, top - t, backZ]} to={[sx * x, 0, rear]} r={[upper, lower]} square>
            {M('legs')}
          </Dowel>
        </group>
      ))}
      <Slab
        size={[w, t, d / 2 - backZ + OIA_BACK_T / 2]}
        radius={0.008}
        bevel={0.005}
        position={[0, top - t, (d / 2 + backZ - OIA_BACK_T / 2) / 2]}
      >
        {M('shell')}
      </Slab>
      <Slab
        size={[w, backH, OIA_BACK_T]}
        radius={0.006}
        bevel={0.005}
        position={[0, top - t, backZ]}
        rotation={[-OIA_LEAN, 0, 0]}
      >
        {M('shell')}
      </Slab>
    </group>
  )
}

function Sura({ w, d, h, M }: Size) {
  const spec = DINING_CHAIRS.sura
  const [kx, ky, kz] = [w / spec.width, h / spec.height, d / spec.depth]
  // The seat keeps its thickness, and the board its height and thickness.
  const top = SURA_SEAT[0] * ky
  const bottom = top - (SURA_SEAT[0] - SURA_SEAT[1])
  const deep = SURA_SEAT[2] * kz
  const [bw, bh, bt, br] = [SURA_BOARD[0] * kx, SURA_BOARD[1], SURA_BOARD[2], SURA_BOARD[3] * kx]
  const [seatR, footR, postR] = SURA_REAR_LEG
  const front = d / 2 - 0.02
  const fx = w / 2 - 0.025
  const rx = w / 2 - 0.04
  // The rear leg bends at the back of the seat: it rises from a foot splayed
  // back and leans back again above the seat.
  const knee: Vec3 = [rx, bottom + 0.075 * ky, front - deep - 0.01]
  const foot: Vec3 = [rx, 0, -d / 2 + footR]
  const head: Vec3 = [rx, h, -d / 2 + postR]
  const lean = Math.atan2(knee[2] - head[2], head[1] - knee[1])
  // The board sits in front of the posts, its top at the chair's top. It
  // curves round the sitter, so its ends stand forward of its middle, and it
  // is set back by that much for them to rest on the posts.
  const boardY = h - bh - 0.008
  const postZ = knee[2] + ((head[2] - knee[2]) * (boardY - knee[1])) / (head[1] - knee[1])
  const sag = br - Math.sqrt(br * br - rx * rx)
  return (
    <group>
      {[-1, 1].map(sx => {
        const at = (v: Vec3): Vec3 => [sx * v[0], v[1], v[2]]
        return (
          <group key={sx}>
            <Dowel
              from={[sx * fx, top, front - 0.01]}
              to={[sx * fx, 0, front]}
              r={[SURA_FRONT_LEG[0], SURA_FRONT_LEG[1]]}
            >
              {M('frame')}
            </Dowel>
            <Dowel from={at(foot)} to={at(knee)} r={[footR, seatR]}>
              {M('frame')}
            </Dowel>
            <Dowel from={at(knee)} to={at(head)} r={[seatR, postR]}>
              {M('frame')}
            </Dowel>
            <mesh position={at(knee)}>
              <sphereGeometry args={[seatR, 32, 16]} />
              {M('frame')}
            </mesh>
          </group>
        )
      })}
      <Slab size={[w - 0.02, top - bottom, deep]} radius={0.012} bevel={0.006} position={[0, bottom, front - deep / 2]}>
        {M('seat')}
      </Slab>
      <group position={[0, boardY, postZ + postR - sag]} rotation={[-lean, 0, 0]}>
        <ArcBack size={[bw, bh, bt]} radius={br}>
          {M('frame')}
        </ArcBack>
      </group>
    </group>
  )
}

function Varma({ w, d, h, M }: Size) {
  const spec = DINING_CHAIRS.varma
  const [kx, ky, kz] = [w / spec.width, h / spec.height, d / spec.depth]
  const pad = VARMA_SEAT[1]
  const top = VARMA_SEAT[0] * ky
  const [railH, railT] = VARMA_RAIL
  const [bw, bh, bt, br] = [VARMA_BACK[0] * kx, VARMA_BACK[1], VARMA_BACK[2], VARMA_BACK[3] * kx]
  const [thick, thin] = VARMA_LEG
  const seat = top - pad
  // Front legs splay out a little, rear legs splay back, and the posts above
  // the seat draw in toward the backrest.
  const fSeat: Vec3 = [w / 2 - 0.05 * kx, seat, d / 2 - 0.055 * kz]
  const fFoot: Vec3 = [w / 2 - 0.035 * kx, 0, d / 2 - 0.025 * kz]
  const rSeat: Vec3 = [w / 2 - 0.07 * kx, seat, -d / 2 + 0.065 * kz]
  const rFoot: Vec3 = [w / 2 - 0.055 * kx, 0, -d / 2 + 0.015 * kz]
  const head: Vec3 = [bw / 2 - 0.05 * kx, h, -d / 2 + 0.03 * kz]
  const lean = Math.atan2(rSeat[2] - head[2], head[1] - rSeat[1])
  const backY = h - bh
  const postZ = rSeat[2] + ((head[2] - rSeat[2]) * (backY - rSeat[1])) / (head[1] - rSeat[1])
  // The backrest's ends stand forward of its middle by its curve, so it is
  // set back by that much for them to rest on the posts.
  const postX = rSeat[0] + ((head[0] - rSeat[0]) * (backY - rSeat[1])) / (head[1] - rSeat[1])
  const sag = br - Math.sqrt(br * br - postX * postX)
  const sy = VARMA_STRETCHER[0] * ky
  const railX = (fSeat[0] + rSeat[0]) / 2
  return (
    <group>
      {[-1, 1].map(sx => {
        const at = (v: Vec3): Vec3 => [sx * v[0], v[1], v[2]]
        return (
          <group key={sx}>
            <Dowel from={at(fFoot)} to={at(fSeat)} r={[thin, thick]}>
              {M('frame')}
            </Dowel>
            <Dowel from={at(rFoot)} to={at(rSeat)} r={[thin, thick]}>
              {M('frame')}
            </Dowel>
            <Dowel from={at(rSeat)} to={at(head)} r={[thick * 0.85, thin * 1.15]}>
              {M('frame')}
            </Dowel>
            <Dowel
              from={at(atHeight(fSeat, fFoot, sy))}
              to={at(atHeight(rSeat, rFoot, sy))}
              r={[VARMA_STRETCHER[1] / 2, VARMA_STRETCHER[1] / 2]}
              square
            >
              {M('frame')}
            </Dowel>
            <mesh position={[sx * railX, seat - railH / 2, (fSeat[2] + rSeat[2]) / 2]} castShadow>
              <boxGeometry args={[railT, railH, fSeat[2] - rSeat[2]]} />
              {M('frame')}
            </mesh>
          </group>
        )
      })}
      <mesh position={[0, seat - railH / 2, fSeat[2]]} castShadow>
        <boxGeometry args={[fSeat[0] * 2, railH, railT]} />
        {M('frame')}
      </mesh>
      <mesh position={[0, seat - railH / 2, rSeat[2]]} castShadow>
        <boxGeometry args={[rSeat[0] * 2, railH, railT]} />
        {M('frame')}
      </mesh>
      <Cushion size={[w - 0.02, pad, d - 0.07]} position={[0, seat, 0.02]}>
        {M('seat')}
      </Cushion>
      <group position={[0, backY, postZ + thin - sag]} rotation={[-lean, 0, 0]}>
        <ArcBack size={[bw, bh, bt]} radius={br}>
          {M('frame')}
        </ArcBack>
      </group>
    </group>
  )
}

const CHAIRS: Record<string, (props: Size) => ReactNode> = { oia: Oia, sura: Sura, varma: Varma }

// Each chair is laid out again at the size the sliders give it: its legs
// grow longer and its seat wider, while legs, boards and cushions keep their
// thickness.
export default function DiningChair({ style, ...size }: Props) {
  const Chair = CHAIRS[style] ?? Oia
  return <Chair {...size} />
}
