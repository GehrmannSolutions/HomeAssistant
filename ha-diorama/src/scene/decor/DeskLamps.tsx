import { BaseMaterial, ShadeMaterial, TintedGlassMaterial, type LightState } from '#/scene/decor/lightMaterials.tsx'
import { Rod, SEG, Slab } from '#/scene/decor/parts.tsx'
import {
  ARM_BULB,
  ARM_CAP_R,
  ARM_FOOT,
  ARM_FOOT_STEP,
  ARM_FOOT_Z,
  ARM_KNUCKLE_R,
  ARM_LOWER,
  ARM_LOWER_LEAN,
  ARM_PIVOT_Y,
  ARM_ROD_GAP,
  ARM_ROD_R,
  ARM_SHADE,
  ARM_SHADE_TILT,
  ARM_SPRING_R,
  ARM_SPRING_RUN,
  ARM_UPPER,
  ARM_UPPER_TILT,
  BANKER_CHAIN,
  BANKER_FOOT,
  BANKER_FOOT_Z,
  BANKER_SHADE,
  BANKER_SHADE_AT,
  BANKER_SHADE_TILT,
  BANKER_STEM_R,
  BANKER_STEM_TOP,
  BANKER_STEM_Z,
} from '#/scene/decor/deskLampSpecs.ts'
import type { ReactNode } from 'react'
import { Vector3 } from 'three'

// The desk lamp styles. Every part is in meters, up from the desk, and the
// lamp stands in a square round its origin with its light toward the front.
// The size slider scales the whole lamp and the height slider lengthens the
// lower arm or the stem.

type ModelProps = {
  c: (slot: string) => string
  m: (slot: string) => string
  state: LightState | null
  // How much longer the lower arm or the stem is than its usual length,
  // before the lamp is scaled.
  up: number
}

// A pin across the arms where they turn, along x.
function Knuckle({ at, children }: { at: Vector3; children: ReactNode }) {
  return (
    <mesh position={at} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[ARM_KNUCKLE_R, ARM_KNUCKLE_R, ARM_ROD_GAP + 0.016, SEG]} />
      {children}
    </mesh>
  )
}

function BalancedArm({ c, m, state, up }: ModelProps) {
  const pivot = new Vector3(0, ARM_PIVOT_Y, ARM_FOOT_Z)
  const lower = new Vector3(0, Math.cos(ARM_LOWER_LEAN), -Math.sin(ARM_LOWER_LEAN))
  const elbow = pivot.clone().addScaledVector(lower, ARM_LOWER + up)
  const head = elbow
    .clone()
    .addScaledVector(new Vector3(0, Math.cos(ARM_UPPER_TILT), Math.sin(ARM_UPPER_TILT)), ARM_UPPER)
  const arm = <BaseMaterial color={c('arms')} material={m('arms')} />
  const foot = <BaseMaterial color={c('base')} material={m('base')} />
  const [neck, mouth, length] = ARM_SHADE
  const side = (x: number) => new Vector3(x, 0, 0)
  return (
    <group>
      <mesh position={[0, ARM_FOOT[1] / 2, ARM_FOOT_Z]}>
        <cylinderGeometry args={[ARM_FOOT[0] * 0.96, ARM_FOOT[0], ARM_FOOT[1], SEG * 2]} />
        {foot}
      </mesh>
      <mesh position={[0, ARM_FOOT[1] + ARM_FOOT_STEP[1] / 2, ARM_FOOT_Z]}>
        <cylinderGeometry args={[ARM_FOOT_STEP[0] * 0.9, ARM_FOOT_STEP[0], ARM_FOOT_STEP[1], SEG * 2]} />
        {foot}
      </mesh>
      {/* The block the lower arm turns on. */}
      <mesh position={[0, (ARM_FOOT[1] + ARM_FOOT_STEP[1] + ARM_PIVOT_Y) / 2, ARM_FOOT_Z]}>
        <boxGeometry args={[ARM_ROD_GAP + 0.01, ARM_PIVOT_Y - ARM_FOOT[1] - ARM_FOOT_STEP[1] + 0.006, 0.026]} />
        {arm}
      </mesh>
      <Knuckle at={pivot}>{arm}</Knuckle>
      <Knuckle at={elbow}>{arm}</Knuckle>
      <Knuckle at={head}>{arm}</Knuckle>
      {[-1, 1].map(s => (
        <group key={s}>
          <Rod
            from={pivot.clone().add(side((s * ARM_ROD_GAP) / 2))}
            to={elbow.clone().add(side((s * ARM_ROD_GAP) / 2))}
            r={ARM_ROD_R}
          >
            {arm}
          </Rod>
          <Rod
            from={elbow.clone().add(side((s * ARM_ROD_GAP) / 2))}
            to={head.clone().add(side((s * ARM_ROD_GAP) / 2))}
            r={ARM_ROD_R}
          >
            {arm}
          </Rod>
          {/* The springs that balance it, outside the lower rods. */}
          <Rod
            from={pivot
              .clone()
              .addScaledVector(lower, ARM_SPRING_RUN[0])
              .add(side(s * ARM_ROD_GAP))}
            to={pivot
              .clone()
              .addScaledVector(lower, (ARM_LOWER + up) * ARM_SPRING_RUN[1])
              .add(side(s * ARM_ROD_GAP))}
            r={ARM_SPRING_R}
          >
            {arm}
          </Rod>
        </group>
      ))}
      {/* The shade, tipped forward off the head. */}
      <group position={head} rotation={[-ARM_SHADE_TILT, 0, 0]}>
        <mesh position={[0, -0.004, 0]}>
          <sphereGeometry args={[ARM_CAP_R, SEG, SEG / 2, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <BaseMaterial color={c('shade')} material={m('shade')} />
        </mesh>
        <mesh position={[0, -length / 2, 0]}>
          <cylinderGeometry args={[neck, mouth, length, SEG * 2, 1, true]} />
          <BaseMaterial color={c('shade')} material={m('shade')} />
        </mesh>
        {/* The inside, which the bulb lights. */}
        <mesh position={[0, -length / 2 - 0.001, 0]} userData={{ transmits: true }}>
          <cylinderGeometry args={[neck - 0.002, mouth - 0.002, length, SEG * 2, 1, true]} />
          <ShadeMaterial color={c('inside')} material="matte" state={state} solid />
        </mesh>
        <mesh position={[0, -ARM_BULB[0], 0]} userData={{ transmits: true }}>
          <sphereGeometry args={[ARM_BULB[1], SEG, SEG / 2]} />
          <ShadeMaterial color="#f4f2ee" material="matte" state={state} />
        </mesh>
      </group>
    </group>
  )
}

function Banker({ c, m, state, up }: ModelProps) {
  const [footW, footH, footD] = BANKER_FOOT
  const [length, r, glass] = BANKER_SHADE
  const shadeY = BANKER_SHADE_AT[0] + up
  const stemTop = BANKER_STEM_TOP + up
  const brass = <BaseMaterial color={c('base')} material={m('base')} />
  return (
    <group>
      <Slab size={[footW, footH, footD]} radius={0.03} bevel={0.008} position={[0, 0, BANKER_FOOT_Z]}>
        {brass}
      </Slab>
      <mesh position={[0, footH + 0.008, BANKER_STEM_Z]}>
        <cylinderGeometry args={[0.018, 0.024, 0.016, SEG]} />
        {brass}
      </mesh>
      <mesh position={[0, (footH + stemTop) / 2, BANKER_STEM_Z]}>
        <cylinderGeometry args={[BANKER_STEM_R, BANKER_STEM_R, stemTop - footH, SEG]} />
        {brass}
      </mesh>
      {/* The bracket from the top of the stem over to the shade. */}
      <Rod
        from={new Vector3(0, stemTop, BANKER_STEM_Z)}
        to={new Vector3(0, shadeY + r * 0.7, BANKER_SHADE_AT[1])}
        r={BANKER_STEM_R * 0.8}
      >
        {brass}
      </Rod>
      <mesh position={[0, stemTop, BANKER_STEM_Z]}>
        <sphereGeometry args={[BANKER_STEM_R * 1.6, SEG, SEG / 2]} />
        {brass}
      </mesh>
      <group position={[0, shadeY, BANKER_SHADE_AT[1]]} rotation={[BANKER_SHADE_TILT, 0, 0]}>
        {/* The green glass outside and the white glass inside, half round
            along x and open underneath, closed at both ends. */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[r, r, length, SEG * 2, 1, true, 0, Math.PI]} />
          <TintedGlassMaterial color={c('shade')} material={m('shade')} state={state} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} userData={{ transmits: true }}>
          <cylinderGeometry args={[r - glass, r - glass, length - glass, SEG * 2, 1, true, 0, Math.PI]} />
          <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} solid />
        </mesh>
        {/* Each end green outside and white inside, like the rest of it. */}
        {[-1, 1].map(s => (
          <group key={s}>
            <mesh position={[(s * length) / 2, 0, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
              <circleGeometry args={[r, SEG, 0, Math.PI]} />
              <TintedGlassMaterial color={c('shade')} material={m('shade')} state={state} />
            </mesh>
            <mesh
              position={[(s * (length - glass)) / 2, 0, 0]}
              rotation={[0, (-s * Math.PI) / 2, 0]}
              userData={{ transmits: true }}
            >
              <circleGeometry args={[r - glass, SEG, 0, Math.PI]} />
              <ShadeMaterial color={c('diffuser')} material={m('diffuser')} state={state} solid />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.012, 0]} userData={{ transmits: true }}>
          <sphereGeometry args={[0.02, SEG, SEG / 2]} />
          <ShadeMaterial color="#f4f2ee" material="matte" state={state} />
        </mesh>
        {/* The pull chain and its bead. */}
        <Rod
          from={new Vector3(length * 0.18, 0, r * 0.3)}
          to={new Vector3(length * 0.18, -BANKER_CHAIN, r * 0.3)}
          r={0.0012}
        >
          {brass}
        </Rod>
        <mesh position={[length * 0.18, -BANKER_CHAIN, r * 0.3]}>
          <sphereGeometry args={[0.005, SEG / 2, SEG / 4]} />
          {brass}
        </mesh>
      </group>
    </group>
  )
}

const MODELS: Record<string, (props: ModelProps) => ReactNode> = {
  balanced_arm: BalancedArm,
  banker: Banker,
}

export default function DeskLamp({ style, k, ...props }: ModelProps & { style: string; k: number }) {
  const Model = MODELS[style] ?? BalancedArm
  return (
    <group scale={k}>
      <Model {...props} />
    </group>
  )
}
