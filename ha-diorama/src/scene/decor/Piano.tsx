import { Leg, Panel, Slab } from '#/scene/decor/parts.tsx'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { ExtrudeGeometry, Matrix4, Quaternion, Shape, Vector3, type InstancedMesh } from 'three'

type Paint = (slot: string, both?: boolean) => ReactNode

type Props = { style: string; w: number; d: number; h: number; paint: Paint }

// Pianos, with the keyboard along x at the front, toward +z. Every style is
// laid out again at the size the sliders give it, and its 88 keys are
// spread along whatever length is left between the cheeks.

// How high the white keys' tops are, as on every acoustic piano.
const KEY_TOP = 0.72
const WHITE_H = 0.022
const BLACK_H = 0.012
// The white keys from A0 up to C8, and the ones a black key follows.
const WHITES = 52
const SHARP_AFTER = new Set([0, 2, 3, 5, 6])

// The keys: one mesh for the white ones and one for the black ones however
// many there are. `front` is where they end toward the player and `depth`
// how far back they reach.
function Keys({ length, depth, front, paint }: { length: number; depth: number; front: number; paint: Paint }) {
  const whites = useRef<InstancedMesh>(null)
  const blacks = useRef<InstancedMesh>(null)
  const sharps = Array.from({ length: WHITES - 1 }, (_, i) => i).filter(i => SHARP_AFTER.has(i % 7))
  useLayoutEffect(() => {
    const white = whites.current
    const black = blacks.current
    if (!white || !black) return
    const keyW = length / WHITES
    const place = new Matrix4()
    const still = new Quaternion()
    for (let i = 0; i < WHITES; i++) {
      place.compose(
        new Vector3(-length / 2 + keyW * (i + 0.5), KEY_TOP - WHITE_H / 2, front - depth / 2),
        still,
        new Vector3(keyW * 0.92, WHITE_H, depth),
      )
      white.setMatrixAt(i, place)
    }
    sharps.forEach((i, k) => {
      place.compose(
        new Vector3(-length / 2 + keyW * (i + 1), KEY_TOP + BLACK_H / 2, front - depth + depth * 0.3),
        still,
        new Vector3(keyW * 0.55, BLACK_H, depth * 0.6),
      )
      black.setMatrixAt(k, place)
    })
    white.instanceMatrix.needsUpdate = true
    black.instanceMatrix.needsUpdate = true
    white.computeBoundingSphere()
    black.computeBoundingSphere()
  })
  return (
    <>
      <instancedMesh ref={whites} args={[undefined, undefined, WHITES]} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        {paint('keys')}
      </instancedMesh>
      <instancedMesh ref={blacks} args={[undefined, undefined, sharps.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        {paint('sharps')}
      </instancedMesh>
    </>
  )
}

// Three pedals side by side, sticking out toward the player.
function Pedals({ y, z, paint }: { y: number; z: number; paint: Paint }) {
  return (
    <>
      {[-1, 0, 1].map(i => (
        <Slab key={i} size={[0.028, 0.012, 0.09]} radius={0.006} bevel={0.003} position={[i * 0.075, y, z + 0.045]}>
          {paint('fittings')}
        </Slab>
      ))}
    </>
  )
}

// An upright: a tall case against the wall, the keys on a bed between two
// cheeks, legs on toe blocks under the cheeks, and the panels above and
// below the keys set into the case.
function Upright({ w, d, h, paint }: Omit<Props, 'style'>) {
  const caseD = Math.min(0.38, d * 0.62)
  const back = -d / 2
  const ahead = d - caseD
  const cheek = Math.min(0.06, w * 0.04)
  const bed = KEY_TOP - WHITE_H
  const length = w - cheek * 2 - 0.02
  const keys = Math.min(0.15, ahead * 0.72)
  const face = back + caseD
  const top = Math.min(h - 0.03, Math.max(h * 0.9, KEY_TOP + 0.2))
  return (
    <group>
      <Slab size={[w, top, caseD]} radius={0.01} bevel={0.004} position={[0, 0, back + caseD / 2]}>
        {paint('case')}
      </Slab>
      <Slab size={[w + 0.02, h - top, caseD + 0.02]} radius={0.012} bevel={0.005} position={[0, top, back + caseD / 2]}>
        {paint('case')}
      </Slab>
      {/* The panel over the keys and its music desk, and the one under them. */}
      <Panel size={[w - cheek * 4, top - KEY_TOP - 0.2, 0.014]} position={[0, KEY_TOP + 0.14, face]} radius={0.01}>
        {paint('case')}
      </Panel>
      <Slab size={[length * 0.7, 0.02, 0.06]} radius={0.006} bevel={0.003} position={[0, KEY_TOP + 0.12, face + 0.03]}>
        {paint('case')}
      </Slab>
      <Panel size={[w - cheek * 4, bed - 0.08 - 0.18, 0.014]} position={[0, 0.16, face]} radius={0.01}>
        {paint('case')}
      </Panel>
      <Slab size={[w, 0.05, ahead]} radius={0.006} bevel={0.003} position={[0, bed - 0.05, face + ahead / 2]}>
        {paint('case')}
      </Slab>
      {[-1, 1].map(s => (
        <group key={s}>
          <Slab
            size={[cheek, 0.05 + WHITE_H + 0.03, ahead]}
            radius={0.008}
            bevel={0.004}
            position={[s * (w / 2 - cheek / 2), bed - 0.05, face + ahead / 2]}
          >
            {paint('case')}
          </Slab>
          <Slab
            size={[0.06, 0.045, ahead]}
            radius={0.008}
            bevel={0.004}
            position={[s * (w / 2 - 0.05), 0, face + ahead / 2]}
          >
            {paint('case')}
          </Slab>
          <Slab
            size={[0.05, bed - 0.05 - 0.045, 0.05]}
            radius={0.01}
            bevel={0.004}
            position={[s * (w / 2 - 0.05), 0.045, d / 2 - 0.045]}
          >
            {paint('case')}
          </Slab>
        </group>
      ))}
      {/* The fallboard, folded back behind the keys. */}
      <Slab size={[length, 0.1, 0.022]} radius={0.004} bevel={0.003} position={[0, bed, face + 0.011]}>
        {paint('case')}
      </Slab>
      <Keys length={length} depth={keys} front={d / 2 - 0.02} paint={paint} />
      <Pedals y={0.07} z={face} paint={paint} />
    </group>
  )
}

// The outline of a grand from above, as a shape for an extrusion: straight
// along the bass side, straight a little way on the treble side, then the
// bent side curving in toward the bass side and round the tail. Shape y is
// minus z, the way a shape extruded and turned onto the floor comes out.
function grandShape(w: number, front: number, tail: number) {
  const run = front - tail
  const x = (share: number) => -w / 2 + w * share
  const z = (share: number) => -(front - run * share)
  const s = new Shape()
  s.moveTo(x(0), z(0))
  s.lineTo(x(1), z(0))
  s.lineTo(x(1), z(0.2))
  // In toward the bass side, then out round the tail.
  s.bezierCurveTo(x(1), z(0.45), x(0.5), z(0.5), x(0.42), z(0.82))
  s.bezierCurveTo(x(0.38), z(1.02), x(0), z(1.02), x(0), z(0.85))
  s.lineTo(x(0), z(0))
  return s
}

function useGrandCase(w: number, front: number, tail: number, height: number) {
  return useMemo(() => {
    const bevel = 0.006
    const geo = new ExtrudeGeometry(grandShape(w - bevel * 2, front - bevel, tail + bevel), {
      depth: Math.max(height - bevel * 2, 0.001),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 32,
    })
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, bevel, 0)
    return geo
  }, [w, front, tail, height])
}

// A grand with its lid down: the curved case on three legs, the keys out
// in front of it between two cheek blocks, and the pedal lyre under it.
function Grand({ w, d, h, paint }: Omit<Props, 'style'>) {
  const ahead = Math.min(0.24, d * 0.18)
  const front = d / 2 - ahead
  const tail = -d / 2
  const under = 0.6
  const lid = 0.025
  const body = useGrandCase(w, front, tail, h - lid - 0.004 - under)
  const cover = useGrandCase(w, front, tail, lid)
  const cheek = Math.min(0.07, w * 0.05)
  const bed = KEY_TOP - WHITE_H
  const length = w - cheek * 2 - 0.02
  const legH = under
  return (
    <group>
      <mesh geometry={body} position={[0, under, 0]} castShadow receiveShadow>
        {paint('case')}
      </mesh>
      <mesh geometry={cover} position={[0, h - lid, 0]} castShadow receiveShadow>
        {paint('case')}
      </mesh>
      <Slab
        size={[w, bed - under, ahead + 0.02]}
        radius={0.006}
        bevel={0.003}
        position={[0, under, front + ahead / 2 - 0.01]}
      >
        {paint('case')}
      </Slab>
      {[-1, 1].map(s => (
        <Slab
          key={s}
          size={[cheek, bed - under + WHITE_H + 0.04, ahead + 0.02]}
          radius={0.01}
          bevel={0.004}
          position={[s * (w / 2 - cheek / 2), under, front + ahead / 2 - 0.01]}
        >
          {paint('case')}
        </Slab>
      ))}
      <Keys length={length} depth={Math.min(0.15, ahead * 0.8)} front={d / 2 - 0.015} paint={paint} />
      {/* Two legs under the keys and one under the tail. */}
      {[
        [-(w / 2 - 0.09), front - 0.08],
        [w / 2 - 0.09, front - 0.08],
        [-w / 2 + w * 0.3, tail + Math.min(0.25, (front - tail) * 0.2)],
      ].map(([x, z]) => (
        <Leg key={`${x}:${z}`} height={legH} top={0.045} bottom={0.032} position={[x, 0, z]}>
          {paint('case')}
        </Leg>
      ))}
      {/* The lyre: two posts down to the pedal box. */}
      {[-1, 1].map(s => (
        <Slab
          key={s}
          size={[0.03, under - 0.06, 0.03]}
          radius={0.008}
          bevel={0.003}
          position={[s * 0.06, 0.06, front - 0.3]}
        >
          {paint('case')}
        </Slab>
      ))}
      <Slab size={[0.26, 0.06, 0.1]} radius={0.012} bevel={0.004} position={[0, 0, front - 0.3]}>
        {paint('case')}
      </Slab>
      <Pedals y={0.03} z={front - 0.3} paint={paint} />
    </group>
  )
}

// A digital piano: the keys in a slim body between two side panels down
// to the floor, a board across the back, a pedal bar and a music rest.
function Digital({ w, d, h, paint }: Omit<Props, 'style'>) {
  const side = 0.035
  const inner = w - side * 2
  const bed = KEY_TOP - WHITE_H
  const keys = Math.min(0.15, d * 0.4)
  const box = Math.max(d - keys - 0.04, 0.05)
  return (
    <group>
      {[-1, 1].map(s => (
        <Slab key={s} size={[side, h, d]} radius={0.008} bevel={0.004} position={[s * (w / 2 - side / 2), 0, 0]}>
          {paint('case')}
        </Slab>
      ))}
      <Slab size={[inner, 0.06, d]} radius={0.006} bevel={0.003} position={[0, bed - 0.06, 0]}>
        {paint('case')}
      </Slab>
      {/* The body behind the keys, up to the top. */}
      <Slab size={[inner, h - bed, box]} radius={0.008} bevel={0.004} position={[0, bed, -d / 2 + box / 2]}>
        {paint('case')}
      </Slab>
      <Slab
        size={[inner * 0.55, 0.2, 0.012]}
        radius={0.004}
        bevel={0.002}
        position={[0, h, -d / 2 + box * 0.55]}
        rotation={[-0.14, 0, 0]}
      >
        {paint('case')}
      </Slab>
      <Slab size={[inner, 0.38, 0.016]} radius={0.004} bevel={0.003} position={[0, 0.16, -d / 2 + 0.06]}>
        {paint('case')}
      </Slab>
      <Slab size={[inner, 0.05, 0.07]} radius={0.006} bevel={0.003} position={[0, 0.02, d / 2 - 0.16]}>
        {paint('case')}
      </Slab>
      <Keys length={inner - 0.02} depth={keys} front={d / 2 - 0.015} paint={paint} />
      <Pedals y={0.075} z={d / 2 - 0.2} paint={paint} />
    </group>
  )
}

export default function Piano({ style, ...props }: Props) {
  if (style === 'grand') return <Grand {...props} />
  if (style === 'digital') return <Digital {...props} />
  return <Upright {...props} />
}
