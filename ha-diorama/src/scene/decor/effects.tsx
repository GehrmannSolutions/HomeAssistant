import { useEased } from '#/scene/decor/ease.ts'
import { scatter } from '#/scene/decor/scatter.ts'
import { useFrame } from '@react-three/fiber'
import { useLive } from '#/scene/live.ts'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  Color,
  LatheGeometry,
  Object3D,
  Vector2,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'

// The moving parts of the pieces that show their state with something
// alive: flames, bulbs, spray, bubbles and drops. Each eases in and out with
// the switch, and is left mounted and hidden while off, so nothing is built
// again when it turns on.

type Vec3 = [number, number, number]

// A flame's outline turned round its axis: a rounded foot, widest a
// quarter of the way up, and a long thin tip. Its base is at the origin, so
// it leans from the burner rather than from its middle.
function flameGeometry() {
  const points: Vector2[] = []
  const steps = 14
  for (let k = 0; k <= steps; k++) {
    const y = k / steps
    const r = y < 0.25 ? 0.5 * Math.sqrt(y / 0.25) : 0.5 * ((1 - y) / 0.75) ** 1.4
    points.push(new Vector2(Math.max(r, 0.0001), y))
  }
  return new LatheGeometry(points, 12)
}

/**
 * A row of flames along x, `width` wide and up to `height` tall. Each
 * tongue is three nested layers, a deep orange outside, orange within and a
 * pale yellow heart low down, and it stretches, shrinks and leans on its own
 * uneven beat, in two staggered rows so the fire has some depth. A glow
 * breathes along the bed under them, and a wood fire throws the odd spark.
 * They add their light to what is behind them, so they glow against a dark
 * firebox, and they sink away when the fire is turned off.
 */
export function Flames({
  on,
  width,
  height,
  count,
  position = [0, 0, 0],
  outer = '#ff4a0a',
  mid = '#ff8a1e',
  inner = '#fff0b0',
  sparks = false,
}: {
  on: boolean
  width: number
  height: number
  count: number
  position?: Vec3
  outer?: string
  mid?: string
  inner?: string
  sparks?: boolean
}) {
  const lit = useEased(on ? 1 : 0, 1.8)
  const tongues = useRef<(Mesh | null)[]>([])
  const bed = useRef<Mesh>(null)
  const embers = useRef<(Mesh | null)[]>([])
  const geometry = useMemo(() => flameGeometry(), [])
  const step = width / count
  const layers = [
    { color: outer, opacity: 0.5, wide: 1, tall: 1 },
    { color: mid, opacity: 0.65, wide: 0.66, tall: 0.78 },
    { color: inner, opacity: 0.85, wide: 0.36, tall: 0.42 },
  ]
  const sparkCount = sparks ? Math.max(3, Math.round(count * 0.7)) : 0
  useLive(lit >= 0.01)
  useFrame(({ clock }) => {
    // Out, and hidden: nothing to move until it is lit again.
    if (lit < 0.01) {
      if (bed.current?.visible) {
        bed.current.visible = false
        for (const m of tongues.current) if (m) m.visible = false
        for (const m of embers.current) if (m) m.visible = false
      }
      return
    }
    const t = clock.elapsedTime
    tongues.current.forEach((m, j) => {
      if (!m) return
      const i = Math.floor(j / 3)
      const layer = layers[j % 3]
      const back = i % 2 === 1
      // A few sines at unrelated rates, so no two tongues and no two
      // seconds look the same, with a sharp lick up now and then.
      const lick = Math.max(0, Math.sin(t * (2.3 + scatter(i, 4)) + i * 5.1)) ** 8 * 0.35
      const beat =
        0.7 +
        0.16 * Math.sin(t * (7 + scatter(i) * 5) + i * 1.7) +
        0.09 * Math.sin(t * 15.7 + i * 3.1) +
        0.05 * Math.sin(t * 23.1 + i * 0.9) +
        lick
      const tall = height * beat * lit * (0.55 + 0.45 * scatter(i, 1)) * (back ? 1.25 : 0.95) * layer.tall
      const r = step * 1.7 * layer.wide * (0.8 + 0.3 * scatter(i, 2))
      m.visible = lit > 0.01
      m.scale.set(r, Math.max(tall, 0.001), r * 0.7)
      m.rotation.z = 0.14 * Math.sin(t * 3.1 + i * 2.3) + 0.06 * Math.sin(t * 8.7 + i)
      m.rotation.x = 0.08 * Math.sin(t * 2.7 + i * 1.3)
      m.position.set(
        -width / 2 + step * (i + 0.5) + (scatter(i, 3) - 0.5) * step * 0.5,
        0,
        (back ? -1 : 1) * step * 0.18 + (j % 3) * 0.002,
      )
    })
    if (bed.current) {
      bed.current.visible = lit > 0.01
      ;(bed.current.material as MeshBasicMaterial).opacity =
        lit * (0.55 + 0.15 * Math.sin(t * 1.9) + 0.1 * Math.sin(t * 4.3))
    }
    embers.current.forEach((m, i) => {
      if (!m) return
      // Each spark rises and dies, then starts again somewhere else.
      const u = t * (0.5 + scatter(i, 6) * 0.4) + scatter(i, 7)
      const f = u % 1
      m.visible = lit > 0.5
      m.position.set(
        -width / 2 + width * scatter(i * 31 + Math.floor(u), 8) + Math.sin(t * 6 + i) * 0.01,
        height * (0.3 + f * 1.3),
        Math.sin(t * 4 + i * 2) * step * 0.2,
      )
      m.scale.setScalar(0.004 * (1 - f))
    })
  })
  return (
    <group position={position}>
      <mesh ref={bed} position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[width / 2, step * 0.9, 1]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial
          color={mid}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {Array.from({ length: count * 3 }, (_, j) => (
        <mesh
          key={j}
          geometry={geometry}
          visible={false}
          ref={el => {
            tongues.current[j] = el
          }}
        >
          <meshBasicMaterial
            color={layers[j % 3].color}
            transparent
            opacity={layers[j % 3].opacity}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {Array.from({ length: sparkCount }, (_, i) => (
        <mesh
          key={i}
          visible={false}
          ref={el => {
            embers.current[i] = el
          }}
        >
          <sphereGeometry args={[1, 6, 4]} />
          <meshBasicMaterial color="#ffb347" blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * A string of warm white fairy lights at `points` that runs through the
 * patterns a light string's controller does, a few seconds each: all on,
 * a random blink, bands climbing the string by height, and every other
 * bulb in turn. Off, the bulbs sit dim and grey.
 */
export function FairyLights({
  on,
  points,
  radius = 0.01,
  color = '#ffc978',
}: {
  on: boolean
  points: Vec3[]
  radius?: number
  color?: string
}) {
  const lit = useEased(on ? 1 : 0, 4)
  const mesh = useRef<InstancedMesh>(null)
  const level = useRef<number[]>([])
  const warm = useMemo(() => new Color(color), [color])
  const dim = useMemo(() => new Color('#4a4844'), [])
  const shade = useMemo(() => new Color(), [])
  // Whether every bulb has been set to its off grey, so a dark string is
  // left alone rather than shaded again every frame.
  const dimmed = useRef(false)
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const dummy = new Object3D()
    points.forEach((at, i) => {
      dummy.position.set(...at)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [points])
  useLive(lit >= 0.01)
  useFrame(({ clock }, delta) => {
    const m = mesh.current
    if (!m) return
    if (lit < 0.01) {
      if (dimmed.current) return
      for (let i = 0; i < points.length; i++) m.setColorAt(i, dim)
      level.current.fill(0)
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      dimmed.current = true
      return
    }
    dimmed.current = false
    const t = clock.elapsedTime
    const pattern = Math.floor(t / 7) % 4
    points.forEach(([, y], i) => {
      let want = 1
      if (pattern === 1) want = scatter(i + Math.floor(t * 2.5 + scatter(i, 42)) * 997, 41) > 0.45 ? 1 : 0
      else if (pattern === 2) want = Math.sin(t * 3 - y * 7) > 0 ? 1 : 0
      else if (pattern === 3) want = (i + Math.floor(t * 1.6)) % 2
      const now = level.current[i] ?? 0
      level.current[i] = now + (want - now) * Math.min(1, delta * 14)
      m.setColorAt(i, shade.lerpColors(dim, warm, lit * level.current[i]))
    })
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  return (
    <instancedMesh key={points.length} ref={mesh} args={[undefined, undefined, points.length]} frustumCulled={false}>
      <sphereGeometry args={[radius, 8, 6]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

/**
 * Water thrown from `lanes` along x, each jet arcing out toward +z to land
 * `reach` away after climbing `apex` above where it left. The droplets fan
 * out across by `spread` as they fly. Turn the group it sits in to aim it.
 */
export function Spray({
  on,
  reach,
  apex,
  lanes = [0],
  spread = 0.1,
  from = 0,
  count = 40,
  speed = 0.9,
  color = '#b9dcf2',
  size = 0.009,
  fan = 0,
}: {
  on: boolean
  reach: number
  apex: number
  lanes?: number[]
  // How much wider the lanes stand apart where the water lands than where
  // it leaves: 1 lands them twice as far apart.
  fan?: number
  spread?: number
  // How high above the ground the water leaves.
  from?: number
  count?: number
  speed?: number
  color?: string
  // The radius of a drop.
  size?: number
}) {
  const lit = useEased(on ? 1 : 0, 3)
  const mesh = useRef<InstancedMesh>(null)
  const total = count * lanes.length
  const dummy = useMemo(() => new Object3D(), [])
  useLive(lit >= 0.01)
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    if (lit < 0.01) {
      if (m.visible) m.visible = false
      return
    }
    const t = clock.elapsedTime
    for (let i = 0; i < total; i++) {
      const f = (t * speed + scatter(i, 4)) % 1
      const far = reach * (0.75 + 0.25 * scatter(i, 5))
      dummy.position.set(
        lanes[i % lanes.length] * (1 + fan * f) + (scatter(i, 6) - 0.5) * spread * 2 * f,
        from * (1 - f) + 4 * apex * f * (1 - f),
        far * f,
      )
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    m.visible = lit > 0.01
    ;(m.material as MeshBasicMaterial).opacity = 0.75 * lit
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, total]} visible={false} frustumCulled={false}>
      <sphereGeometry args={[size, 6, 4]} />
      <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  )
}

/**
 * Bubbles rising through a box `w` by `d` from its floor to `h`, wobbling as
 * they go, from anywhere in it or, with `at`, from a few spots on its floor.
 */
export function Bubbles({
  on,
  w,
  d,
  h,
  count = 30,
  radius = 0.006,
  speed = 0.5,
  at,
  position = [0, 0, 0],
  color = '#f2fbff',
}: {
  on: boolean
  w: number
  d: number
  h: number
  count?: number
  radius?: number
  speed?: number
  at?: [number, number][]
  position?: Vec3
  color?: string
}) {
  const lit = useEased(on ? 1 : 0, 3)
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  useLive(lit >= 0.01)
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    if (lit < 0.01) {
      if (m.visible) m.visible = false
      return
    }
    const t = clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const f = (t * speed * (0.7 + scatter(i, 7) * 0.6) + scatter(i, 8)) % 1
      const spot = at?.[i % at.length]
      const x = spot ? spot[0] : (scatter(i, 9) - 0.5) * w
      const z = spot ? spot[1] : (scatter(i, 10) - 0.5) * d
      const wobble = Math.sin(t * 6 + i) * radius
      dummy.position.set(x + wobble, f * h, z + wobble * 0.6)
      dummy.scale.setScalar(0.6 + f * 0.8)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    m.visible = lit > 0.01
    ;(m.material as MeshBasicMaterial).opacity = 0.7 * lit
  })
  return (
    <group position={position}>
      <instancedMesh ref={mesh} args={[undefined, undefined, count]} visible={false} frustumCulled={false}>
        <sphereGeometry args={[radius, 8, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}

/**
 * Small things falling from each of `points` down `fall`, a few on their
 * way at once: drips from an irrigation line, kibble from a feeder's chute.
 */
export function Falling({
  on,
  points,
  fall,
  size = [0.006, 0.014, 0.006],
  per = 3,
  speed = 0.8,
  color = '#a9d2ee',
  opacity = 0.85,
}: {
  on: boolean
  points: Vec3[]
  fall: number
  size?: Vec3
  per?: number
  speed?: number
  color?: string
  opacity?: number
}) {
  const lit = useEased(on ? 1 : 0, 4)
  const mesh = useRef<InstancedMesh>(null)
  const total = points.length * per
  const dummy = useMemo(() => new Object3D(), [])
  useLive(lit >= 0.01)
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    if (lit < 0.01) {
      if (m.visible) m.visible = false
      return
    }
    const t = clock.elapsedTime
    for (let i = 0; i < total; i++) {
      const p = points[i % points.length]
      const f = (t * speed + scatter(i, 11) + Math.floor(i / points.length) / per) % 1
      // Falling faster as it goes, the way a drop does.
      dummy.position.set(p[0], p[1] - f * f * fall, p[2])
      dummy.rotation.set(scatter(i, 12) * 3, scatter(i, 13) * 3, 0)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    m.visible = lit > 0.01
    ;(m.material as MeshBasicMaterial).opacity = opacity * lit
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, total]} visible={false} frustumCulled={false}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  )
}

/**
 * Turns what it holds about `axis` while `on`: all the way round, or with
 * `arc` back and forth through that many radians in all.
 */
export function Sweep({
  on,
  arc,
  speed = 0.6,
  axis = 'y',
  children,
}: {
  on: boolean
  arc?: number
  speed?: number
  axis?: 'x' | 'y'
  children: ReactNode
}) {
  const ref = useRef<Group>(null)
  const clock = useRef(0)
  useLive(on)
  useFrame((_, delta) => {
    const g = ref.current
    if (!g || !on) return
    clock.current += Math.min(delta, 0.1) * speed
    const angle = arc === undefined ? clock.current : Math.sin(clock.current) * (arc / 2)
    g.rotation[axis] = angle
  })
  return <group ref={ref}>{children}</group>
}
