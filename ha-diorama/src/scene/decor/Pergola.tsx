import type { ReactNode } from 'react'

// A pleated pergola awning, after the Gennius Pergola 110: two guide rails
// run from a head on the wall out to two posts on the floor, falling a
// little so rain runs off, and the cloth runs along them on cross bars.
// Between two bars the cloth hangs in a fold, deep when the bars are
// bunched up at the wall and pulled nearly flat when they are spread out.

// How far the rails fall along their length, in radians.
const PITCH = 0.1
// The head on the wall the rails start from.
const HEAD = { h: 0.16, d: 0.2 }

export default function PergolaAwning({
  w,
  reach,
  floor,
  out,
  canopy,
  frame,
}: {
  w: number
  // How far the rails reach out from the wall.
  reach: number
  // How far below the top of the head the floor is.
  floor: number
  out: number
  canopy: ReactNode
  frame: ReactNode
}) {
  const bars = Math.max(2, Math.round(reach / 0.45))
  // The cloth between two bars, laid flat.
  const cloth = reach / bars
  // Where the bars are along the rails: the first stays at the head and
  // the others spread out with the front one.
  const run = Math.max(0.04, reach * out)
  const at = (i: number) => (run * i) / bars
  const span = w - 0.14
  const railX = w / 2 - 0.035
  const endY = -HEAD.h / 2 - reach * Math.sin(PITCH)
  const endZ = HEAD.d + reach * Math.cos(PITCH)
  const post = floor + endY
  return (
    <group>
      <mesh position={[0, -HEAD.h / 2, HEAD.d / 2]} castShadow>
        <boxGeometry args={[w, HEAD.h, HEAD.d]} />
        {frame}
      </mesh>
      {/* Everything that runs along the rails, in the rails' own frame:
          z out along them and y square to them. */}
      <group position={[0, -HEAD.h / 2, HEAD.d]} rotation={[PITCH, 0, 0]}>
        {[-1, 1].map(s => (
          <mesh key={s} position={[s * railX, 0, reach / 2]} castShadow>
            <boxGeometry args={[0.07, 0.12, reach]} />
            {frame}
          </mesh>
        ))}
        {Array.from({ length: bars + 1 }, (_, i) => (
          <mesh key={i} position={[0, 0.02, at(i) + 0.02]}>
            <boxGeometry args={[span, i === bars ? 0.06 : 0.03, 0.04]} />
            {frame}
          </mesh>
        ))}
        {/* Each fold is two panels meeting in a crease below the bars. */}
        {Array.from({ length: bars }, (_, i) => {
          const gap = at(i + 1) - at(i)
          const drop = Math.sqrt(Math.max(0, (cloth / 2) ** 2 - (gap / 2) ** 2))
          const tilt = Math.atan2(drop, gap / 2)
          const mid = (at(i) + at(i + 1)) / 2 + 0.02
          return [-1, 1].map(side => (
            <mesh
              key={`${i}:${side}`}
              position={[0, 0.03 - drop / 2, mid + (side * gap) / 4]}
              rotation={[side * tilt, 0, 0]}
              castShadow
            >
              <boxGeometry args={[span, 0.004, cloth / 2]} />
              {canopy}
            </mesh>
          ))
        })}
      </group>
      {/* The posts at the front, down to the floor, and their feet. */}
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh position={[s * railX, endY - post / 2, endZ]} castShadow>
            <boxGeometry args={[0.07, post, 0.07]} />
            {frame}
          </mesh>
          <mesh position={[s * railX, -floor + 0.005, endZ]}>
            <boxGeometry args={[0.14, 0.01, 0.14]} />
            {frame}
          </mesh>
        </group>
      ))}
    </group>
  )
}
