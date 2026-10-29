import { BaseMaterial, ShadeMaterial, type LightState } from '#/scene/decor/lightMaterials.tsx'
import { Material, SEG } from '#/scene/decor/parts.tsx'
import {
  FAD_BLOCKS,
  FAD_COLUMN_R,
  FAD_COLUMN_TOP,
  FAD_FOOT,
  FAD_HOLDER,
  FAD_LEG,
  FAD_ROD_FOOT,
  FAD_ROD_R,
  FAD_SHADE,
  FAD_SHADE_R,
  FAD_SLOT,
  FLOOR_LAMPS,
  LAMINA_ARM_W,
  LAMINA_ARMS,
  LAMINA_BASE_BEVEL,
  LAMINA_BASE_H,
  LAMINA_BASE_R,
  LAMINA_COLLAR,
  LAMINA_KNOB,
  LAMINA_LED_W,
  LAMINA_ROD_R,
  LAMINA_SHEET,
  LAMINA_SHEET_BACK,
  LAMINA_SHEET_R,
  LAMINA_SHEET_W,
  LAMINA_TOP,
  TMM_BRACKET,
  TMM_BULB_X,
  TMM_FOOT,
  TMM_LEG,
  TMM_MAST,
  TMM_RING_H,
  TMM_RING_R,
  TMM_SHADE,
  TMM_SHADE_R,
  TMM_SHADE_X,
  TMM_SQUARE_TOP,
  TMM_TOP,
} from '#/scene/decor/floorLampSpecs.ts'
import { useMemo, type ReactNode } from 'react'
import { CatmullRomCurve3, ExtrudeGeometry, Shape, TubeGeometry, Vector2, Vector3 } from 'three'

// The floor lamp styles, each one a Santa & Cole lamp drawn from its
// technical drawing. Every part is in real meters, up from the floor, so the
// numbers can be checked against the drawings. The width slider scales the
// whole lamp, so its shade keeps its shape. The height slider lengthens the
// mast, the rod or the column, and the depth slider the legs that run front
// to back.

type ModelProps = {
  c: (slot: string) => string
  m: (slot: string) => string
  state: LightState | null
  // How much taller and deeper the lamp is than in the drawing, before it is
  // scaled.
  up: number
  out: number
}

// A leg board on edge, running along x from one end to the other, with a
// foot at its outer end and its bottom edge cut back from the given point up
// to that foot. Centered on its thickness along z.
function legGeometry(from: number, to: number, h: number, thick: number, foot: [number, number], cut: number) {
  const [footL, notch] = foot
  const shape = new Shape([
    new Vector2(from, 0),
    new Vector2(cut, 0),
    new Vector2(cut, notch),
    new Vector2(to - footL, notch),
    new Vector2(to - footL, 0),
    new Vector2(to, 0),
    new Vector2(to, h),
    new Vector2(from, h),
  ])
  const geometry = new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false })
  geometry.translate(0, 0, -thick / 2)
  return geometry
}

// A cable as a smooth tube through the given points.
function cableGeometry(points: [number, number, number][], r: number) {
  const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)))
  return new TubeGeometry(curve, SEG * 4, r, 12, false)
}

// TMM

const tmmLeg = (length: number) =>
  legGeometry(TMM_MAST / 2, length, TMM_LEG[1], TMM_LEG[2], TMM_FOOT, TMM_MAST / 2 + 0.02)

// Off the bulb, down the mast side of the shade to the floor, round the
// mast and away behind the foot, as the drawing draws it.
const tmmCable = (shadeBottom: number) =>
  cableGeometry(
    [
      [TMM_BULB_X, shadeBottom, 0],
      [TMM_BULB_X, 0.6, 0],
      [TMM_BULB_X - 0.002, 0.2, 0],
      [0.07, 0.09, 0.03],
      [0, 0.064, 0.045],
      [-0.12, 0.012, 0.05],
      [-0.24, 0.003, 0.05],
    ],
    0.0025,
  )

function Tmm({ c, m, state, up, out }: ModelProps) {
  const wood = <BaseMaterial color={c('stand')} material={m('stand')} />
  const fitting = <Material color={c('fittings')} material={m('fittings')} />
  // A taller TMM has a longer round mast with the shade as far down from its
  // top, and a deeper one longer legs front and back.
  const [shadeBottom, shadeTop] = [TMM_SHADE[0] + up, TMM_SHADE[1] + up]
  const legs = useMemo(() => [tmmLeg(TMM_LEG[0]), tmmLeg(TMM_LEG[0] + out / 2)], [out])
  const cable = useMemo(() => tmmCable(shadeBottom), [shadeBottom])
  const r = TMM_MAST / 2
  return (
    <group>
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} geometry={legs[i % 2]} rotation={[0, (i * Math.PI) / 2, 0]}>
          {wood}
        </mesh>
      ))}
      <mesh position={[0, TMM_SQUARE_TOP / 2, 0]}>
        <boxGeometry args={[TMM_MAST, TMM_SQUARE_TOP, TMM_MAST]} />
        {wood}
      </mesh>
      <mesh position={[0, (TMM_SQUARE_TOP + TMM_TOP + up) / 2, 0]}>
        <cylinderGeometry args={[r, r, TMM_TOP + up - TMM_SQUARE_TOP, SEG * 2]} />
        {wood}
      </mesh>
      {/* The two rings on the mast and the straps from them to the shade. */}
      {[shadeBottom, shadeTop - TMM_RING_H].map(y => (
        <group key={y} position={[0, y + TMM_RING_H / 2, 0]}>
          <mesh userData={{ transmits: true }}>
            <cylinderGeometry args={[TMM_RING_R, TMM_RING_R, TMM_RING_H, SEG * 2]} />
            {fitting}
          </mesh>
          <mesh position={[(TMM_RING_R + TMM_SHADE_X - TMM_SHADE_R) / 2, 0, 0]} userData={{ transmits: true }}>
            <boxGeometry args={[TMM_SHADE_X - TMM_SHADE_R - TMM_RING_R + 0.002, TMM_RING_H, 0.012]} />
            {fitting}
          </mesh>
        </group>
      ))}
      {/* The bracket inside the shade, the holder on its end and the bulb
          standing in it, close to the light, so they let it by. */}
      <mesh position={[(r + TMM_BRACKET[0]) / 2, shadeBottom + 0.002, 0]} userData={{ transmits: true }}>
        <boxGeometry args={[TMM_BRACKET[0] - r, 0.004, TMM_BRACKET[1]]} />
        {fitting}
      </mesh>
      <mesh position={[TMM_BULB_X, shadeBottom + 0.034, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[0.018, 0.018, 0.06, SEG]} />
        {fitting}
      </mesh>
      <mesh position={[TMM_BULB_X, 1.32 + up, 0]} userData={{ transmits: true }}>
        <sphereGeometry args={[0.03, SEG, SEG / 2]} />
        <ShadeMaterial color="#f4f2ee" material="matte" state={state} />
      </mesh>
      <mesh position={[TMM_SHADE_X, (shadeBottom + shadeTop) / 2, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[TMM_SHADE_R, TMM_SHADE_R, shadeTop - shadeBottom, SEG * 4, 1, true]} />
        <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
      </mesh>
      <mesh geometry={cable} userData={{ transmits: true }}>
        <Material color={c('cable')} material={m('cable')} />
      </mesh>
    </group>
  )
}

// FAD

// One of the four staves of the column: a quarter of its round, less half
// of each slot, standing from the floor to the top.
function fadStaveGeometry(top: number) {
  const R = FAD_COLUMN_R
  const s = FAD_SLOT / 2
  const far = Math.sqrt(R * R - s * s)
  const from = Math.asin(s / R)
  const shape = new Shape()
  shape.moveTo(s, s)
  shape.lineTo(far, s)
  shape.absarc(0, 0, R, from, Math.PI / 2 - from, false)
  shape.lineTo(s, s)
  const geometry = new ExtrudeGeometry(shape, { depth: top, bevelEnabled: false, curveSegments: SEG })
  // Stood up: the shape lies across the floor and the depth runs up.
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

// A leg runs right through the column, so its two feet are the same.
function fadLeg(half: number) {
  const shape = new Shape([
    new Vector2(-half, 0),
    new Vector2(-half + FAD_FOOT[0], 0),
    new Vector2(-half + FAD_FOOT[0], FAD_FOOT[1]),
    new Vector2(half - FAD_FOOT[0], FAD_FOOT[1]),
    new Vector2(half - FAD_FOOT[0], 0),
    new Vector2(half, 0),
    new Vector2(half, FAD_LEG[1]),
    new Vector2(-half, FAD_LEG[1]),
  ])
  const geometry = new ExtrudeGeometry(shape, { depth: FAD_LEG[2], bevelEnabled: false })
  geometry.translate(0, 0, -FAD_LEG[2] / 2)
  return geometry
}

// How far the rod slides out of the column, as the real one does. Past that
// the column itself is taller.
const FAD_SLIDE = 0.3

function Fad({ c, m, state, up, out }: ModelProps) {
  const wood = <BaseMaterial color={c('stand')} material={m('stand')} />
  const rod = <Material color={c('rod')} material={m('rod')} />
  const grow = Math.max(up - FAD_SLIDE, 0)
  const columnTop = FAD_COLUMN_TOP + grow
  const stave = useMemo(() => fadStaveGeometry(columnTop), [columnTop])
  // A deeper FAD has a longer leg front to back.
  const legs = useMemo(() => [fadLeg(FAD_LEG[0]), fadLeg(FAD_LEG[0] + out / 2)], [out])
  // The column's middle and top blocks stay at its middle and top.
  const blocks = FAD_BLOCKS.map(([from, to], i) => [from + (grow * i) / 2, to + (grow * i) / 2])
  const [shadeBottom, shadeTop] = [FAD_SHADE[0] + up, FAD_SHADE[1] + up]
  const holder = [FAD_HOLDER[0] + up, FAD_HOLDER[1] + up]
  const [rTop, rBottom] = FAD_SHADE_R
  const across = 2 * Math.sqrt(FAD_COLUMN_R ** 2 - (FAD_SLOT / 2) ** 2)
  const rodFoot = FAD_ROD_FOOT + grow
  const rodTop = holder[0]
  // The spider that holds the shade, level with the holder.
  const spiderY = (holder[0] + holder[1]) / 2
  const spiderR = rBottom + ((rTop - rBottom) * (spiderY - shadeBottom)) / (shadeTop - shadeBottom)
  return (
    <group>
      {[0, 1].map(i => (
        <mesh key={i} geometry={legs[i]} rotation={[0, (i * Math.PI) / 2, 0]}>
          {wood}
        </mesh>
      ))}
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} geometry={stave} rotation={[0, (i * Math.PI) / 2, 0]}>
          {wood}
        </mesh>
      ))}
      {/* The solid blocks that close the slots. */}
      {blocks.map(([from, to]) =>
        [0, 1].map(i => (
          <mesh key={`${from}-${i}`} position={[0, (from + to) / 2, 0]} rotation={[0, (i * Math.PI) / 2, 0]}>
            <boxGeometry args={[across, to - from, FAD_SLOT]} />
            {wood}
          </mesh>
        )),
      )}
      {/* The rod, seen down the slots below the top, and the rubber ring
          that stops it on the column. */}
      <mesh position={[0, (rodFoot + rodTop) / 2, 0]}>
        <cylinderGeometry args={[FAD_ROD_R, FAD_ROD_R, rodTop - rodFoot, SEG]} />
        {rod}
      </mesh>
      <mesh position={[0, columnTop + 0.003, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.009, 0.003, SEG / 2, SEG]} />
        <Material color="#2b2b2b" material="matte" />
      </mesh>
      <mesh position={[0, spiderY, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[0.02, 0.02, holder[1] - holder[0], SEG]} />
        {rod}
      </mesh>
      {[1, 3, 5, 7].map(i => (
        <mesh
          key={i}
          position={[(Math.cos((i * Math.PI) / 4) * spiderR) / 2, spiderY, (Math.sin((i * Math.PI) / 4) * spiderR) / 2]}
          rotation={[0, (-i * Math.PI) / 4, 0]}
          userData={{ transmits: true }}
        >
          <boxGeometry args={[spiderR, 0.002, 0.002]} />
          {rod}
        </mesh>
      ))}
      <mesh position={[0, holder[1] + 0.03, 0]} userData={{ transmits: true }}>
        <sphereGeometry args={[0.03, SEG, SEG / 2]} />
        <ShadeMaterial color="#f4f2ee" material="matte" state={state} />
      </mesh>
      <mesh position={[0, (shadeBottom + shadeTop) / 2, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[rTop, rBottom, shadeTop - shadeBottom, SEG * 4, 1, true]} />
        <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
      </mesh>
    </group>
  )
}

// Lámina 165

const LAMINA_BASE = [
  [0, 0],
  [LAMINA_BASE_R - LAMINA_BASE_BEVEL * 0.8, 0],
  [LAMINA_BASE_R - LAMINA_BASE_BEVEL * 0.15, LAMINA_BASE_BEVEL * 0.4],
  [LAMINA_BASE_R, LAMINA_BASE_BEVEL],
  [LAMINA_BASE_R, LAMINA_BASE_H - 0.002],
  [LAMINA_BASE_R - 0.002, LAMINA_BASE_H],
  [0, LAMINA_BASE_H],
].map(([x, y]) => new Vector2(x, y))

// Its round base has no depth of its own to take, so only its height
// changes: a taller Lámina has a longer rod and sheet.
function Lamina({ c, m, state, up, out }: ModelProps) {
  const black = <Material color={c('structure')} material={m('structure')} />
  const [bottom, top] = [LAMINA_SHEET[0], LAMINA_SHEET[1] + up]
  const arms = [LAMINA_ARMS[0], LAMINA_ARMS[1] + up]
  const h = top - bottom
  // The arc is centered a little in front of the rod, so its deepest
  // point is where the plan draws it. More depth carries the sheet further
  // back from the rod on longer arms.
  const back = LAMINA_SHEET_BACK + out
  const center = LAMINA_SHEET_R - back
  const half = Math.asin(LAMINA_SHEET_W / 2 / LAMINA_SHEET_R)
  const rodH = LAMINA_TOP + up - LAMINA_BASE_H
  return (
    <group>
      <mesh>
        <latheGeometry args={[LAMINA_BASE, Math.round(SEG * 1.5)]} />
        {black}
      </mesh>
      <mesh position={[0, LAMINA_BASE_H + LAMINA_COLLAR[1] / 2, 0]}>
        <cylinderGeometry args={[LAMINA_COLLAR[0], LAMINA_COLLAR[0], LAMINA_COLLAR[1], SEG * 2]} />
        {black}
      </mesh>
      <mesh position={[0, LAMINA_BASE_H + LAMINA_KNOB[2] / 2, LAMINA_KNOB[0]]}>
        <cylinderGeometry args={[LAMINA_KNOB[1], LAMINA_KNOB[1], LAMINA_KNOB[2], SEG * 2]} />
        {black}
      </mesh>
      {/* The rod lets the light by: the LED is on its back. */}
      <mesh position={[0, LAMINA_BASE_H + rodH / 2, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[LAMINA_ROD_R, LAMINA_ROD_R, rodH, SEG * 2]} />
        {black}
      </mesh>
      <mesh position={[0, (bottom + top) / 2, -LAMINA_ROD_R]} userData={{ transmits: true }}>
        <boxGeometry args={[LAMINA_LED_W, h - 0.01, 0.002]} />
        <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} solid />
      </mesh>
      {arms.map(y => (
        <mesh key={y} position={[0, y, -(LAMINA_ROD_R + back) / 2]} userData={{ transmits: true }}>
          <boxGeometry args={[LAMINA_ARM_W, 0.004, back - LAMINA_ROD_R]} />
          {black}
        </mesh>
      ))}
      {/* The sheet: matte white on its hollow, which the LED lights, and
          glossy metal on its back. */}
      <group position={[0, (bottom + top) / 2, center]}>
        <mesh userData={{ transmits: true }}>
          <cylinderGeometry args={[LAMINA_SHEET_R, LAMINA_SHEET_R, h, SEG * 2, 1, true, Math.PI - half, half * 2]} />
          <ShadeMaterial color={c('shade')} material={m('shade')} state={state} solid />
        </mesh>
        <mesh>
          <cylinderGeometry
            args={[LAMINA_SHEET_R + 0.0012, LAMINA_SHEET_R + 0.0012, h, SEG * 2, 1, true, Math.PI - half, half * 2]}
          />
          <Material color={c('back')} material={m('back')} />
        </mesh>
      </group>
    </group>
  )
}

const MODELS: Record<string, (props: ModelProps) => ReactNode> = {
  tmm: Tmm,
  fad: Fad,
  lamina: Lamina,
}

export default function FloorLamp({ style, k, ...props }: ModelProps & { style: string; k: number }) {
  const Model = MODELS[style] ?? Tmm
  const offset = (FLOOR_LAMPS[style] ?? FLOOR_LAMPS.tmm).offset
  return (
    <group scale={k}>
      <group position={[-offset, 0, 0]}>
        <Model {...props} />
      </group>
    </group>
  )
}
