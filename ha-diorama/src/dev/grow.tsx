// A sheet of models, each drawn twice, as it is and with one parameter at
// its largest, for checking that every part of a model grows along. Served
// by the dev server, never built into the card:
//
//   http://localhost:5174/src/dev/grow.html?cases=pool/deck/width,sofa/dresde/depth
//
// Each case is kind/style/parameter. Every pair is scaled to fit its cell.
import { decorationKind, paramValue } from '#/decoration/catalog.ts'
import DecorationModel from '#/scene/decor/DecorationModel.tsx'
import type { DecorationConfig } from '#/types.ts'
import { Html } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Box3, Group, Vector3 } from 'three'

const query = new URLSearchParams(location.search)
const cases = (query.get('cases') ?? '')
  .split(',')
  .filter(Boolean)
  .map(c => {
    const [kind, variant, param] = c.split('/')
    return { kind, variant: variant || undefined, param }
  })
const COLS = 4
const CELL = 3.4
const STATE = { on: false, level: 0, levels: {}, glow: [1, 1, 1] as [number, number, number] }

function Pair({ kind, variant, param, at }: { kind: string; variant?: string; param: string; at: [number, number] }) {
  const spec = decorationKind(kind)
  const ref = useRef<Group>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    if (!ref.current) return
    ref.current.updateMatrixWorld(true)
    const size = new Box3().setFromObject(ref.current).getSize(new Vector3())
    const big = Math.max(size.x, size.y, size.z, 0.05)
    setScale(0.75 / big)
  }, [])
  if (!spec) return null
  const base: DecorationConfig = { id: 'a', kind, variant, room: 'sheet', position: [0, 0], params: {} }
  const max = spec.params.find(x => x.id === param)?.max ?? 0
  const grown: DecorationConfig = { ...base, id: 'b', params: { [param]: max } }
  return (
    <group position={[at[0], 0, at[1]]}>
      <Html position={[0, 1.15, 0]} center style={{ font: '11px sans-serif', whiteSpace: 'nowrap', color: '#333' }}>
        {kind}/{variant ?? ''} {param} {paramValue(spec, undefined, param, variant)} to {max}
      </Html>
      <group position={[-0.85, 0, 0]} scale={scale}>
        <group ref={ref}>
          <DecorationModel item={base} all={[base]} state={STATE} />
        </group>
      </group>
      <group position={[0.95, 0, 0]} scale={scale}>
        <DecorationModel item={grown} all={[grown]} state={STATE} />
      </group>
    </group>
  )
}

const rows = Math.ceil(cases.length / COLS)
const root = document.createElement('div')
root.style.cssText = `width:100vw;height:100vh;background:#2a2a2e`
document.body.appendChild(root)
const w = COLS * CELL
const h = rows * CELL
createRoot(root).render(
  <Canvas
    orthographic
    camera={{
      position: [0, 40, 30],
      zoom: Math.min(innerWidth / w, innerHeight / (h * 0.8)) * 0.92,
      near: 0.1,
      far: 200,
    }}
    dpr={1}
  >
    <ambientLight intensity={0.8} />
    <directionalLight position={[3, 6, 4]} intensity={1} />
    {cases.map((c, i) => (
      <Pair
        key={i}
        {...c}
        at={[((i % COLS) - (COLS - 1) / 2) * CELL, (Math.floor(i / COLS) - (rows - 1) / 2) * CELL]}
      />
    ))}
  </Canvas>,
)
