import { BaseMaterial, ShadeMaterial, type LightState } from '#/scene/decor/lightMaterials.tsx'
import { SEG } from '#/scene/decor/parts.tsx'
import { CEILING_HEIGHT_M } from '#/theme.ts'

// The ceiling light styles that sit on the ceiling rather than in it. Every
// part hangs down from the ceiling, r is the light's radius and drop how far
// below the ceiling its lowest point is.

type Props = {
  style: string
  r: number
  drop: number
  c: (slot: string) => string
  m: (slot: string) => string
  state: LightState | null
}

export default function FlushLight({ style, r, drop, c, m, state }: Props) {
  const ceiling = CEILING_HEIGHT_M
  if (style === 'dome') {
    // A half globe of opal glass, flattened, on a thin ring against the
    // ceiling.
    return (
      <group>
        <mesh position={[0, ceiling - 0.006, 0]}>
          <cylinderGeometry args={[r * 1.04, r * 1.04, 0.012, SEG * 2]} />
          <BaseMaterial color={c('rim')} material={m('rim')} />
        </mesh>
        <mesh position={[0, ceiling - 0.012, 0]} scale={[1, drop / r, 1]} userData={{ transmits: true }}>
          <sphereGeometry args={[r, SEG * 2, SEG, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <ShadeMaterial color={c('globe')} material={m('globe')} state={state} />
        </mesh>
      </group>
    )
  }
  if (style === 'drum') {
    // A linen drum tight to the ceiling, closed underneath by an opal disc
    // set a little up inside its rim.
    return (
      <group>
        <mesh position={[0, ceiling - 0.004, 0]}>
          <cylinderGeometry args={[r * 0.3, r * 0.3, 0.008, SEG]} />
          <BaseMaterial color={c('rim')} material={m('rim')} />
        </mesh>
        <mesh position={[0, ceiling - drop / 2, 0]} userData={{ transmits: true }}>
          <cylinderGeometry args={[r, r, drop, SEG * 2, 1, true]} />
          <ShadeMaterial color={c('shade')} material={m('shade')} state={state} />
        </mesh>
        <mesh position={[0, ceiling - drop + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]} userData={{ transmits: true }}>
          <circleGeometry args={[r * 0.98, SEG * 2]} />
          <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} solid />
        </mesh>
      </group>
    )
  }
  // A surface spot: a can hanging from the ceiling with its light set into
  // the bottom.
  return (
    <group>
      <mesh position={[0, ceiling - drop / 2, 0]}>
        <cylinderGeometry args={[r, r, drop, SEG * 2]} />
        <BaseMaterial color={c('body')} material={m('body')} />
      </mesh>
      <mesh position={[0, ceiling - drop - 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} userData={{ transmits: true }}>
        <circleGeometry args={[r * 0.7, SEG * 2]} />
        <ShadeMaterial color={c('focus')} material={m('focus')} state={state} solid />
      </mesh>
    </group>
  )
}
