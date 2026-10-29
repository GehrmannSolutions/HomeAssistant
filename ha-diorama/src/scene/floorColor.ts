import { FLOOR_MATERIALS, ROOM_COLORS } from '#/theme.ts'
import type { RoomConfig } from '#/types.ts'

// The color a room's floor is drawn in: its own, else its material's, else
// the room's, else the next of the fill colors by its place in the home.
export function floorColor(room: RoomConfig, index: number): string {
  const floor = room.floor ? FLOOR_MATERIALS[room.floor.material] : undefined
  return room.floor?.color ?? floor?.color ?? room.color ?? ROOM_COLORS[index % ROOM_COLORS.length]
}
