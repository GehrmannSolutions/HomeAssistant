// Checks for src/geometry/walls.ts (HESTIA). Upstream has no test runner,
// so these run with Node's own: `node --test hestia/walls.test.ts`.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { openBetween, seenFromOutside, topShown, wallHeights, wallsOf, WALL_FOOT_M, type WallBlock } from '#/geometry/walls.ts'
import type { Point, RoomConfig } from '#/types.ts'

const area = (points: Point[]) => {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps
// The footprint area of the blocks standing at floor level, so each piece
// of wall is counted once.
const footArea = (blocks: WallBlock[]) =>
  blocks.filter(b => near(b.bottom, WALL_FOOT_M)).reduce((sum, b) => sum + area(b.corners), 0)

const square = (id: string, x: number, y: number, w: number, h: number, extra: Partial<RoomConfig> = {}): RoomConfig => ({
  id,
  points: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
  ...extra,
})

test('a lone room gets a closed ring of outer walls, corners mitred without overlap', () => {
  const blocks = wallsOf([square('a', 0, 0, 4, 3)], { height: 'half' }, [])
  // An orthogonal outline offset by t adds P*t + 4*t*t.
  assert.ok(near(footArea(blocks), 14 * 0.3 + 4 * 0.09), `area ${footArea(blocks)}`)
  for (const b of blocks) assert.ok(area(b.corners) > 0, 'footprints are counter clockwise')
  assert.deepEqual(new Set(blocks.flatMap(b => b.rooms)), new Set(['a']))
})

test('an L-shaped room closes its inner corner too', () => {
  const room: RoomConfig = {
    id: 'l',
    points: [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ],
  }
  const blocks = wallsOf([room], { height: 'half' }, [])
  assert.ok(near(footArea(blocks), 16 * 0.3 + 4 * 0.09), `area ${footArea(blocks)}`)
})

test('two rooms side by side share one wall, drawn once, astride their line', () => {
  const rooms = [square('a', 0, 0, 4, 3), square('b', 4, 0, 3, 3)]
  const blocks = wallsOf(rooms, { height: 'half' }, [])
  const between = blocks.filter(b => b.rooms.length === 2)
  assert.equal(between.length, 1)
  const xs = between[0].corners.map(c => c[0])
  assert.ok(near(Math.min(...xs), 4 - 0.06) && near(Math.max(...xs), 4 + 0.06), `xs ${xs}`)
  // It runs on by half its thickness at both ends.
  const ys = between[0].corners.map(c => c[1])
  assert.ok(near(Math.min(...ys), -0.06) && near(Math.max(...ys), 3.06), `ys ${ys}`)
  assert.deepEqual(between[0].rooms, ['a', 'b'])
})

test('rooms open to each other have no wall between them', () => {
  const rooms = [square('a', 0, 0, 4, 3, { open_to: ['b'] }), square('b', 4, 0, 3, 3)]
  assert.ok(openBetween(rooms[0], rooms[1]) && openBetween(rooms[1], rooms[0]))
  const blocks = wallsOf(rooms, { height: 'half' }, [])
  assert.equal(blocks.filter(b => b.rooms.length === 2).length, 0)
})

test('rooms drawn a little apart still share their wall', () => {
  const rooms = [square('a', 0, 0, 4, 3), square('b', 4.1, 0, 3, 3)]
  const blocks = wallsOf(rooms, { height: 'half' }, [])
  assert.equal(blocks.filter(b => b.rooms.length === 2).length, 1)
})

test('a door leaves its opening from the floor, with the lintel over it on a full wall', () => {
  const rooms = [square('a', 0, 0, 4, 3), square('b', 4, 0, 3, 3)]
  const door = { at: [4, 1.5] as Point, width: 0.9, bottom: 0, top: 2.05 }
  const blocks = wallsOf(rooms, { height: 'full', cutaway: false }, [door]).filter(b => b.rooms.length === 2)
  // Below the door, beside it, above it: the floor-level blocks leave the
  // 0.9 m gap, and one lintel spans it from 2.05 to the ceiling.
  const ys = (b: WallBlock) => b.corners.map(c => c[1])
  const floor = blocks.filter(b => near(b.bottom, WALL_FOOT_M) && b.top > 2.5)
  const covered = floor.reduce((sum, b) => sum + (Math.max(...ys(b)) - Math.min(...ys(b))), 0)
  assert.ok(near(covered, 3.12 - 0.9), `covered ${covered}`)
  const below = blocks.filter(b => near(b.bottom, WALL_FOOT_M) && near(b.top, 0))
  assert.equal(below.length, 1, 'the floor slab part under the door')
  const lintel = blocks.filter(b => near(b.bottom, 2.05))
  assert.equal(lintel.length, 1)
  assert.ok(near(lintel[0].top, 2.6))
})

test('a window keeps the wall under its sill and over its top', () => {
  const window = { at: [2, 0] as Point, width: 1.2, bottom: 0.9, top: 2.1 }
  const blocks = wallsOf([square('a', 0, 0, 4, 3)], { height: 'full', cutaway: false }, [window])
  const inGap = blocks.filter(b => b.corners.every(c => c[0] >= 1.4 - 1e-6 && c[0] <= 2.6 + 1e-6) && b.corners.some(c => c[1] < 0))
  assert.deepEqual(
    inGap.map(b => [b.bottom, b.top]).sort((x, y) => x[0] - y[0]),
    [
      [WALL_FOOT_M, 0.9],
      [2.1, 2.6],
    ],
  )
})

test('heights: full to the measured ceiling, half, or meters', () => {
  const room = square('a', 0, 0, 4, 3)
  const low = square('k', 0, 0, 4, 3, { ceiling: 2.3 })
  assert.deepEqual(wallHeights({}, [room]), { top: 2.6, cut: 1.3 })
  assert.deepEqual(wallHeights({ ceiling: 2.4 }, [room]), { top: 2.4, cut: 1.2 })
  assert.deepEqual(wallHeights({ ceiling: 2.4 }, [low]), { top: 2.3, cut: 1.2 })
  assert.deepEqual(wallHeights({ height: 'half', ceiling: 2.5 }, [room]), { top: 1.25, cut: null })
  assert.deepEqual(wallHeights({ height: 'half', half: 1.1 }, [room]), { top: 1.1, cut: null })
  assert.deepEqual(wallHeights({ height: 1.8 }, [room]), { top: 1.8, cut: null })
  assert.deepEqual(wallHeights({ cutaway: false }, [room]), { top: 2.6, cut: null })
  // Between two rooms a full wall reaches the higher ceiling.
  assert.equal(wallHeights({}, [room, low]).top, 2.6)
})

test('full walls are cut in two, the part above the cut marked', () => {
  const blocks = wallsOf([square('a', 0, 0, 4, 3)], {}, [])
  assert.ok(blocks.some(b => b.upper && near(b.bottom, 1.3) && near(b.top, 2.6)))
  assert.ok(blocks.some(b => !b.upper && near(b.top, 1.3)))
  assert.ok(wallsOf([square('a', 0, 0, 4, 3)], { cutaway: false }, []).every(b => !b.upper))
})

test('the camera sees a wall from outside on the side its room faces out of', () => {
  const blocks = wallsOf([square('a', 0, 0, 4, 3)], {}, [])
  const south = blocks.find(b => b.upper && b.corners.every(c => c[1] <= 0))!
  assert.ok(seenFromOutside(south.sides[0], [2, -10]), 'camera south of the room')
  assert.ok(!seenFromOutside(south.sides[0], [2, 10]), 'camera north of it, looking over the room at the wall')
})

test('cutaway: the whole home keeps the walls between rooms full, a room in view drops its near walls', () => {
  const rooms = [square('a', 0, 0, 4, 3), square('b', 4, 0, 3, 3)]
  const blocks = wallsOf(rooms, {}, [])
  const between = blocks.find(b => b.upper && b.rooms.length === 2)!
  const southOfA = blocks.find(b => b.upper && b.rooms[0] === 'a' && b.corners.every(c => c[1] <= 0))!
  const camera: Point = [-5, -8] // south west of the home, looking north east
  // Whole home, default: walls between rooms stay full, outer walls facing the camera drop.
  assert.equal(topShown(between.sides, camera, null), true)
  assert.equal(topShown(southOfA.sides, camera, null), false)
  // 'all' drops the wall between them too: from the south west it is a near wall of b.
  assert.equal(topShown(between.sides, camera, null, 'all'), false)
  // With a room in view only that room's side counts: for a the wall to b is its east wall,
  // which the camera in the south west sees from inside a.
  assert.equal(topShown(between.sides, camera, 'a'), true)
  assert.equal(topShown(between.sides, camera, 'b'), false)
  // A wall of another room than the one in view is not drawn at all.
  assert.equal(topShown(southOfA.sides, camera, 'b'), false)
  // No cutaway: every top stands.
  assert.equal(topShown(southOfA.sides, camera, null, false), true)
})

test('cutaway all keeps the cut, false removes it', () => {
  const room = square('a', 0, 0, 4, 3)
  assert.deepEqual(wallHeights({ cutaway: 'all' }, [room]), { top: 2.6, cut: 1.3 })
  assert.deepEqual(wallHeights({ cutaway: false, ceiling: 2.35 }, [room]), { top: 2.35, cut: null })
})
