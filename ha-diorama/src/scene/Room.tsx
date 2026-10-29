import { SLAB_BEVEL_SEGMENTS, SLAB_CURVE_SEGMENTS } from '#/constants.ts'
import SurfaceMaterial from '#/scene/SurfaceMaterial.tsx'
import type { SurfaceKind } from '#/materials/textures.ts'
import { FLOOR_MATERIALS, FLOOR_PATTERN_SHIFT_M, ROOM_SLAB_EDGE_RADIUS_M, ROOM_SLAB_THICKNESS_M } from '#/theme.ts'
import { floorColor } from '#/scene/floorColor.ts'
import { ensureCounterClockwise, inset, roundedShape } from '#/geometry/polygon.ts'
import { slabGeometry, touchesNeighbour } from '#/geometry/slab.ts'
import type { Point, RoomConfig } from '#/types.ts'
import { memo, useMemo } from 'react'

// Floors this close to touching are drawn as touching, in meters.
const TOUCHING_GAP_M = 0.001

type Props = {
  room: RoomConfig
  // Every room of the home, to tell where this one touches another.
  rooms: RoomConfig[]
  index: number
  radius: number
  gap: number
}

// Clicks on the floor are not taken here. The press fallback finds the room
// under a press once the pieces around it have had their turn.
function Room({ room, rooms, index, radius, gap }: Props) {
  const geometry = useMemo(() => {
    const points = inset(ensureCounterClockwise(room.points), gap / 2)
    const cornerRadius = room.radius ?? radius
    // With no gap, floors that touch meet flat and square: the edge is only
    // rounded over, and a corner only rounded off, where it stands free.
    // With a gap every floor stands free.
    const neighbours = gap > TOUCHING_GAP_M ? [] : rooms.filter(other => other.id !== room.id).map(r => r.points)
    // A concave corner wraps around a neighbour's convex corner. For the two
    // arcs to be concentric its radius grows by the gap.
    const outline = roundedShape(points, cornerRadius, cornerRadius + gap, i => touchesNeighbour(points[i], neighbours))
      .getPoints(SLAB_CURVE_SEGMENTS)
      .map((p): Point => [p.x, p.y])
    return slabGeometry(
      outline,
      neighbours,
      ROOM_SLAB_EDGE_RADIUS_M,
      ROOM_SLAB_THICKNESS_M,
      SLAB_BEVEL_SEGMENTS,
      FLOOR_PATTERN_SHIFT_M,
    )
  }, [room.id, room.points, room.radius, rooms, radius, gap])

  const floor = room.floor ? FLOOR_MATERIALS[room.floor.material] : undefined
  const color = floorColor(room, index)

  return (
    <mesh
      // Named so the outline and the press fallback can find the room.
      name={`room:${room.id}`}
      geometry={geometry}
      castShadow
      receiveShadow
    >
      {floor ? (
        // Extrude UVs are plan meters, so the surface tiles at its own
        // physical size, scaled and turned by what the room asks for.
        <SurfaceMaterial
          kind={(floor.surface ?? 'matte') as SurfaceKind}
          color={color}
          scale={room.floor?.scale ?? 1}
          rotation={room.floor?.rotation ?? 0}
          intensity={room.floor?.intensity ?? 1}
        />
      ) : (
        <meshStandardMaterial color={color} roughness={0.85} />
      )}
    </mesh>
  )
}

export default memo(Room)
