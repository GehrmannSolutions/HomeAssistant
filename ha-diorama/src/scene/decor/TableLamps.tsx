import { cestitaGlobeProfile } from '#/scene/decor/cestitaGlobe.ts'
import { BaseMaterial, ShadeMaterial, type LightState } from '#/scene/decor/lightMaterials.tsx'
import { Glass, Material, Rod, SEG } from '#/scene/decor/parts.tsx'
import {
  BASICA_COLUMN_R,
  BASICA_COLUMN_TOP,
  BASICA_DISC,
  BASICA_SHADE,
  BASICA_SHADE_R,
  BASICA_SLEEVE_TOP,
  BASICA_STITCH,
  CESTITA_ARCH_FOOT,
  CESTITA_ARCH_BEND,
  CESTITA_ARCH_RUN,
  CESTITA_ARCH_T,
  CESTITA_ARCH_TOP,
  CESTITA_CAP,
  CESTITA_HANDLE_FOOT,
  CESTITA_HANDLE_T,
  CESTITA_HANDLE_TOP,
  CESTITA_HOLDER,
  CESTITA_NECK,
  CESTITA_PIVOT_Y,
  CESTITA_POST,
  CESTITA_POST_R,
  CESTITA_RING,
  CESTITA_RING_R,
  CESTITA_RING_T,
  CESTITA_SHORT_POST,
  CESTITA_STRIP_W,
  CESTITA_TALL_POST,
  IRIS_CENTER,
  IRIS_DOME_R,
  IRIS_FOOT,
  IRIS_R,
  IRIS_THICK,
  IRIS_TILT,
  MAIJA_BALL_R,
  MAIJA_DIFFUSER,
  MAIJA_FOOT_R,
  MAIJA_KNEE_Y,
  MAIJA_PIN_R,
  MAIJA_RING_BOTTOM_R,
  MAIJA_RING_TOP_R,
  MAIJA_RINGS,
  MAIJA_ROD_R,
  MAIJA_SHADE,
  MAIJA_SLOT,
  SYLVESTRINA_DIFFUSER,
  SYLVESTRINA_DISC,
  SYLVESTRINA_DISC_EDGE,
  SYLVESTRINA_FOOT,
  SYLVESTRINA_SLEEVE_TOP,
  SYLVESTRINA_TOP,
  SYLVESTRINA_TUBE_R,
} from '#/scene/decor/tableLampSpecs.ts'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Path,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from 'three'

// The table lamp styles, each one a Santa & Cole lamp drawn from its
// technical drawing. Every part is in real meters, up from the table, so the
// numbers can be checked against the drawings. The size slider scales the
// whole lamp, so its shade or globe keeps its shape, and the height slider
// lengthens the one part that would be longer on a taller lamp: the handle,
// the glass tube, the legs or the column.

type ModelProps = {
  c: (slot: string) => string
  m: (slot: string) => string
  state: LightState | null
  // How much longer that part is than in the drawing, before the lamp is
  // scaled.
  up: number
}

// A lathe profile as three wants it.
function lathe(points: [number, number][]) {
  return points.map(([x, y]) => new Vector2(x, y))
}

// A quarter of an ellipse around a center, from one angle to another, as
// points for a profile.
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = SEG) {
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    points.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
  }
  return points
}

// A flat strip of bent wood following a line in the xy plane: thick across
// the line and wide along z, with square edges and closed ends.
function stripGeometry(line: [number, number][], width: number, thick: number) {
  const positions: number[] = []
  const normals: number[] = []
  const index: number[] = []
  // The unit normal to the line at each point, in its plane.
  const across = line.map((_, i) => {
    const [ax, ay] = line[Math.max(i - 1, 0)]
    const [bx, by] = line[Math.min(i + 1, line.length - 1)]
    const l = Math.hypot(bx - ax, by - ay)
    return [-(by - ay) / l, (bx - ax) / l]
  })
  const w = width / 2
  const t = thick / 2
  const corner = (i: number, s: number, z: number) => [
    line[i][0] + across[i][0] * t * s,
    line[i][1] + across[i][1] * t * s,
    z,
  ]
  // A face along the whole strip between two of its long edges, each given
  // as the side of the line and the z it runs at.
  const face = (a: [number, number], b: [number, number], normal: (i: number) => number[]) => {
    const start = positions.length / 3
    for (const [s, z] of [a, b]) {
      line.forEach((_, i) => {
        positions.push(...corner(i, s, z))
        normals.push(...normal(i))
      })
    }
    const n = line.length
    for (let i = 0; i < n - 1; i++) {
      const [p, q, r, u] = [start + i, start + i + 1, start + n + i + 1, start + n + i]
      index.push(p, q, r, p, r, u)
    }
  }
  face([1, w], [1, -w], i => [across[i][0], across[i][1], 0])
  face([-1, -w], [-1, w], i => [-across[i][0], -across[i][1], 0])
  face([-1, w], [1, w], () => [0, 0, 1])
  face([1, -w], [-1, -w], () => [0, 0, -1])
  // The two cut ends, facing out along the line.
  for (const end of [0, line.length - 1]) {
    const back = line[end === 0 ? 1 : end - 1]
    const out = [line[end][0] - back[0], line[end][1] - back[1]]
    const l = Math.hypot(out[0], out[1])
    const start = positions.length / 3
    for (const [s, z] of [
      [-1, -w],
      [1, -w],
      [1, w],
      [-1, w],
    ]) {
      positions.push(...corner(end, s, z))
      normals.push(out[0] / l, out[1] / l, 0)
    }
    // Both windings, rather than working out which way each end faces.
    index.push(start, start + 1, start + 2, start, start + 2, start + 3)
    index.push(start, start + 2, start + 1, start, start + 3, start + 2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setIndex(index)
  return geometry
}

// A band round the middle: a short tube with a wall and flat edges.
function Band({ r, t, y, children }: { r: number; t: number; y: [number, number]; children: ReactNode }) {
  const h = y[1] - y[0]
  const mid = (y[0] + y[1]) / 2
  return (
    <group position={[0, mid, 0]}>
      <mesh>
        <cylinderGeometry args={[r, r, h, SEG * 4, 1, true]} />
        {children}
      </mesh>
      <mesh>
        <cylinderGeometry args={[r - t, r - t, h, SEG * 4, 1, true]} />
        {children}
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[0, (s * h) / 2, 0]} rotation={[(-s * Math.PI) / 2, 0, 0]}>
          <ringGeometry args={[r - t, r, SEG * 4]} />
          {children}
        </mesh>
      ))}
    </group>
  )
}

// Cestita: an opal globe in a cherry wood cradle. Four posts hold a ring at
// the globe's waist, two arches cross under it for a foot, and a handle
// pivots on the two tall posts, up over the top.

const CESTITA_GLOBE_PROFILE = lathe(cestitaGlobeProfile())

// The handle: straight legs down inside the tall posts and a half circle
// over the top, drawn along its middle.
function cestitaHandle(top: number): [number, number][] {
  const r = CESTITA_RING_R - CESTITA_HANDLE_T / 2
  const cy = top - CESTITA_RING_R
  return [[r, CESTITA_HANDLE_FOOT], ...arc(0, cy, r, r, 0, Math.PI, SEG * 4), [-r, CESTITA_HANDLE_FOOT]]
}

// An arch of the foot: straight up the inside of a post, a tight bend, then
// a gentle slope in to a flat stretch where the two cross under the globe.
function cestitaArch(top: number): [number, number][] {
  const r = CESTITA_RING_R - CESTITA_ARCH_T / 2
  const y = top - CESTITA_ARCH_T / 2
  const [flat, slope] = CESTITA_ARCH_RUN
  const bend = CESTITA_ARCH_BEND
  // The bend is round, tangent to the leg and to the slope.
  const cx = r - bend
  const cy = y + slope * flat - bend * Math.hypot(slope, 1) - slope * cx
  const turn = Math.atan2(1, slope)
  const right: [number, number][] = [[r, CESTITA_ARCH_FOOT], ...arc(cx, cy, bend, bend, 0, turn, SEG * 2), [flat, y]]
  // From the left foot over to the right one.
  return [...right.map(([x, h]): [number, number] => [-x, h]), ...right.reverse()]
}

function Cestita({ c, m, state, up }: ModelProps) {
  // A taller Cestita has longer handle legs.
  const handle = useMemo(
    () => stripGeometry(cestitaHandle(CESTITA_HANDLE_TOP + up), CESTITA_STRIP_W, CESTITA_HANDLE_T),
    [up],
  )
  // The second arch crosses a hair over the first, as the wood does.
  const arches = useMemo(
    () => [0, 0.0012].map(lift => stripGeometry(cestitaArch(CESTITA_ARCH_TOP + lift), CESTITA_STRIP_W, CESTITA_ARCH_T)),
    [],
  )
  const wood = <BaseMaterial color={c('basket')} material={m('basket')} />
  return (
    <group>
      {/* The tall posts carry the handle, on the x axis; the short ones
          stand between them. */}
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((a, i) => {
        const h = i % 2 === 0 ? CESTITA_TALL_POST : CESTITA_SHORT_POST
        return (
          <mesh
            key={a}
            position={[Math.cos(a) * CESTITA_POST_R, h / 2, Math.sin(a) * CESTITA_POST_R]}
            rotation={[0, -a, 0]}
          >
            <boxGeometry args={[CESTITA_POST[0], h, CESTITA_POST[1]]} />
            {wood}
          </mesh>
        )
      })}
      <Band r={CESTITA_RING_R} t={CESTITA_RING_T} y={CESTITA_RING}>
        {wood}
      </Band>
      <mesh geometry={handle}>{wood}</mesh>
      {/* The pivots the handle turns on, outside the tall posts. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (CESTITA_POST_R + 0.0072), CESTITA_PIVOT_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.0045, 0.0045, 0.004, SEG]} />
          {wood}
        </mesh>
      ))}
      {arches.map((geometry, i) => (
        <mesh key={i} geometry={geometry} rotation={[0, (i * Math.PI) / 2, 0]}>
          {wood}
        </mesh>
      ))}
      {/* The globe, its neck and cap, and the lamp holder under it. */}
      <mesh userData={{ transmits: true }}>
        <latheGeometry args={[CESTITA_GLOBE_PROFILE, Math.round(SEG * 1.5)]} />
        <ShadeMaterial color={c('globe')} material={m('globe')} state={state} />
      </mesh>
      <mesh position={[0, (CESTITA_CAP[1] + CESTITA_CAP[2]) / 2, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[CESTITA_CAP[0], CESTITA_CAP[0], CESTITA_CAP[2] - CESTITA_CAP[1], SEG * 2]} />
        <ShadeMaterial color={c('globe')} material={m('globe')} state={state} />
      </mesh>
      <mesh position={[0, (CESTITA_NECK[1] + CESTITA_NECK[2]) / 2, 0]}>
        <cylinderGeometry args={[CESTITA_NECK[0], CESTITA_NECK[0], CESTITA_NECK[2] - CESTITA_NECK[1], SEG * 2]} />
        <BaseMaterial color={c('globe')} material={m('globe')} />
      </mesh>
      <mesh position={[0, (CESTITA_HOLDER[1] + CESTITA_HOLDER[2]) / 2, 0]}>
        <cylinderGeometry args={[CESTITA_HOLDER[0], CESTITA_HOLDER[0], CESTITA_HOLDER[2] - CESTITA_HOLDER[1], SEG]} />
        <BaseMaterial color={c('globe')} material={m('globe')} />
      </mesh>
    </group>
  )
}

// Sylvestrina: a clear glass tube on a glossy disc. A white diffuser stands
// in the bottom half of the tube on the black sleeve it plugs into.

function sylvestrinaDiscProfile(): [number, number][] {
  const [r, top] = SYLVESTRINA_DISC
  const bottom = SYLVESTRINA_FOOT[1]
  const e = SYLVESTRINA_DISC_EDGE
  return [
    [0, bottom],
    ...arc(r - e, bottom + e, e, e, -Math.PI / 2, 0),
    ...arc(r - e, top - e, e, e, 0, Math.PI / 2),
    [0, top],
  ]
}

function sylvestrinaTubeProfile(top: number): [number, number][] {
  // Open at the bottom, with the top edge just softened.
  const r = SYLVESTRINA_TUBE_R
  const e = 0.002
  return [[r, SYLVESTRINA_SLEEVE_TOP], ...arc(r - e, top - e, e, e, 0, Math.PI / 2), [0, top]]
}

const SYLVESTRINA_DISC_PROFILE = lathe(sylvestrinaDiscProfile())

function Sylvestrina({ c, m, state, up }: ModelProps) {
  const [footR, footH] = SYLVESTRINA_FOOT
  const discTop = SYLVESTRINA_DISC[1]
  // A taller Sylvestrina has a longer tube and diffuser.
  const tube = useMemo(() => lathe(sylvestrinaTubeProfile(SYLVESTRINA_TOP + up)), [up])
  const diffuserR = SYLVESTRINA_DIFFUSER[0]
  const diffuserTop = SYLVESTRINA_DIFFUSER[1] + up
  const base = <BaseMaterial color={c('base')} material={m('base')} />
  return (
    <group>
      <mesh position={[0, footH / 2, 0]}>
        <cylinderGeometry args={[footR, footR, footH, SEG * 4]} />
        {base}
      </mesh>
      <mesh>
        <latheGeometry args={[SYLVESTRINA_DISC_PROFILE, Math.round(SEG * 1.5)]} />
        {base}
      </mesh>
      <mesh position={[0, (discTop + SYLVESTRINA_SLEEVE_TOP) / 2, 0]}>
        <cylinderGeometry args={[SYLVESTRINA_TUBE_R, SYLVESTRINA_TUBE_R, SYLVESTRINA_SLEEVE_TOP - discTop, SEG * 2]} />
        {base}
      </mesh>
      <mesh position={[0, (SYLVESTRINA_SLEEVE_TOP + diffuserTop) / 2, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[diffuserR, diffuserR, diffuserTop - SYLVESTRINA_SLEEVE_TOP, SEG * 2]} />
        <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} />
      </mesh>
      {/* Drawn last, so the lit diffuser, which turns see through as well,
          still shows behind the glass. */}
      <mesh userData={{ transmits: true }} renderOrder={1}>
        <latheGeometry args={[tube, SEG]} />
        <Glass color={c('glass')} />
      </mesh>
    </group>
  )
}

// Maija 15: fourteen white metal rings stacked into a shade, each one's top
// tucked into the flare of the one above, so the light leaks out between
// them. A slotted plate closes the top, and three brass rods come down out of
// the shade and bend out to ball feet.

function maijaPlate() {
  const shape = new Shape()
  shape.absarc(0, 0, MAIJA_RING_TOP_R, 0, Math.PI * 2, false)
  // Three arc slots, between the three pins.
  const [inner, outer] = MAIJA_SLOT
  const half = (Math.PI / 180) * 32
  for (let i = 0; i < 3; i++) {
    const mid = Math.PI / 6 + (i * Math.PI * 2) / 3
    const slot = new Path()
    slot.absarc(0, 0, outer, mid - half, mid + half, false)
    slot.absarc(0, 0, inner, mid + half, mid - half, true)
    slot.closePath()
    shape.holes.push(slot)
  }
  return shape
}

const MAIJA_PLATE = maijaPlate()

// The feet sit under the pins, one of them toward the front. Each rod comes
// straight down out of the shade to a knee, then out to its ball. A shade
// set lower brings the knees down with it.
const MAIJA_ANGLES = [0, 1, 2].map(i => Math.PI / 2 + (i * Math.PI * 2) / 3)
function maijaFeet(bottom: number) {
  const knee = Math.min(MAIJA_KNEE_Y, bottom - 0.01)
  return MAIJA_ANGLES.map(a => {
    const at = (r: number, y: number) => new Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
    return {
      top: at(MAIJA_PIN_R, bottom + 0.012),
      knee: at(MAIJA_PIN_R, knee),
      ball: at(MAIJA_FOOT_R, MAIJA_BALL_R),
    }
  })
}

function Maija({ c, m, state, up }: ModelProps) {
  // A taller Maija stands its shade higher on longer legs.
  const [bottom, top] = [MAIJA_SHADE[0] + up, MAIJA_SHADE[1] + up]
  const feet = useMemo(() => maijaFeet(bottom), [bottom])
  const ring = (top - bottom) / MAIJA_RINGS
  const diffuserR = MAIJA_DIFFUSER[0]
  const [diffuserBottom, diffuserTop] = [MAIJA_DIFFUSER[1] + up, MAIJA_DIFFUSER[2] + up]
  const brass = <BaseMaterial color={c('feet')} material={m('feet')} />
  return (
    <group>
      {Array.from({ length: MAIJA_RINGS }, (_, i) => (
        <mesh key={i} position={[0, top - ring * (i + 0.5), 0]}>
          <cylinderGeometry args={[MAIJA_RING_TOP_R, MAIJA_RING_BOTTOM_R, ring, SEG * 4, 1, true]} />
          <ShadeMaterial color={c('shade')} material={m('shade')} state={state} solid />
        </mesh>
      ))}
      <mesh position={[0, top, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[MAIJA_PLATE, SEG * 2]} />
        <Material color={c('shade')} material={m('shade')} doubleSide />
      </mesh>
      {MAIJA_ANGLES.map(a => (
        <mesh key={a} position={[Math.cos(a) * MAIJA_PIN_R, top + 0.003, Math.sin(a) * MAIJA_PIN_R]}>
          <cylinderGeometry args={[0.003, 0.003, 0.006, SEG]} />
          {brass}
        </mesh>
      ))}
      <mesh position={[0, (diffuserBottom + diffuserTop) / 2, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[diffuserR, diffuserR, diffuserTop - diffuserBottom, SEG * 4]} />
        <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} />
      </mesh>
      {feet.map((foot, i) => (
        <group key={i}>
          <Rod from={foot.top} to={foot.knee} r={MAIJA_ROD_R}>
            {brass}
          </Rod>
          <Rod from={foot.knee} to={foot.ball} r={MAIJA_ROD_R}>
            {brass}
          </Rod>
          <mesh position={foot.knee}>
            <sphereGeometry args={[MAIJA_ROD_R, SEG, SEG / 2]} />
            {brass}
          </mesh>
          <mesh position={foot.ball}>
            <sphereGeometry args={[MAIJA_BALL_R, SEG, SEG / 2]} />
            {brass}
          </mesh>
        </group>
      ))}
    </group>
  )
}

// Básica Mínima: a parchment shade, a little narrower at the top, laced over
// both rims, on a birch column with a bronze sleeve and a bronze disc.

function Stitches({ y, r, lean, c, m }: { y: number; r: number; lean: number; c: string; m: string }) {
  const mesh = useRef<InstancedMesh>(null)
  const count = Math.round((Math.PI * 2 * r) / BASICA_STITCH)
  // Each stitch shows on the outside and the inside, running from the rim
  // toward the middle of the shade.
  const into = y > BASICA_SHADE[0] ? -1 : 1
  useLayoutEffect(() => {
    const stitches = mesh.current
    if (!stitches) return
    const place = new Matrix4()
    const turn = new Quaternion()
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), lean)
    const up = new Vector3(0, 1, 0)
    const one = new Vector3(1, 1, 1)
    const length = 0.008
    const shift = Math.tan(lean) * (length / 2) * into
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      turn.setFromAxisAngle(up, -a).multiply(tilt)
      for (const side of [-1, 1]) {
        const rr = r - shift + side * 0.0005
        place.compose(new Vector3(Math.cos(a) * rr, y + (into * length) / 2, Math.sin(a) * rr), turn, one)
        stitches.setMatrixAt(i * 2 + (side + 1) / 2, place)
      }
    }
    stitches.instanceMatrix.needsUpdate = true
    stitches.computeBoundingSphere()
  }, [count, y, r, lean, into])
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, count * 2]}>
        <boxGeometry args={[0.0006, 0.008, 0.0014]} />
        <BaseMaterial color={c} material={m} />
      </instancedMesh>
      {/* Where the lacing wraps over the edge. */}
      <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r, 0.0008, 6, SEG * 4]} />
        <BaseMaterial color={c} material={m} />
      </mesh>
    </>
  )
}

function BasicaMinima({ c, m, state, up }: ModelProps) {
  const [discR, discH] = BASICA_DISC
  // A taller Básica Mínima has a longer column, with the shade on top.
  const columnTop = BASICA_COLUMN_TOP + up
  const [shadeBottom, shadeTop] = [BASICA_SHADE[0] + up, BASICA_SHADE[1] + up]
  const [rBottom, rTop] = BASICA_SHADE_R
  const shadeH = shadeTop - shadeBottom
  const lean = Math.atan((rBottom - rTop) / shadeH)
  const bronze = <BaseMaterial color={c('base')} material={m('base')} />
  return (
    <group>
      <mesh position={[0, discH / 2, 0]}>
        <cylinderGeometry args={[discR, discR, discH, SEG * 4]} />
        {bronze}
      </mesh>
      <mesh position={[0, (discH + BASICA_SLEEVE_TOP) / 2, 0]}>
        <cylinderGeometry
          args={[BASICA_COLUMN_R + 0.0003, BASICA_COLUMN_R + 0.0003, BASICA_SLEEVE_TOP - discH, SEG * 2]}
        />
        {bronze}
      </mesh>
      <mesh position={[0, (BASICA_SLEEVE_TOP + columnTop) / 2, 0]}>
        <cylinderGeometry args={[BASICA_COLUMN_R, BASICA_COLUMN_R, columnTop - BASICA_SLEEVE_TOP, SEG * 2]} />
        <BaseMaterial color={c('column')} material={m('column')} />
      </mesh>
      {/* The E14 holder on top of the column and the bulb in it, close
          under the light, so they let it by. */}
      <mesh position={[0, columnTop + 0.01, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[0.0115, 0.0115, 0.02, SEG]} />
        {bronze}
      </mesh>
      <mesh position={[0, columnTop + 0.042, 0]} userData={{ transmits: true }}>
        <sphereGeometry args={[0.018, SEG, SEG / 2]} />
        <ShadeMaterial color="#f4f2ee" material="matte" state={state} />
      </mesh>
      <mesh position={[0, shadeBottom + shadeH / 2, 0]} userData={{ transmits: true }}>
        <cylinderGeometry args={[rTop, rBottom, shadeH, SEG * 4, 1, true]} />
        <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
      </mesh>
      <Stitches y={shadeTop} r={rTop} lean={lean} c={c('stitching')} m={m('stitching')} />
      <Stitches y={shadeBottom} r={rBottom} lean={lean} c={c('stitching')} m={m('stitching')} />
    </group>
  )
}

// Hue Iris: a disc tilted back on a small round foot, its face an opal dome
// in a ring of frosted glass that both light up in the lamp's color, and a
// white shell closing it behind. Both stay solid when lit, since the light
// fills them rather than shining through from a bulb. A taller one stands
// higher on its foot.

function Iris({ c, m, state, up }: ModelProps) {
  const [footR, footH] = IRIS_FOOT
  const center = IRIS_CENTER + up
  const t = IRIS_THICK
  // The disc's lower edge, where it rests in the foot, as the tilt puts it.
  const lowZ = (-IRIS_R * 0.55 + -t * 0.2) * Math.sin(IRIS_TILT)
  return (
    <group>
      <mesh position={[0, footH / 2, lowZ - 0.01]}>
        <cylinderGeometry args={[footR, footR * 1.04, footH, SEG * 2]} />
        <BaseMaterial color={c('body')} material={m('body')} />
      </mesh>
      {/* The neck from the foot up into the back of the shell. */}
      <mesh position={[0, (footH + center) / 2, lowZ - 0.015]} rotation={[-IRIS_TILT * 0.5, 0, 0]}>
        <cylinderGeometry args={[0.014, 0.018, center - footH, SEG]} />
        <BaseMaterial color={c('body')} material={m('body')} />
      </mesh>
      <group position={[0, center, 0]} rotation={[-IRIS_TILT, 0, 0]}>
        {/* The shell, a shallow dish behind the glass. */}
        <mesh position={[0, 0, -t / 2]} scale={[1, 1, 0.42]}>
          <sphereGeometry args={[IRIS_R * 0.94, SEG * 2, SEG]} />
          <BaseMaterial color={c('body')} material={m('body')} />
        </mesh>
        {/* The frosted ring round the face, and the dome in it. */}
        <mesh rotation={[Math.PI / 2, 0, 0]} userData={{ transmits: true }}>
          <cylinderGeometry args={[IRIS_R, IRIS_R, t, SEG * 3]} />
          <ShadeMaterial color={c('ring')} material={m('ring')} state={state} solid />
        </mesh>
        <mesh
          position={[0, 0, t / 2 - 0.004]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[1, 0.3, 1]}
          userData={{ transmits: true }}
        >
          <sphereGeometry args={[IRIS_DOME_R, SEG * 2, SEG, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} solid />
        </mesh>
      </group>
    </group>
  )
}

const MODELS: Record<string, (props: ModelProps) => ReactNode> = {
  cestita: Cestita,
  sylvestrina: Sylvestrina,
  maija: Maija,
  basica_minima: BasicaMinima,
  iris: Iris,
}

export default function TableLamp({ style, k, ...props }: ModelProps & { style: string; k: number }) {
  const Model = MODELS[style] ?? Cestita
  return (
    <group scale={k}>
      <Model {...props} />
    </group>
  )
}
