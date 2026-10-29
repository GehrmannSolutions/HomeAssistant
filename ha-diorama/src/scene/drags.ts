import type { Vector3 } from 'three'

// The pointers a piece has asked to keep from the camera, by id. A press on
// a piece that can be dragged, like a blind, is asked for the moment it goes
// down, and the camera leaves it alone while the piece makes up its mind.
// A press that runs along the piece's travel stays the piece's until it is
// let go. Any other is given back, and the camera turns from there.
export const held = new Set<number>()

// When a piece was last let go after a drag. The browser still makes a
// click of that release, and the click is not a press on the piece.
let droppedAt = -Infinity

export function dropped() {
  droppedAt = performance.now()
}

// Whether a click now is the tail of a drag that just ended.
export function justDropped() {
  return performance.now() - droppedAt < 400
}

// What starts a drag on a piece: its own, or for a window, the one of the
// cover over the stretch the press landed on. Kept in the piece's userData
// as drag, so a press that lands near it can find it too.
export type Grab = (down: PointerEvent, at: Vector3) => void

// The drags of the covers that can be dragged, by item id, so a press on the
// window under one can start it.
export const grabs = new Map<string, (down: PointerEvent) => void>()
