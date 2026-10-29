// A plan picture read into rooms, doors and windows for the card, in meters
// (local tool; plans stay on this machine):
// node hestia/plan_to_diorama.ts <file.gray> <width> <height> <px per m> <out.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { inkOf, readPlan } from '#/editor/planRooms.ts'

const [file, w, h, pm, out] = process.argv.slice(2)
const perMeter = +pm
const t0 = performance.now()
const reading = readPlan(inkOf(readFileSync(file), +w, +h), perMeter)
const xs = reading.rooms.flat().map(p => p[0])
const ys = reading.rooms.flat().map(p => p[1])
const ox = Math.min(...xs)
const oy = Math.max(...ys)
const m = (x: number, y: number) => [
  Math.round(((x - ox) / perMeter) * 100) / 100,
  Math.round(((oy - y) / perMeter) * 100) / 100,
]
const centre = (room: number[][]) => [
  room.reduce((s, p) => s + p[0], 0) / room.length,
  room.reduce((s, p) => s + p[1], 0) / room.length,
]
const rooms = reading.rooms.map((room, i) => ({
  id: `raum_${i + 1}`,
  name: `Raum ${i + 1}`,
  points: room.map(([x, y]) => m(x, y)),
}))
const decorations = reading.openings.map((o, i) => {
  const r = o.rooms[0] >= 0 ? o.rooms[0] : o.rooms[1]
  const [cx, cy] = centre(reading.rooms[r])
  const rotation = o.upright ? (o.at[0] < cx ? 90 : 270) : o.at[1] < cy ? 0 : 180
  const width = o.width / perMeter
  const kind = o.door ? 'door' : 'window'
  const params = o.door
    ? { width: Math.min(1.4, Math.max(0.6, Math.round(width * 100) / 100)) }
    : { width: Math.min(3, Math.max(0.5, Math.round(width * 100) / 100)) }
  return {
    id: `plan_${kind}_${i + 1}`,
    kind,
    room: rooms[r].id,
    position: m(o.at[0], o.at[1]),
    rotation,
    params,
    between: o.rooms.map(k => (k >= 0 ? rooms[k].id : 'outside')),
  }
})
const result = {
  perMeter,
  origin: [ox, oy],
  outer: Math.round((reading.outer / perMeter) * 1000) / 1000,
  rooms,
  decorations,
  pixels: { rooms: reading.rooms, openings: reading.openings },
}
writeFileSync(out, JSON.stringify(result, null, 1))
console.log(
  `rooms ${rooms.length}, doors ${decorations.filter(d => d.kind === 'door').length}, windows ${decorations.filter(d => d.kind === 'window').length}, outer wall ${result.outer} m, ${Math.round(performance.now() - t0)} ms`,
)
for (const r of rooms) {
  const X = r.points.map(p => p[0]),
    Y = r.points.map(p => p[1])
  console.log(
    ` ${r.id}: ${(Math.max(...X) - Math.min(...X)).toFixed(2)} x ${(Math.max(...Y) - Math.min(...Y)).toFixed(2)} m, ${r.points.length} corners`,
  )
}
