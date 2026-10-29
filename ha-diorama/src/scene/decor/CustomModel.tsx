import { colorValue, paramValue, type DecorationKind } from '#/decoration/catalog.ts'
import { MODEL_COLOR, modelOf } from '#/decoration/models.ts'
import { Material } from '#/scene/decor/parts.tsx'
import { decodeShape, fetchGltf, partGeometry, shapeOf, type Shape } from '#/scene/decor/modelShape.ts'
import type { DecorationConfig, ModelConfig } from '#/types.ts'
import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'

type Props = { kind: DecorationKind; item: DecorationConfig }

type Drawn = { size: [number, number, number]; parts: { name: string; geometry: BufferGeometry }[] }

// A model's parts, made once and drawn by every piece placed from it. What
// is kept says which data it was made from, so a model imported again under
// the same id is made again, and a card config handed over afresh, as Home
// Assistant does on every edit, finds the one already made.
const made = new Map<string, { key: string; drawn: Drawn }>()

const keyOf = (model: ModelConfig) =>
  JSON.stringify([
    model.size,
    model.parts.map(p => [
      p.name,
      p.vertices?.length,
      p.triangles?.length,
      p.vertices?.slice(0, 32),
      p.triangles?.slice(-32),
    ]),
  ])

const drawnOf = (shape: Shape): Drawn => ({
  size: shape.size,
  parts: shape.parts.map(part => ({ name: part.name, geometry: partGeometry(part) })),
})

function embedded(kindId: string, model: ModelConfig): Drawn {
  const key = keyOf(model)
  const known = made.get(kindId)
  if (known && known.key === key) return known.drawn
  const drawn = drawnOf(decodeShape(model))
  made.set(kindId, { key, drawn })
  return drawn
}

// A model read from a file of its own is fetched once per address, and
// drawn at once by everything that asks after that, so the editor, which
// has just read it to import it, draws it in the same frame.
const fetched = new Map<string, Promise<Shape>>()
const ready = new Map<string, Drawn>()
export function fetchShape(url: string) {
  let found = fetched.get(url)
  if (!found) {
    found = fetchGltf(url).then(gltf => {
      const shape = shapeOf(gltf)
      ready.set(url, drawnOf(shape))
      return shape
    })
    // A file that failed can be tried again on the next load.
    found.catch(() => fetched.delete(url))
    fetched.set(url, found)
  }
  return found
}

function useDrawn(kindId: string): Drawn | null {
  const model = modelOf(kindId)
  const url = model?.url
  // Held as state too, so the draw once it has arrived is told apart from
  // the one before it.
  const [loaded, setLoaded] = useState<{ url: string; drawn: Drawn } | null>(null)
  useEffect(() => {
    if (!url || ready.has(url)) return
    let live = true
    fetchShape(url).then(
      () => {
        const drawn = ready.get(url)
        if (live && drawn) setLoaded({ url, drawn })
      },
      error => console.warn(`Diorama could not load the model at ${url}`, error),
    )
    return () => {
      live = false
    }
  }, [url])
  if (!model) return null
  if (!url) return embedded(kindId, model)
  return ready.get(url) ?? (loaded?.url === url ? loaded.drawn : null)
}

// A model imported into the catalog, in the card's own paint: every part a
// plain color, stretched to the sizes on its sliders. On the floor it stands
// on its base, on a wall it hangs with its back to the wall, and from the
// ceiling it hangs by its top.
export default function CustomModel({ kind, item }: Props) {
  const drawn = useDrawn(kind.id)
  if (!drawn) return null
  const w = paramValue(kind, item.params, 'width', item.variant)
  const d = paramValue(kind, item.params, 'depth', item.variant)
  const h = paramValue(kind, item.params, 'height', item.variant)
  const [sw, sd, sh] = drawn.size
  const slots = Object.keys(kind.colors)
  return (
    <group
      position={[0, kind.mount === 'ceiling' ? -h : 0, kind.mount === 'wall' ? d / 2 : 0]}
      scale={[w / sw, h / sh, d / sd]}
    >
      {drawn.parts.map((part, i) => {
        // A part is painted by its name, and by its place when the file it
        // is read from has changed since it was imported.
        const slot = slots.includes(part.name) ? part.name : slots[i]
        return (
          <mesh key={i} geometry={part.geometry} castShadow receiveShadow dispose={null}>
            <Material color={slot ? colorValue(kind, item.colors, slot) : MODEL_COLOR} />
          </mesh>
        )
      })}
    </group>
  )
}
