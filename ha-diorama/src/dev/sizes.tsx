// Renders every kind and style once at its defaults and once with each size
// parameter at its largest, and measures what changed: which parameters the
// model read at all, how far its bounding box grew, and which large meshes
// kept their size while the whole grew. Served by the dev server, never
// built into the card:
//
//   http://localhost:5174/src/dev/sizes.html
//
// window.sizes holds the findings once the page says it is done.
import { DECORATION_KINDS, paramValue, styleParams, type DecorationKind } from '#/decoration/catalog.ts'
import DecorationModel from '#/scene/decor/DecorationModel.tsx'
import type { DecorationConfig } from '#/types.ts'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Box3, Mesh, Vector3, type Object3D } from 'three'

type Case = { kind: DecorationKind; variant?: string; param?: string; value?: number }
type MeshBox = { path: string; size: [number, number, number] }
type Measure = { reads: string[]; size: [number, number, number]; meshes: MeshBox[] }

const AXIS: Record<string, number> = {
  width: 0,
  depth: 2,
  height: 1,
  length: 0,
  tall: 1,
  drop: 1,
  cord: 1,
  sill: 1,
  hem: 1,
}

const cases: Case[] = []
for (const kind of DECORATION_KINDS) {
  for (const variant of kind.variants?.map(v => v.id) ?? [undefined]) {
    cases.push({ kind, variant })
    for (const p of styleParams(kind, variant)) {
      if (p.toggle || p.cycle || p.adjust) continue
      cases.push({ kind, variant, param: p.id, value: p.max })
    }
  }
}

const reads = new Set<string>()
function watched(values: Record<string, number>) {
  return new Proxy(values, {
    get(target, key) {
      const stack = new Error().stack ?? ''
      if (typeof key === 'string' && /\/scene\/decor\//.test(stack) && !/DecorationModel\.tsx|surfaces\.ts/.test(stack))
        reads.add(key)
      return target[key as string]
    },
  })
}

function measure(root: Object3D): Measure {
  root.updateMatrixWorld(true)
  const all = new Box3()
  const meshes: MeshBox[] = []
  const walk = (o: Object3D, path: string) => {
    if (o instanceof Mesh && o.visible && o.geometry) {
      o.geometry.computeBoundingBox()
      const box = o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld)
      if (!box.isEmpty()) {
        all.union(box)
        const s = box.getSize(new Vector3())
        meshes.push({ path: `${path}/${o.geometry.type}`, size: [s.x, s.y, s.z] })
      }
    }
    o.children.forEach((c, i) => walk(c, `${path}/${i}`))
  }
  walk(root, '')
  const s = all.getSize(new Vector3())
  return { reads: [...reads], size: [s.x, s.y, s.z], meshes }
}

const findings: Record<string, unknown>[] = []
let baseline: Measure | null = null

function Runner() {
  const scene = useThree(s => s.scene)
  const [index, setIndex] = useState(0)
  const [settle, setSettle] = useState(0)
  useFrame(() => {
    if (index >= cases.length) return
    if (settle < 3) {
      setSettle(settle + 1)
      return
    }
    const c = cases[index]
    const root = scene.getObjectByName('decoration:audit')
    const m: Measure = root ? measure(root) : { reads: [], size: [0, 0, 0], meshes: [] }
    if (!c.param) baseline = m
    else if (baseline) {
      const axis = AXIS[c.param]
      const grew = m.size.map((v, i) => v - baseline!.size[i])
      const base = new Map(baseline.meshes.map(x => [x.path, x.size]))
      const stuck: string[] = []
      for (const mesh of m.meshes) {
        const was = base.get(mesh.path)
        if (!was) continue
        const same = mesh.size.every((v, i) => Math.abs(v - was[i]) < 1e-4)
        // A big part that kept its size while the whole grew.
        const big = (axis === undefined ? [0, 1, 2] : [axis]).some(
          i => was[i] > baseline!.size[i] * 0.4 && grew[i] > 0.01,
        )
        if (same && big) stuck.push(mesh.path)
      }
      findings.push({
        kind: c.kind.id,
        variant: c.variant,
        param: c.param,
        read: m.reads.includes(c.param),
        default: paramValue(c.kind, undefined, c.param, c.variant),
        max: c.value,
        base: baseline.size.map(v => +v.toFixed(3)),
        size: m.size.map(v => +v.toFixed(3)),
        axisGrew: axis === undefined ? undefined : grew[axis] > 0.01,
        anyGrew: grew.some(v => Math.abs(v) > 0.01),
        meshes: [baseline.meshes.length, m.meshes.length],
        stuck,
      })
    }
    reads.clear()
    setIndex(index + 1)
    setSettle(0)
    if (index + 1 >= cases.length) {
      ;(window as unknown as { sizes: unknown }).sizes = findings
      document.title = 'Size audit done'
    }
  })
  if (index >= cases.length) return null
  const c = cases[index]
  const item: DecorationConfig = {
    id: 'audit',
    kind: c.kind.id,
    variant: c.variant,
    room: 'audit',
    position: [0, 0],
    params: watched(c.param ? { [c.param]: c.value! } : {}),
  }
  return (
    <DecorationModel
      key={index}
      item={item}
      all={[item]}
      state={{ on: false, level: 0, levels: {}, glow: [1, 1, 1] }}
    />
  )
}

const root = document.createElement('div')
root.style.cssText = 'width:300px;height:200px'
document.body.appendChild(root)
createRoot(root).render(
  <Canvas frameloop="always" camera={{ position: [3, 3, 3] }}>
    <ambientLight />
    <Runner />
  </Canvas>,
)
