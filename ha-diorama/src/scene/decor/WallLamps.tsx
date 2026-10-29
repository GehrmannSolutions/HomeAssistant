import { cestitaGlobeProfile } from '#/scene/decor/cestitaGlobe.ts'
import { BaseMaterial, ShadeMaterial, type LightState } from '#/scene/decor/lightMaterials.tsx'
import { Rod, SEG } from '#/scene/decor/parts.tsx'
import { CESTITA_GLOBE, CESTITA_GLOBE_R } from '#/scene/decor/tableLampSpecs.ts'
import {
  SINGULAR_PLATE,
  SINGULAR_PLATE_Y,
  SINGULAR_RING_R,
  SINGULAR_RING_Z,
  SINGULAR_SHADE,
  SINGULAR_SHADE_T,
  SINGULAR_SIDE,
  SINGULAR_STEM_W,
  SINGULAR_STRUT_R,
  TMM_BLOCK,
  TMM_PLATE,
  TMM_RAIL,
  TMM_SHADE_H,
  TMM_SHADE_R,
  TMM_SHADE_T,
  WALLY_ARM,
  WALLY_BAND,
  WALLY_BAND_T,
  WALLY_DISC,
  WALLY_GLOBE_BOTTOM,
  WALLY_GLOBE_R,
  WALLY_GLOBE_Z,
  WALLY_NECK,
  WALLY_PLATE,
} from '#/scene/decor/wallLampSpecs.ts'
import { useMemo, type ReactNode } from 'react'
import { ExtrudeGeometry, Shape, Vector2, Vector3 } from 'three'

// The wall lamp styles, each one a Santa & Cole lamp drawn from its
// technical drawing. Every part is in real meters, out from the wall along z
// and up from the lamp's middle, so the numbers can be checked against the
// drawings. The width slider scales the whole lamp, so its shade or globe
// keeps its shape. The height slider lengthens the shade or the plate on the
// wall, and the depth slider whatever holds the lamp out from the wall.

type ModelProps = {
  c: (slot: string) => string
  m: (slot: string) => string
  state: LightState | null
  // How much taller the lamp is, and how much further it stands out from
  // the wall, than in the drawing, before it is scaled.
  up: number
  out: number
}

// A thin walled tube open at both ends, with flat edges, standing on y. A
// shade lets the light through, so it casts no shadow of its own.
function Tube({
  r,
  t,
  h,
  shade = false,
  children,
}: {
  r: number
  t: number
  h: number
  shade?: boolean
  children: ReactNode
}) {
  const userData = { transmits: shade }
  return (
    <group>
      <mesh userData={userData}>
        <cylinderGeometry args={[r, r, h, SEG * 4, 1, true]} />
        {children}
      </mesh>
      <mesh userData={userData}>
        <cylinderGeometry args={[r - t, r - t, h, SEG * 4, 1, true]} />
        {children}
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[0, (s * h) / 2, 0]} rotation={[(-s * Math.PI) / 2, 0, 0]} userData={userData}>
          <ringGeometry args={[r - t, r, SEG * 4]} />
          {children}
        </mesh>
      ))}
    </group>
  )
}

// TMM corto: a beech channel on the wall, a Ø20 parchment shade held in
// front of it by two blocks, with a black arm and lamp holder.
// A taller one has a taller shade and channel, and a deeper one a deeper
// channel.
function Tmm({ c, m, state, up, out }: ModelProps) {
  const w = TMM_PLATE[0]
  const h = TMM_PLATE[1] + up
  const d = TMM_PLATE[2] + out
  const shadeH = TMM_SHADE_H + up
  const wood = <BaseMaterial color={c('channel')} material={m('channel')} />
  const black = <BaseMaterial color={c('fittings')} material={m('fittings')} />
  const shadeZ = d + TMM_SHADE_R
  return (
    <group>
      {/* The channel: a back and a rail down each side. */}
      <mesh position={[0, 0, TMM_RAIL / 2]}>
        <boxGeometry args={[w - TMM_RAIL * 2, h, TMM_RAIL]} />
        {wood}
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[(s * (w - TMM_RAIL)) / 2, 0, d / 2]}>
          <boxGeometry args={[TMM_RAIL, h, d]} />
          {wood}
        </mesh>
      ))}
      {/* The blocks at the front of the channel that the shade hangs on. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (w / 2 - TMM_RAIL - TMM_BLOCK / 2), 0, d - TMM_BLOCK / 2]}>
          <boxGeometry args={[TMM_BLOCK, h, TMM_BLOCK]} />
          {wood}
        </mesh>
      ))}
      <group position={[0, 0, shadeZ]}>
        <Tube r={TMM_SHADE_R} t={TMM_SHADE_T} h={shadeH} shade>
          <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
        </Tube>
      </group>
      {/* The arm across the top of the shade that carries the lamp holder
          in its middle. */}
      <mesh position={[0, shadeH / 2 - 0.03, (d + shadeZ) / 2]}>
        <boxGeometry args={[0.008, 0.008, shadeZ - d]} />
        {black}
      </mesh>
      <mesh position={[0, shadeH / 2 - 0.055, shadeZ]}>
        <cylinderGeometry args={[0.014, 0.014, 0.05, SEG]} />
        {black}
      </mesh>
    </group>
  )
}

// The Singular's shade seen from above: straight sides out from the wall and
// a half circle at the front, as a wall of the given thickness.
function singularShadeGeometry(h: number, side: number) {
  const r = SINGULAR_SHADE[0] / 2
  const t = SINGULAR_SHADE_T
  const shape = new Shape()
  shape.moveTo(-r, 0)
  shape.lineTo(-r, side)
  shape.absarc(0, side, r, Math.PI, 0, true)
  shape.lineTo(r, 0)
  shape.lineTo(r - t, 0)
  shape.lineTo(r - t, side)
  shape.absarc(0, side, r - t, 0, Math.PI, false)
  shape.lineTo(-r + t, 0)
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: SEG * 4 })
  // The shape's y is out from the wall and it is pushed out along its own z:
  // turned so that is z out and y down, from the top of the shade.
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, h / 2, 0)
  return geometry
}

// A taller one has a taller shade, with the holder as far up from its
// bottom, and a deeper one longer straight sides.
function Singular({ c, m, state, up, out }: ModelProps) {
  const shade = useMemo(() => singularShadeGeometry(SINGULAR_SHADE[1] + up, SINGULAR_SIDE + out), [up, out])
  const chrome = <BaseMaterial color={c('structure')} material={m('structure')} />
  const [plate, plateT] = SINGULAR_PLATE
  const [ringR, ringIn, socketR] = SINGULAR_RING_R
  const y = SINGULAR_PLATE_Y - up / 2
  const edge = SINGULAR_SHADE[0] / 2 - SINGULAR_SHADE_T
  // The struts leave the ring at its back, a little to each side, and run
  // to the back edges of the shade.
  const struts = useMemo(
    () =>
      [-1, 1].map(s => {
        const from = new Vector3(s * Math.sin(0.9) * ringR, y, SINGULAR_RING_Z - Math.cos(0.9) * ringR)
        return [from, new Vector3(s * edge, y, 0.004)] as const
      }),
    [ringR, y, edge],
  )
  return (
    <group>
      <mesh geometry={shade} userData={{ transmits: true }}>
        <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
      </mesh>
      <mesh position={[0, y, plateT / 2]}>
        <boxGeometry args={[plate, plate, plateT]} />
        {chrome}
      </mesh>
      {/* The stem out to the holder, and the ring round it. */}
      <mesh position={[0, y, (plateT + SINGULAR_RING_Z - ringR) / 2]}>
        <boxGeometry args={[SINGULAR_STEM_W, 0.008, SINGULAR_RING_Z - ringR - plateT]} />
        {chrome}
      </mesh>
      <group position={[0, y, SINGULAR_RING_Z]}>
        <Tube r={ringR} t={ringR - ringIn} h={0.012}>
          {chrome}
        </Tube>
        {/* The socket stands up out of the ring. */}
        <mesh position={[0, 0.015, 0]}>
          <cylinderGeometry args={[socketR, socketR, 0.05, SEG * 2]} />
          {chrome}
        </mesh>
      </group>
      {struts.map(([from, to], i) => (
        <Rod key={i} from={from} to={to} r={SINGULAR_STRUT_R}>
          {chrome}
        </Rod>
      ))}
    </group>
  )
}

// The table Cestita's globe, grown to the Wally's Ø18.
const CESTITA_SCALE = WALLY_GLOBE_R / CESTITA_GLOBE_R
const WALLY_GLOBE_PROFILE = cestitaGlobeProfile().map(([x, y]) => new Vector2(x, y))

// Wally Cestita: a black steel plate on the wall, the Cestita's opal globe
// held by a band at its waist and standing on a disc on an arm below.
// A taller one has a taller plate, and a deeper one holds its globe
// further out.
function Wally({ c, m, state, up, out }: ModelProps) {
  const [w, d] = [WALLY_PLATE[0], WALLY_PLATE[2]]
  const h = WALLY_PLATE[1] + up
  const globeZ = WALLY_GLOBE_Z + out
  const neckD = WALLY_NECK[1] + out
  const armZ = WALLY_ARM[2] + out
  const steel = <BaseMaterial color={c('structure')} material={m('structure')} />
  const [bandR, bandH, bandY] = WALLY_BAND
  const neckW = WALLY_NECK[0]
  const [discR, discH] = WALLY_DISC
  const [armW, armH] = WALLY_ARM
  const k = CESTITA_SCALE
  const globeY = WALLY_GLOBE_BOTTOM - CESTITA_GLOBE[0] * k
  const discY = WALLY_GLOBE_BOTTOM - discH / 2
  const armY = WALLY_GLOBE_BOTTOM - discH - armH / 2
  return (
    <group>
      <mesh position={[0, 0, d / 2]}>
        <boxGeometry args={[w, h, d]} />
        {steel}
      </mesh>
      {/* The piece out to the band, as tall as the band. */}
      <mesh position={[0, bandY, (d + neckD) / 2]}>
        <boxGeometry args={[neckW, bandH, neckD - d]} />
        {steel}
      </mesh>
      <group position={[0, bandY, globeZ]}>
        <Tube r={bandR} t={WALLY_BAND_T} h={bandH}>
          {steel}
        </Tube>
      </group>
      <mesh position={[0, globeY, globeZ]} scale={k} userData={{ transmits: true }}>
        <latheGeometry args={[WALLY_GLOBE_PROFILE, Math.round(SEG * 1.5)]} />
        <ShadeMaterial color={c('globe')} material={m('globe')} state={state} />
      </mesh>
      <mesh position={[0, discY, globeZ]}>
        <cylinderGeometry args={[discR, discR, discH, SEG * 2]} />
        {steel}
      </mesh>
      <mesh position={[0, armY, (d + armZ) / 2]}>
        <boxGeometry args={[armW, armH, armZ - d]} />
        {steel}
      </mesh>
    </group>
  )
}

const MODELS: Record<string, (props: ModelProps) => ReactNode> = {
  tmm: Tmm,
  singular: Singular,
  wally: Wally,
}

export default function WallLamp({ style, k, ...props }: ModelProps & { style: string; k: number }) {
  const Model = MODELS[style] ?? Tmm
  return (
    <group scale={k}>
      <Model {...props} />
    </group>
  )
}
