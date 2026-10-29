import { roomLookedFrom, type Between } from '#/decoration/between.ts'
import { claimedSince, LONG_PRESS_MS } from '#/lib/longPress.ts'
import type { Grab } from '#/scene/drags.ts'
import { multiTouchSince } from '#/scene/touches.ts'
import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { PICK_RADIUS_PX, PICK_RADIUS_TOUCH_PX, PICK_ROOM_AT, PICK_ROOM_AT_TOUCH } from '#/theme.ts'
import { Box3, Vector2, Vector3, type Object3D } from 'three'

// What a click on an object does. Models carry it in their userData so a
// pick that lands near them, rather than on them, can still act.
export type Pick = {
  click: () => void
  open: () => void
  // Takes only a press that lands on it, never one that lands near it.
  exact?: boolean
}

// A ray hits exactly one point, and the things in the plan are small seen
// from across a room. When a press lands on nothing, the same press is tried
// again in rings around it, growing outward to PICK_RADIUS_PX, and the first
// thing found takes it. This is the radius a ray cannot have, done with
// several rays.
const RINGS = [0.25, 0.45, 0.65, 0.85, 1]
// Enough directions that a small thing is not slipped between two rays.
const SAMPLES = 16
// A press that moves more than this is the camera being dragged.
const SLOP_PX = 8
// The point in the ring search, counted in rays, at which the floor under
// the press gets its turn. Rounded so 0 and 1 mean exactly first and last.
const roomTurn = (share: number) => Math.round(Math.min(1, Math.max(0, share)) * RINGS.length * SAMPLES)
// How far a press reaches and when the floor gets its turn, for a mouse and
// for a finger. Both search the same way, a finger only further.
const MOUSE = { radius: PICK_RADIUS_PX, roomAt: roomTurn(PICK_ROOM_AT) }
const TOUCH = { radius: PICK_RADIUS_TOUCH_PX, roomAt: roomTurn(PICK_ROOM_AT_TOUCH) }
const reachOf = (e: { pointerType?: string }) => (e.pointerType === 'touch' ? TOUCH : MOUSE)
const ROOM_NAME = 'room:'

// What a press found: a piece, hit outright or nearby, or the floor of a room.
type Found = { kind: 'pick'; pick: Pick; direct: boolean } | { kind: 'room'; id: string }

function pickOf(object: Object3D | null): Pick | null {
  for (let node = object; node; node = node.parent) {
    const pick = node.userData?.pick as Pick | undefined
    if (pick) return pick
  }
  return null
}

type Props = {
  onHandled?: () => void
  // A click that reached the floor of a room, once the pieces around the
  // press have had their turn. Without this the floor takes no clicks.
  onRoom?: (id: string) => void
}

export default function PickFallback({ onHandled, onRoom }: Props = {}) {
  const gl = useThree(state => state.gl)
  const camera = useThree(state => state.camera)
  const scene = useThree(state => state.scene)
  const raycaster = useThree(state => state.raycaster)
  // Passed fresh on every render, so the listeners read the latest one
  // rather than being attached again, which would lose a press under way.
  const latestRoom = useRef(onRoom)
  useLayoutEffect(() => {
    latestRoom.current = onRoom
  })

  useEffect(() => {
    const el = gl.domElement
    const box = new Box3()
    const corner = new Vector3()

    const ray = (x: number, y: number) => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      const ndc = new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return false
      raycaster.setFromCamera(ndc, camera)
      return true
    }

    const at = (x: number, y: number, nearby = false): Pick | null => {
      if (!ray(x, y)) return null
      // Nearest first, so something behind the floor is not picked over it.
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        const pick = pickOf(hit.object)
        // A piece that only takes presses on itself hides what is behind
        // it from a press nearby, and takes nothing from it either.
        if (pick) return nearby && pick.exact ? null : pick
      }
      return null
    }

    // What a press here would drag, and where it lands: the first piece
    // under it that can be dragged, or a window that passes its drag on to
    // the cover over it. A piece in front with nothing to drag hides it.
    const grabAt = (x: number, y: number, nearby = false): { grab: Grab; point: Vector3 } | null => {
      if (!ray(x, y)) return null
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        for (let node: Object3D | null = hit.object; node; node = node.parent) {
          const pick = node.userData?.pick as Pick | undefined
          if (nearby && pick?.exact) return null
          const grab = node.userData?.drag as Grab | undefined
          if (grab) return { grab, point: hit.point }
          if (pick) return null
        }
      }
      return null
    }

    // Whether anything that can be dragged comes within `radius` of the
    // press on screen, going by the box around it. Most presses are nowhere
    // near one, and are spared the rings of rays below.
    const grabbableNear = (x: number, y: number, radius: number) => {
      const rect = el.getBoundingClientRect()
      let found = false
      scene.traverseVisible(node => {
        if (found || !node.userData?.drag) return
        box.setFromObject(node)
        if (box.isEmpty()) return
        let left = Infinity
        let right = -Infinity
        let top = Infinity
        let bottom = -Infinity
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
          corner.project(camera)
          // A corner behind the camera has no place on screen, so the piece
          // is taken as near rather than missed.
          if (corner.z > 1) {
            found = true
            return
          }
          const sx = rect.left + ((corner.x + 1) / 2) * rect.width
          const sy = rect.top + ((1 - corner.y) / 2) * rect.height
          left = Math.min(left, sx)
          right = Math.max(right, sx)
          top = Math.min(top, sy)
          bottom = Math.max(bottom, sy)
        }
        found = x >= left - radius && x <= right + radius && y >= top - radius && y <= bottom + radius
      })
      return found
    }

    // A press that lands on nothing, between the slats of a blind, starts
    // the drag of what can be dragged nearby, as a click there clicks it.
    // A press on a piece is the piece's own business.
    const grabNear = (e: PointerEvent) => {
      const { clientX: x, clientY: y } = e
      const reach = reachOf(e)
      if (!grabbableNear(x, y, reach.radius)) return
      if (at(x, y) || grabAt(x, y)) return
      for (const step of RINGS) {
        const radius = step * reach.radius
        for (let i = 0; i < SAMPLES; i++) {
          const angle = ((i + 0.5) / SAMPLES) * Math.PI * 2
          const found = grabAt(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, true)
          if (found) return found.grab(e, found.point)
        }
      }
    }

    // The room the first thing under the press belongs to, if any: its
    // floor, or a piece standing in it that has nothing of its own to do,
    // which is taken as the floor it stands on.
    const roomAt = (x: number, y: number): string | null => {
      if (!ray(x, y)) return null
      const hit = raycaster.intersectObjects(scene.children, true)[0]
      if (!hit) return null
      for (let node: Object3D | null = hit.object; node; node = node.parent) {
        if (node.name.startsWith(ROOM_NAME)) return node.name.slice(ROOM_NAME.length)
        if (node.userData?.pick) return null
        // A piece in a wall between two rooms stands for the one it is
        // looked at from.
        const between = node.userData?.between as Between | undefined
        if (between) {
          const look = camera.getWorldDirection(new Vector3())
          return roomLookedFrom(between, node.position.x, node.position.z, node.rotation.y, look, camera.position)
        }
        const room = node.userData?.room as string | undefined
        if (room) return room
      }
      return null
    }

    // The press itself first, then wider and wider rings around it. The
    // floor under the press gets its turn part way through, where
    // PICK_ROOM_AT says, so pieces near the press come before the room they
    // stand in. A long press or a right click has nothing to do with the
    // floor, so those skip it.
    const near = (x: number, y: number, withRoom: boolean, reach = MOUSE): Found | null => {
      const direct = at(x, y)
      if (direct) return { kind: 'pick', pick: direct, direct: true }
      const room = withRoom && latestRoom.current ? roomAt(x, y) : null
      let tried = 0
      for (const step of RINGS) {
        const radius = step * reach.radius
        for (let i = 0; i < SAMPLES; i++) {
          if (room && tried === reach.roomAt) return { kind: 'room', id: room }
          const angle = ((i + 0.5) / SAMPLES) * Math.PI * 2
          const pick = at(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, true)
          if (pick) return { kind: 'pick', pick, direct: false }
          tried++
        }
      }
      return room ? { kind: 'room', id: room } : null
    }

    let from: { x: number; y: number; at: number; reach: typeof MOUSE } | null = null
    // Where the right button went down, until it drags or comes up.
    let rightFrom: { x: number; y: number } | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let opened = false
    // The press under way has had its long press, whether or not it found a
    // dialog to open.
    let held = false
    // The browser raised its menu for the press under way, which is a long
    // press however soon it came. Its release is then never a click.
    let menu = false
    const stop = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }

    // A long press asks for the dialog of whatever is near, as far out as a
    // click from the same pointer reaches. It never asks for the floor.
    const longPress = () => {
      stop()
      if (!from || held) return
      held = true
      // Two fingers held still are a pinch about to start, and a press that
      // already dragged a blind has done its part.
      if (multiTouchSince(from.at) || claimedSince(from.at)) return
      const found = near(from.x, from.y, false, from.reach)
      // A direct hit is the object's own business, it has handlers of its
      // own. This only speaks for presses that landed on nothing.
      if (found?.kind === 'pick' && !found.direct) {
        opened = true
        onHandled?.()
        found.pick.open()
      }
    }

    const onDown = (e: PointerEvent) => {
      from = null
      rightFrom = null
      opened = false
      held = false
      menu = false
      stop()
      if (e.button === 2) {
        rightFrom = { x: e.clientX, y: e.clientY }
        return
      }
      // Only the left button presses. Any other is the camera's.
      if (e.button !== 0) return
      // When it went down by the event's own time, not by when it was
      // handled: a busy moment between press and release would otherwise
      // make a quick click look long.
      from = { x: e.clientX, y: e.clientY, at: e.timeStamp, reach: reachOf(e) }
      timer = setTimeout(longPress, LONG_PRESS_MS)
      grabNear(e)
    }

    const onMove = (e: PointerEvent) => {
      const start = from ?? rightFrom
      if (!start) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) {
        stop()
        from = null
        rightFrom = null
      }
    }

    const onUp = (e: PointerEvent) => {
      stop()
      const start = from
      const right = rightFrom
      from = null
      rightFrom = null
      // A right click let go where it went down asks for the dialog of
      // whatever is near. A right drag has moved the camera and asks nothing.
      if (right && e.button === 2) {
        const found = near(e.clientX, e.clientY, false)
        if (found?.kind === 'pick' && !found.direct) {
          onHandled?.()
          found.pick.open()
        }
        return
      }
      if (!start) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) return
      // A long press is spent when it is let go: it clicks nothing, goes to
      // no room, and is not a press on nothing that sends the camera home.
      // How long it was held is read from the events, so a timer that only
      // ran late, after a busy moment, does not spend a quick click.
      if (opened || menu || e.timeStamp - start.at > LONG_PRESS_MS) {
        onHandled?.()
        return
      }
      const found = near(e.clientX, e.clientY, true, reachOf(e))
      if (found?.kind === 'room') {
        onHandled?.()
        latestRoom.current?.(found.id)
      } else if (found && !found.direct) {
        onHandled?.()
        found.pick.click()
      }
    }

    // A press the browser takes away, to scroll the page or to show a menu
    // of its own, was never let go, so it does nothing.
    const onCancel = () => {
      stop()
      from = null
      rightFrom = null
    }

    // The menu is kept away from anything that has a dialog to open instead.
    // The opening itself waits for the button to come up, above.
    const onContext = (e: MouseEvent) => {
      // A touch screen asks for the menu when a finger has been held down,
      // and some ask sooner than the timer here runs out. That is the long
      // press, taken there and then, and the menu has no place over the plan.
      if (from) {
        const touch = from.reach === TOUCH
        menu = true
        longPress()
        if (opened || touch) e.preventDefault()
        return
      }
      const found = near(e.clientX, e.clientY, false)
      if (found?.kind === 'pick' && !found.direct) e.preventDefault()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('contextmenu', onContext)
    return () => {
      stop()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('contextmenu', onContext)
    }
  }, [gl, camera, scene, raycaster, onHandled])

  return null
}
