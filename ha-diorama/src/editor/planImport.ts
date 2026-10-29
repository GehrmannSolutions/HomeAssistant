import { greyOf, inkOf, readPlan } from '#/editor/planRooms.ts'
import type { Trace } from '#/editor/trace.ts'
import type { DecorationConfig, Point, RoomConfig } from '#/types.ts'

// What a plan picture laid under the drawing shows, in the meters of the
// plan: the rooms, the doors and windows in their walls, and how thick the
// outer walls are drawn.
export type PlanFound = { rooms: RoomConfig[]; decorations: DecorationConfig[]; outer: number }

// The pixels of a picture, four bytes each, red, green, blue and alpha.
export type Pixels = { width: number; height: number; data: ArrayLike<number> }

const round = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// Reads the trace picture into rooms, doors and windows, placed where the
// picture lies on the plan. `roomId` and `decorationId` hand out ids that
// are not taken yet.
export function roomsFromPicture(
  trace: Trace,
  pixels: Pixels,
  roomId: () => { id: string; name: string },
  decorationId: (kind: string) => string,
): PlanFound {
  const { width, height, data } = pixels
  const perMeter = width / trace.width
  const reading = readPlan(inkOf(greyOf(data, width, height), width, height), perMeter)
  const left = trace.center[0] - trace.width / 2
  const top = trace.center[1] + (trace.width * trace.aspect) / 2
  // The picture's rows run down, the plan's y runs up.
  const onPlan = ([x, y]: Point): Point => [round(left + x / perMeter), round(top - y / perMeter)]
  const rooms: RoomConfig[] = reading.rooms.map(points => ({ ...roomId(), points: points.map(onPlan) }))
  const decorations = reading.openings.flatMap((opening): DecorationConfig[] => {
    const index = opening.rooms[0] >= 0 ? opening.rooms[0] : opening.rooms[1]
    if (index < 0) return []
    const room = rooms[index]
    const position = onPlan(opening.at)
    const xs = room.points.map(p => p[0])
    const ys = room.points.map(p => p[1])
    const middle: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    // Which wall of the room it is in: north 0, west 90, south 180, east 270.
    const rotation = opening.upright ? (position[0] < middle[0] ? 90 : 270) : position[1] > middle[1] ? 0 : 180
    const across = opening.width / perMeter
    const kind = opening.door ? 'door' : 'window'
    const params = { width: round(opening.door ? clamp(across, 0.6, 1.4) : clamp(across, 0.5, 3)) }
    return [{ id: decorationId(kind), kind, room: room.id, position, rotation, params }]
  })
  return { rooms, decorations, outer: round(reading.outer / perMeter) }
}

// The pixels of a trace picture, read back from its data URL.
export async function tracePixels(trace: Trace): Promise<Pixels> {
  const image = new Image()
  image.src = trace.src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The picture could not be read')
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}
