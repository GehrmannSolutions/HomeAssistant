import { decorationKind, paramValue } from '#/decoration/catalog.ts'
import { seenFromOutside, wallsOf, type Opening, type WallBlock, type WallSide } from '#/geometry/walls.ts'
import { redrawShadows, WALLS } from '#/scene/focus.ts'
import { WALL_COLOR } from '#/theme.ts'
import type { CardConfig, Point } from '#/types.ts'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

// The walls along the rooms' outlines, when the card has `walls`. They are
// drawn together, a few meshes in all: one for the walls of each room, or
// of each pair of rooms they stand between, so a focused room keeps its own
// and the ones it shares, and with full walls one more for the top of each
// straight run, which is left out while the camera looks at it from outside
// its room. Presses go through them to what stands behind.

// Pieces that open a wall, and where their opening starts and ends.
const DOORS = new Set(['door', 'sliding_door', 'garage_door'])

function openingsOf(config: CardConfig): Opening[] {
  return (config.decorations ?? []).flatMap(item => {
    if (!DOORS.has(item.kind) && item.kind !== 'window') return []
    const kind = decorationKind(item.kind)
    if (!kind) return []
    const value = (id: string) => paramValue(kind, item.params, id, item.variant)
    const width = value('width')
    const height = value('height')
    const bottom = item.kind === 'window' ? value('sill') : 0
    return [{ at: item.position, width, bottom, top: bottom + height }]
  })
}

// Scene coordinates of a point on the plan at a height: x as on the plan,
// y up, z the plan's y with its sign flipped.
const at = (p: Point, y: number) => new Vector3(p[0], y, -p[1])

// One geometry for many blocks, each face flat and facing out.
function geometryOf(blocks: WallBlock[]): BufferGeometry {
  const position: number[] = []
  const normal: number[] = []
  const triangle = (a: Vector3, b: Vector3, c: Vector3, facing: Vector3) => {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
    const [p, q] = n.dot(facing) < 0 ? [c, b] : [b, c]
    position.push(a.x, a.y, a.z, p.x, p.y, p.z, q.x, q.y, q.z)
    for (let i = 0; i < 3; i++) normal.push(facing.x, facing.y, facing.z)
  }
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, facing: Vector3) => {
    triangle(a, b, c, facing)
    triangle(a, c, d, facing)
  }
  const up = new Vector3(0, 1, 0)
  for (const block of blocks) {
    const { corners, bottom, top } = block
    quad(at(corners[0], top), at(corners[1], top), at(corners[2], top), at(corners[3], top), up)
    for (let i = 0; i < 4; i++) {
      const p = corners[i]
      const q = corners[(i + 1) % 4]
      const length = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (length < 1e-4) continue
      // Outward from a counter clockwise footprint is to the right of its edges.
      const facing = new Vector3((q[1] - p[1]) / length, 0, (q[0] - p[0]) / length)
      quad(at(p, bottom), at(q, bottom), at(q, top), at(p, top), facing)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

const noPress = () => {}

type Props = { config: CardConfig; focus?: string | null }

export default function Walls({ config, focus = null }: Props) {
  const scene = useThree(state => state.scene)
  const invalidate = useThree(state => state.invalidate)
  const walls = config.walls
  const rooms = config.rooms
  const decorations = config.decorations
  const group = useMemo(() => {
    const group = new Group()
    if (!walls) return group
    const blocks = wallsOf(rooms ?? [], walls, openingsOf({ type: '', rooms, decorations }))
    const material = new MeshStandardMaterial({ color: walls.color ?? WALL_COLOR, roughness: 0.95, metalness: 0 })
    const lower = new Map<string, WallBlock[]>()
    const upper = new Map<string, WallBlock[]>()
    for (const block of blocks) {
      const key = block.rooms.join('|')
      const into = block.upper ? upper : lower
      // The top of each straight run comes and goes on its own.
      const runKey = block.upper ? `${key}@${block.sides.map(s => `${s.at[0]},${s.at[1]}`).join(';')}` : key
      const list = into.get(runKey) ?? []
      list.push(block)
      into.set(runKey, list)
    }
    const add = (key: string, list: WallBlock[], top: boolean) => {
      const mesh = new Mesh(geometryOf(list), material)
      mesh.name = `${WALLS}${key}`
      mesh.userData.rooms = list[0].rooms
      mesh.userData.room = list[0].rooms[0]
      if (top) mesh.userData.sides = list[0].sides
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.raycast = noPress
      group.add(mesh)
    }
    for (const [key, list] of lower) add(key, list, false)
    for (const [key, list] of upper) add(key, list, true)
    return group
  }, [walls, rooms, decorations])

  // The walls as drawn, reached through a ref so the frame loop can show
  // and hide the tops.
  const drawn = useRef<Group>(null)
  useEffect(() => {
    invalidate()
    return () => {
      group.traverse(object => {
        if (object instanceof Mesh) {
          object.geometry.dispose()
          ;(object.material as MeshStandardMaterial).dispose()
        }
      })
    }
  }, [group, invalidate])

  // The top of a full wall stands only while the camera looks at it from
  // inside every room it bounds, or with a room focused, from inside that
  // one, so a wall never stands between the camera and the room behind it.
  useFrame(({ camera }) => {
    const tops = drawn.current?.children ?? []
    const from: Point = [camera.position.x, -camera.position.z]
    let changed = false
    for (const mesh of tops) {
      const sides = mesh.userData.sides as WallSide[] | undefined
      if (!sides) continue
      const mine = focus ? sides.filter(side => side.room === focus) : sides
      const show = mine.length > 0 && !mine.some(side => seenFromOutside(side, from))
      if (mesh.visible !== show) {
        mesh.visible = show
        changed = true
      }
    }
    if (changed) redrawShadows(scene)
  })

  return <primitive ref={drawn} object={group} />
}
