// Checks for src/editor/planRooms.ts (HESTIA): `node --test hestia/planRooms.test.ts`.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  inkOf,
  piecesOf,
  pieceAt,
  planRooms,
  readPlan,
  roomOutline,
  roomsOf,
  straighten,
  wallLines,
  withoutDashes,
  type Ink,
} from '#/editor/planRooms.ts'
import type { Point } from '#/types.ts'
import { roomsFromPicture } from '#/editor/planImport.ts'

// A plan drawn into a raster: 1 is ink.
function paper(width: number, height: number): Ink {
  return { width, height, ink: new Uint8Array(width * height) }
}
function line(p: Ink, x0: number, y0: number, x1: number, y1: number, thick = 2) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + thick - 1; y++)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + thick - 1; x++)
      if (x >= 0 && y >= 0 && x < p.width && y < p.height) p.ink[y * p.width + x] = 1
}
// A wall drawn the way plans draw them: two thin lines with paper between.
function wall(p: Ink, x0: number, y0: number, x1: number, y1: number, t = 12) {
  if (y0 === y1) {
    line(p, x0, y0, x1, y0)
    line(p, x0, y0 + t, x1, y0 + t)
  } else {
    line(p, x0, y0, x0, y1)
    line(p, x0 + t, y0, x0 + t, y1)
  }
}
const area = (points: Point[]) => {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}
const box = (points: Point[]) => {
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

// Two rooms side by side, 300 x 200 and 200 x 200 px inside, walls 12 px
// thick, a door gap of 60 px in the wall between them with its arc drawn,
// a label and a hatched corner in the left room, dimension lines outside.
function twoRooms(): Ink {
  const p = paper(640, 360)
  // outer walls, inner faces at x 40..552, y 40..240 (left room 40..340)
  wall(p, 28, 28, 564, 28)
  wall(p, 28, 240, 564, 240)
  wall(p, 28, 28, 28, 252)
  wall(p, 552, 28, 552, 252)
  // the wall between them at x 340..352, with a door from y 100 to 160
  wall(p, 340, 40, 340, 100)
  wall(p, 340, 160, 340, 240)
  // the door leaf and a rough arc across the opening
  line(p, 352, 100, 412, 100, 1)
  for (let a = 0; a <= 90; a += 2) {
    const r = 60
    const x = Math.round(352 + r * Math.cos((a * Math.PI) / 180))
    const y = Math.round(100 + r * Math.sin((a * Math.PI) / 180))
    line(p, x, y, x, y, 1)
  }
  // a label in the left room
  for (let k = 0; k < 5; k++) line(p, 150 + k * 12, 130, 150 + k * 12 + 6, 140, 1)
  // hatching in the left room's top left corner, slanted strokes
  for (let k = 0; k < 40; k += 6) for (let j = 0; j < 30; j++) line(p, 50 + k + j, 50 + j, 50 + k + j, 50 + j, 1)
  // dimension lines outside, below the house
  line(p, 28, 300, 564, 300, 1)
  line(p, 28, 290, 28, 310, 1)
  line(p, 564, 290, 564, 310, 1)
  return p
}

test('ink from grey levels splits dark lines from paper', () => {
  const grey = new Uint8Array([250, 250, 20, 30, 240, 10])
  assert.deepEqual([...inkOf(grey, 6, 1).ink], [0, 0, 1, 1, 0, 1])
  assert.deepEqual([...inkOf(grey, 6, 1, true).ink], [1, 1, 0, 0, 1, 0])
})

test('a plan at 50 px to the meter: two rooms, the doorway shut, text, hatching and the door leaf ignored', () => {
  const plan = twoRooms()
  const rooms = planRooms(plan, 50)
  assert.equal(rooms.length, 2, `rooms ${JSON.stringify(rooms)}`)
  const [left, right] = rooms.sort((a, b) => box(a)[0] - box(b)[0])
  // Back out to the inner faces of the walls, within a few pixels.
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 3)
  assert.ok(near(box(left), [40, 40, 340, 240]), `left ${box(left)}`)
  assert.ok(near(box(right), [352, 40, 552, 240]), `right ${box(right)}`)
  // Straight, square rooms: four corners each.
  assert.equal(left.length, 4, `left ${JSON.stringify(left)}`)
  assert.equal(right.length, 4, `right ${JSON.stringify(right)}`)
})

test('a press anywhere in a room finds that room, even next to a line', () => {
  const plan = twoRooms()
  const pieces = piecesOf(plan, 8)
  const label = pieceAt(pieces, plan, [100, 200], 20)
  assert.ok(label > 0)
  const outline = roomOutline(pieces, plan, label, 8, 10)
  assert.ok(Math.abs(area(outline) - 300 * 200) < 300 * 200 * 0.03, `area ${area(outline)}`)
  // Right beside the wall, inside the worn back margin, it still finds it.
  assert.equal(pieceAt(pieces, plan, [43, 120], 20), label)
  // Outside the house there is no room.
  assert.equal(pieces.outside[pieceAt(pieces, plan, [5, 5], 20)] ?? true, true)
})

test('a gap wider than twice the gap lets the rooms run into each other', () => {
  const plan = twoRooms()
  // Gap 4: the 60 px opening with its arc closes, a 2 px break would not matter.
  assert.equal(roomsOf(plan, 4, 10, 2000).length, 2)
  // Without the arc the doorway is open: rub it out, then the two are one.
  const open = twoRooms()
  for (let y = 99; y < 170; y++) for (let x = 353; x < 420; x++) open.ink[y * open.width + x] = 0
  assert.equal(roomsOf(open, 8, 10, 2000).length, 1)
  assert.equal(roomsOf(open, 31, 10, 2000).length, 2)
})

test('only long straight runs are kept as walls', () => {
  const plan = twoRooms()
  const walls = wallLines(plan, 30)
  // The label and the hatching are gone, the walls stay.
  assert.equal(walls.ink[135 * plan.width + 160], 0)
  assert.equal(walls.ink[60 * plan.width + 56], 0)
  assert.equal(walls.ink[28 * plan.width + 200], 1)
})

test('straightening takes the jogs out of a stepped edge', () => {
  const stepped: Point[] = [
    [0, 0],
    [50, 0],
    [50, 1],
    [100, 1],
    [100, 60],
    [0, 60],
  ]
  const straight = straighten(stepped, 4)
  assert.equal(straight.length, 4, JSON.stringify(straight))
})

test('reading a plan: the two rooms meet in the middle of their wall, with the door between them', () => {
  const plan = twoRooms()
  const { rooms, openings, outer } = readPlan(plan, 50)
  assert.equal(rooms.length, 2)
  const [left, right] = [...rooms].sort((a, b) => Math.min(...a.map(p => p[0])) - Math.min(...b.map(p => p[0])))
  const leftEnd = Math.max(...left.map(p => p[0]))
  const rightStart = Math.min(...right.map(p => p[0]))
  // the wall's lines are at 340 and 352: both rooms end near its middle
  assert.ok(Math.abs(leftEnd - 347) <= 3, `left room ends at ${leftEnd}`)
  assert.ok(Math.abs(rightStart - 347) <= 3, `right room starts at ${rightStart}`)
  const doors = openings.filter(o => o.door)
  assert.equal(doors.length, 1)
  assert.ok(doors[0].upright && Math.abs(doors[0].at[1] - 130) <= 8, `door at ${doors[0].at}`)
  assert.ok(Math.abs(doors[0].width - 60) <= 12, `door ${doors[0].width} wide`)
  // the outer walls are 12 px between their lines plus the lines
  assert.ok(outer >= 10 && outer <= 18, `outer wall ${outer}`)
})

test('a dash-dotted line across a room is taken out, a wall line is not', () => {
  const p = paper(200, 400)
  for (let y = 10; y < 390; y += 50) line(p, 50, y, 50, y + 30, 2)
  for (let y = 10; y < 390; y += 50) line(p, 50, y + 40, 50, y + 41, 2)
  line(p, 150, 10, 150, 390, 2)
  const clean = withoutDashes(p, 50)
  const left = clean.ink.reduce((n, v, i) => n + (v && i % 200 < 100 ? 1 : 0), 0)
  const right = clean.ink.reduce((n, v, i) => n + (v && i % 200 >= 100 ? 1 : 0), 0)
  assert.equal(left, 0)
  assert.ok(right > 700)
})

test('rooms found in a trace picture land where the picture lies on the plan, in meters', () => {
  const plan = twoRooms()
  const data = new Uint8Array(plan.width * plan.height * 4)
  for (let i = 0; i < plan.ink.length; i++) {
    const v = plan.ink[i] ? 0 : 255
    data.set([v, v, v, 255], i * 4)
  }
  // 640 px over 12.8 m: 50 px to the meter, the picture's middle at (10, 5)
  const trace = { src: '', aspect: plan.height / plan.width, center: [10, 5] as Point, width: 12.8, opacity: 1 }
  let n = 0
  const found = roomsFromPicture(
    trace,
    { width: plan.width, height: plan.height, data },
    () => ({ id: `room-${++n}`, name: `Room ${n}` }),
    kind => `${kind}-1`,
  )
  assert.equal(found.rooms.length, 2)
  const xs = found.rooms.flatMap(r => r.points.map(p => p[0]))
  const ys = found.rooms.flatMap(r => r.points.map(p => p[1]))
  // inner faces at x 40..552 and y 40..240 px: 4.4..14.64 m and 5+3.6-0.8=7.8 down to 3.8 m
  assert.ok(Math.abs(Math.min(...xs) - 4.4) < 0.15, `west ${Math.min(...xs)}`)
  assert.ok(Math.abs(Math.max(...xs) - 14.64) < 0.15, `east ${Math.max(...xs)}`)
  assert.ok(Math.abs(Math.max(...ys) - 7.8) < 0.15, `north ${Math.max(...ys)}`)
  assert.ok(Math.abs(Math.min(...ys) - 3.8) < 0.15, `south ${Math.min(...ys)}`)
  const door = found.decorations.find(d => d.kind === 'door')
  assert.ok(door, 'a door')
  assert.ok(found.rooms.some(r => r.id === door.room))
  assert.ok(door.rotation === 90 || door.rotation === 270)
  assert.ok(Math.abs(door.position[0] - (4.4 + 307 / 50)) < 0.2, `door at ${door.position}`)
})
