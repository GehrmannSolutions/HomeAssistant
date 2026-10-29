import {
  DEVA_APRON,
  DEVA_BAND,
  DEVA_CORNER,
  DEVA_LEG,
  DEVA_TOP,
  SPIDER_BRACE,
  SPIDER_CHAMFER,
  SPIDER_INSET,
  SPIDER_LEAN,
  SPIDER_MEMBER,
  SPIDER_TOP,
  SPIDER_TOP_EDGE,
  VIOK_CHAMFER,
  VIOK_LEG,
  VIOK_PLATE,
  VIOK_RAIL,
  VIOK_TOP,
  VIOK_TOP_EDGE,
} from '#/scene/decor/diningTableSpecs.ts'
import { Slab } from '#/scene/decor/parts.tsx'
import { useMemo, type ReactNode } from 'react'
import { BoxGeometry, ExtrudeGeometry, Quaternion, Shape, Vector3 } from 'three'

type Props = {
  style: string
  w: number
  d: number
  h: number
  // The material of a named part.
  M: (slot: string) => ReactNode
}

// x from, x to, z from, z to.
type Span = [number, number, number, number]

// A box from the floor up to `h`, whose top and bottom are each their own
// rectangle: a chamfer, or a plate that narrows toward the floor.
function prism(bottom: Span, top: Span, h: number) {
  const geo = new BoxGeometry(1, 1, 1)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const up = pos.getY(i) > 0
    const [x0, x1, z0, z1] = up ? top : bottom
    pos.setXYZ(i, pos.getX(i) < 0 ? x0 : x1, up ? h : 0, pos.getZ(i) < 0 ? z0 : z1)
  }
  geo.computeVertexNormals()
  return geo
}

function Prism({
  bottom,
  top,
  h,
  y = 0,
  children,
}: {
  bottom: Span
  top: Span
  h: number
  y?: number
  children: ReactNode
}) {
  const geometry = useMemo(() => prism(bottom, top, h), [bottom, top, h])
  return (
    <mesh geometry={geometry} position={[0, y, 0]} castShadow receiveShadow>
      {children}
    </mesh>
  )
}

const span = (w: number, d: number): Span => [-w / 2, w / 2, -d / 2, d / 2]

// A top whose underside is chamfered, so its edge reads thinner than it is.
function ChamferedTop({
  w,
  d,
  h,
  thick,
  edge,
  chamfer,
  children,
}: {
  w: number
  d: number
  h: number
  thick: number
  edge: number
  chamfer: number
  children: ReactNode
}) {
  const bottom = useMemo(() => span(w - chamfer * 2, d - chamfer * 2), [w, d, chamfer])
  const top = useMemo(() => span(w, d), [w, d])
  return (
    <>
      <Prism bottom={bottom} top={top} h={thick - edge} y={h - thick}>
        {children}
      </Prism>
      <Prism bottom={top} top={top} h={edge} y={h - edge}>
        {children}
      </Prism>
    </>
  )
}

// A square section of wood between two points, run on past both until its
// ends are `bury` deeper, so their square cuts sink into the top and the
// floor instead of leaving a gap under a leaning member.
function Beam({
  from,
  to,
  size,
  bury,
  children,
}: {
  from: Vector3
  to: Vector3
  size: number
  bury: number
  children: ReactNode
}) {
  const { mid, length, turn } = useMemo(() => {
    const dir = to.clone().sub(from).normalize()
    const past = bury / Math.max(Math.abs(dir.y), 0.3)
    return {
      mid: from.clone().add(to).multiplyScalar(0.5),
      length: from.distanceTo(to) + past * 2,
      turn: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir),
    }
  }, [from, to, bury])
  return (
    <mesh position={mid} quaternion={turn} castShadow>
      <boxGeometry args={[size, length, size]} />
      {children}
    </mesh>
  )
}

function NewViok({ w, d, h, M }: Omit<Props, 'style'>) {
  const legH = h - VIOK_TOP
  const [wide, narrow] = VIOK_LEG
  const t = VIOK_PLATE
  // Each corner's angle: a plate along the long side and one along the end,
  // meeting at the corner and narrowing inward toward the floor.
  const plates = useMemo(() => {
    const out: { key: string; bottom: Span; top: Span }[] = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = (sx * w) / 2
        const z = (sz * d) / 2
        const along = (a: number): Span => [
          Math.min(x, x - sx * a),
          Math.max(x, x - sx * a),
          Math.min(z, z - sz * t),
          Math.max(z, z - sz * t),
        ]
        const across = (a: number): Span => [
          Math.min(x, x - sx * t),
          Math.max(x, x - sx * t),
          Math.min(z, z - sz * a),
          Math.max(z, z - sz * a),
        ]
        out.push({ key: `x${sx}${sz}`, bottom: along(narrow), top: along(wide) })
        out.push({ key: `z${sx}${sz}`, bottom: across(narrow), top: across(wide) })
      }
    }
    return out
  }, [w, d, t, wide, narrow])
  const [railH, railT, railIn] = VIOK_RAIL
  return (
    <group>
      {plates.map(plate => (
        <Prism key={plate.key} bottom={plate.bottom} top={plate.top} h={legH}>
          {M('frame')}
        </Prism>
      ))}
      {[-1, 1].map(sz => (
        <mesh key={sz} position={[0, legH - railH / 2, sz * (d / 2 - railIn - railT / 2)]} castShadow>
          <boxGeometry args={[w - t * 2 - 0.002, railH, railT]} />
          {M('frame')}
        </mesh>
      ))}
      <ChamferedTop w={w} d={d} h={h} thick={VIOK_TOP} edge={VIOK_TOP_EDGE} chamfer={VIOK_CHAMFER}>
        {M('top')}
      </ChamferedTop>
    </group>
  )
}

// A leg's plan: a square with one corner, the outer one, rounded to follow
// the top's. Drawn in the plane the leg is extruded up from, where the
// plane's y is the world's -z.
function devaLegShape(x0: number, x1: number, y0: number, y1: number, corner: 0 | 1 | 2 | 3, big: number) {
  const r = [0.004, 0.004, 0.004, 0.004]
  r[corner] = big
  const s = new Shape()
  s.moveTo(x0 + r[0], y0)
  s.lineTo(x1 - r[1], y0)
  s.absarc(x1 - r[1], y0 + r[1], r[1], -Math.PI / 2, 0, false)
  s.lineTo(x1, y1 - r[2])
  s.absarc(x1 - r[2], y1 - r[2], r[2], 0, Math.PI / 2, false)
  s.lineTo(x0 + r[3], y1)
  s.absarc(x0 + r[3], y1 - r[3], r[3], Math.PI / 2, Math.PI, false)
  s.lineTo(x0, y0 + r[0])
  s.absarc(x0 + r[0], y0 + r[0], r[0], Math.PI, Math.PI * 1.5, false)
  return s
}

function Deva({ w, d, h, M }: Omit<Props, 'style'>) {
  const legH = h - DEVA_TOP
  // The legs stand a hair inside the top's edge.
  const inset = 0.002
  const legs = useMemo(() => {
    return [-1, 1].flatMap(sx =>
      [-1, 1].map(sz => {
        const x = sx * (w / 2 - inset)
        const y = -sz * (d / 2 - inset)
        const xs = [x, x - sx * DEVA_LEG].sort((a, b) => a - b)
        const ys = [y, y + sz * DEVA_LEG].sort((a, b) => a - b)
        // Corners go bottom left, bottom right, top right, top left.
        const corner = (sx > 0 ? (-sz > 0 ? 2 : 1) : -sz > 0 ? 3 : 0) as 0 | 1 | 2 | 3
        const geo = new ExtrudeGeometry(devaLegShape(xs[0], xs[1], ys[0], ys[1], corner, DEVA_CORNER), {
          depth: legH,
          bevelEnabled: false,
          curveSegments: 24,
        })
        geo.rotateX(-Math.PI / 2)
        return { key: `${sx}${sz}`, geo }
      }),
    )
  }, [w, d, legH])
  const [apronH, apronIn] = DEVA_APRON
  const under = h - DEVA_TOP - DEVA_BAND
  return (
    <group>
      {legs.map(leg => (
        <mesh key={leg.key} geometry={leg.geo} castShadow receiveShadow>
          {M('frame')}
        </mesh>
      ))}
      <Slab
        size={[w - apronIn * 2, apronH, d - apronIn * 2]}
        radius={DEVA_CORNER}
        bevel={0.003}
        position={[0, under - apronH, 0]}
      >
        {M('frame')}
      </Slab>
      <Slab size={[w, DEVA_BAND, d]} radius={DEVA_CORNER} bevel={0.004} position={[0, under, 0]}>
        {M('frame')}
      </Slab>
      <Slab size={[w, DEVA_TOP, d]} radius={DEVA_CORNER} bevel={0.003} position={[0, h - DEVA_TOP, 0]}>
        {M('top')}
      </Slab>
    </group>
  )
}

function Spider({ w, d, h, M }: Omit<Props, 'style'>) {
  const members = useMemo(() => {
    const under = h - SPIDER_TOP
    const xe = w / 2 - SPIDER_INSET[0]
    const ze = d / 2 - SPIDER_INSET[1]
    const out: { key: string; from: Vector3; to: Vector3 }[] = []
    // The far trestle is the near one turned half round.
    for (const s of [-1, 1]) {
      const at = (x: number, y: number, z: number) => new Vector3(s * x, y, s * z)
      const foot = at(xe, 0, -ze)
      out.push({ key: `leg${s}`, from: at(xe, 0, ze), to: at(xe, under, ze) })
      out.push({ key: `lean${s}`, from: foot, to: at(xe, under, ze * SPIDER_LEAN) })
      out.push({ key: `brace${s}`, from: foot, to: at(xe - SPIDER_BRACE, under, ze) })
    }
    return out
  }, [w, d, h])
  return (
    <group>
      {members.map(member => (
        <Beam key={member.key} from={member.from} to={member.to} size={SPIDER_MEMBER} bury={SPIDER_TOP / 2}>
          {M('frame')}
        </Beam>
      ))}
      <ChamferedTop w={w} d={d} h={h} thick={SPIDER_TOP} edge={SPIDER_TOP_EDGE} chamfer={SPIDER_CHAMFER}>
        {M('top')}
      </ChamferedTop>
    </group>
  )
}

export default function DiningTable({ style, ...props }: Props) {
  if (style === 'deva') return <Deva {...props} />
  if (style === 'spider') return <Spider {...props} />
  return <NewViok {...props} />
}
