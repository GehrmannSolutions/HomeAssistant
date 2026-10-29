import type { Light, LightShadow, Object3D, Scene } from 'three'

// A room that is focused stands alone, with the doors, windows and blinds in
// its walls whichever side they were put on: the rest of the home is not drawn,
// throws no shadow and takes no press. Hiding the others the usual way would
// take their lamps out of the scene with them, and the count of lights is in
// every shader, so each focus would have had the shaders built again. So the
// things themselves stay where they are and only move to a layer the camera
// does not look at. Three draws, shades and picks by layer, and a light is
// never moved, so nothing about the lights changes.
export const HIDDEN_LAYER = 31

const ROOM = 'room:'
const MERGED = 'merged:'
const DECORATION = 'decoration:'
// A sign on the floor that leads out of the room it is named for. Unlike
// everything else it only shows around that room, never with the whole home.
export const PASSAGE = 'passage:'

// Whether a thing in a wall between two rooms has this one on its other side.
const alsoIn = (object: Object3D, room: string) =>
  (object.userData.rooms as string[] | undefined)?.includes(room) ?? false

// The layers each hidden thing was on, to put it back.
const kept = new WeakMap<Object3D, number>()

function sweep(object: Object3D, room: string | null, hide: boolean) {
  const name = object.name
  if (name.startsWith(PASSAGE)) {
    object.layers.set(room !== null && name.slice(PASSAGE.length) === room ? 0 : HIDDEN_LAYER)
    return
  }
  if (room === null) hide = false
  else if (name.startsWith(ROOM)) hide = name.slice(ROOM.length) !== room
  else if (name.startsWith(MERGED)) hide = name.slice(MERGED.length) !== room
  else if (name.startsWith(DECORATION)) hide = object.userData.room !== room && !alsoIn(object, room)
  if (!(object as Light).isLight) {
    if (hide) {
      if (!kept.has(object)) {
        kept.set(object, object.layers.mask)
        object.layers.set(HIDDEN_LAYER)
      }
    } else {
      const mask = kept.get(object)
      if (mask !== undefined) {
        object.layers.mask = mask
        kept.delete(object)
      }
    }
  }
  for (const child of object.children) sweep(child, room, hide)
}

// Leaves only one room to be seen and pressed, or with null brings the whole
// home back. Cheap enough to run again on every frame a room is focused, so
// a part built since is hidden too.
export function showOnly(scene: Scene, room: string | null) {
  for (const child of scene.children) sweep(child, room, false)
}

// Has every shadow map drawn again. The maps are only redrawn when a caster
// moves, and one changing layer does not count as moving.
export function redrawShadows(scene: Scene) {
  scene.traverse(object => {
    const shadow = (object as Light & { shadow?: LightShadow }).shadow
    if ((object as Light).isLight && shadow) shadow.needsUpdate = true
  })
}
