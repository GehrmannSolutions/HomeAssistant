// Runs the plan room search on a local grey raster (never committed data): node hestia/try_plan.ts <file.gray> <w> <h> <perMeter> <out.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { inkOf, planRooms } from '#/editor/planRooms.ts'
const [file, w, h, perMeter, out] = process.argv.slice(2)
const grey = readFileSync(file)
const t0 = performance.now()
const ink = inkOf(grey, +w, +h)
const rooms = planRooms(ink, +perMeter)
console.log('rooms', rooms.length, 'ms', Math.round(performance.now() - t0))
for (const r of rooms) {
  const xs = r.map(p => p[0]), ys = r.map(p => p[1])
  console.log(r.length, 'corners', ((Math.max(...xs) - Math.min(...xs)) / +perMeter).toFixed(2), 'x', ((Math.max(...ys) - Math.min(...ys)) / +perMeter).toFixed(2), 'm at', Math.min(...xs), Math.min(...ys))
}
writeFileSync(out, JSON.stringify(rooms))
