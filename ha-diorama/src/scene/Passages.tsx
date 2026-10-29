import { SLAB_BEVEL_SEGMENTS } from '#/constants.ts'
import { pebbleGeometry } from '#/geometry/pebble.ts'
import { PASSAGE_CORNER_RADIUS_M, passageCore, passagesOf, type Passage } from '#/geometry/passages.ts'
import type { SurfaceKind } from '#/materials/textures.ts'
import { useEased } from '#/scene/decor/ease.ts'
import { usePressActions } from '#/scene/decor/press.ts'
import { floorColor } from '#/scene/floorColor.ts'
import { HIDDEN_LAYER, PASSAGE } from '#/scene/focus.ts'
import SurfaceMaterial from '#/scene/SurfaceMaterial.tsx'
import {
  FLOOR_MATERIALS,
  FLOOR_PATTERN_SHIFT_M,
  PASSAGE_HOVER_SHADE,
  ROOM_SLAB_EDGE_RADIUS_M,
  ROOM_SLAB_THICKNESS_M,
} from '#/theme.ts'
import type { DecorationConfig, RoomConfig, WallsConfig } from '#/types.ts'
import { useEffect, useMemo, useState } from 'react'
import { Color, SRGBColorSpace, type Mesh } from 'three'

// The signs on the floor that lead from a focused room into the room open
// beside it. Each is a triangle as thick as a floor, rounded all over and
// made of the floor it leads onto, lying just past the stretch the two
// share or the door between them, and only shows around the room it leads
// out of. A press on one
// goes to the room it points at, as a press on a door between them would.

type Props = {
  rooms: RoomConfig[]
  decorations: DecorationConfig[]
  // With walls, only rooms open to each other or with a door between them.
  walls?: WallsConfig
  onRoom: (room: string, through: string[]) => void
}

export default function Passages({ rooms, decorations, walls, onRoom }: Props) {
  const passages = useMemo(
    () => rooms.flatMap(room => passagesOf(room, rooms, decorations, walls)),
    [rooms, decorations, walls],
  )
  return passages.map(passage => {
    const index = rooms.findIndex(room => room.id === passage.to)
    return (
      <Sign key={`${passage.from}>${passage.to}`} passage={passage} room={rooms[index]} index={index} onRoom={onRoom} />
    )
  })
}

// `color` with black laid over it at `amount` to multiply, as a screen
// would blend it: each channel scaled down by the same share.
function shade(color: string, amount: number) {
  if (amount <= 0) return color
  const rgb = new Color(color).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace)
  const k = 1 - amount
  return `#${new Color().setRGB(rgb.r * k, rgb.g * k, rgb.b * k, SRGBColorSpace).getHexString()}`
}

// Hidden from the start: the focus brings a sign out around its own room.
const hide = (mesh: Mesh | null) => mesh?.layers.set(HIDDEN_LAYER)

type SignProps = { passage: Passage; room: RoomConfig; index: number; onRoom: Props['onRoom'] }

function Sign({ passage, room, index, onRoom }: SignProps) {
  // Built where it lies on the plan, so the floor's pattern on it lines up
  // with the floor of the room it leads onto.
  const geometry = useMemo(
    () =>
      pebbleGeometry(
        passageCore(passage, PASSAGE_CORNER_RADIUS_M + ROOM_SLAB_EDGE_RADIUS_M),
        PASSAGE_CORNER_RADIUS_M,
        ROOM_SLAB_EDGE_RADIUS_M,
        ROOM_SLAB_THICKNESS_M,
        SLAB_BEVEL_SEGMENTS,
        FLOOR_PATTERN_SHIFT_M,
      ),
    [passage],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  const go = () => onRoom(passage.to, [passage.from, passage.to])
  const press = usePressActions(go)
  // Under the pointer the sign leans a little further on its way, and
  // darkens a little.
  const [over, setOver] = useState(false)
  const lean = useEased(over ? 1 : 0, 10)
  const [ox, oy] = passage.out
  const color = floorColor(room, index)
  const floor = room.floor ? FLOOR_MATERIALS[room.floor.material] : undefined
  const shaded = shade(color, lean * PASSAGE_HOVER_SHADE)
  return (
    <mesh
      ref={hide}
      name={`${PASSAGE}${passage.from}`}
      geometry={geometry}
      position={[ox * lean * 0.06, 0, -oy * lean * 0.06]}
      receiveShadow
      userData={{ pick: { click: go, open: go } }}
      {...press}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer'
        setOver(true)
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
        setOver(false)
      }}
    >
      {floor ? (
        <SurfaceMaterial
          kind={(floor.surface ?? 'matte') as SurfaceKind}
          color={shaded}
          scale={room.floor?.scale ?? 1}
          rotation={room.floor?.rotation ?? 0}
          intensity={room.floor?.intensity ?? 1}
          relief={false}
        />
      ) : (
        <meshStandardMaterial color={shaded} roughness={0.85} />
      )}
    </mesh>
  )
}
