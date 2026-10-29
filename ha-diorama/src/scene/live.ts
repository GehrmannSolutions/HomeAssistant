import { LIVE_FPS, LIVE_REST_MS } from '#/constants.ts'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Mesh, type Object3D } from 'three'

// The card draws a frame only when something in it has changed: a light
// switching, the camera moving, a door swinging. A room that sits still
// costs nothing, which on a tablet on the wall is most of the day. Whatever
// changes the scene by hand, in a frame callback rather than through React,
// has to ask for the next frame itself, and these are the two ways to ask.

// Keeps frames coming for as long as `active`: for a fan that spins, a
// picture that plays, a flame that flickers. They come a few times a second,
// see LIVE_FPS, since asked for on every frame a spinning fan alone kept the
// card drawing sixty a second. Anything else that moves, the camera or a
// light fading, still asks for every frame, and what plays here moves on
// each of those too. The first frame is asked for when it turns on, and the
// last one when it turns off, so what it leaves behind is drawn too.
// It rests after LIVE_REST_MS with no change to its device, which is when
// the model calling this draws again, and with no touch on the card. It
// stops where it is until either comes.
export function useLive(active: boolean) {
  const invalidate = useThree(state => state.invalidate)
  const canvas = useThree(state => state.gl.domElement)
  const user = useRef<User | null>(null)
  useEffect(() => {
    invalidate()
    if (!active) return
    const u: User = { awake: false, timer: undefined }
    user.current = u
    const leave = beat(invalidate, canvas, u)
    return () => {
      user.current = null
      leave()
    }
  }, [active, invalidate, canvas])
  // A model draws again only when what it shows of its device changes, so
  // each time it does, what moves in it wakes for a while.
  useEffect(() => {
    const u = user.current
    if (u) wake(invalidate, u)
  })
}

type User = { awake: boolean; timer: ReturnType<typeof setTimeout> | undefined }

// What moves on its own in one card: who is in it, and the timer that asks
// for its frames while any of them is awake. Keyed by the card's
// `invalidate`.
type Card = {
  users: Set<User>
  id: ReturnType<typeof setInterval> | undefined
  stop: () => void
}
const cards = new Map<() => void, Card>()

// Whether the card is drawing a few times a second for what moves on its
// own, so a gap that long between frames is that pace and not a slow frame.
export const beating = (invalidate: () => void) => cards.get(invalidate)?.id !== undefined

function beat(invalidate: () => void, canvas: HTMLElement, user: User) {
  let card = cards.get(invalidate)
  if (!card) {
    const c: Card = { users: new Set(), id: undefined, stop: () => {} }
    // A touch on the card, or the pointer over it, wakes everything in it.
    const touched = () => c.users.forEach(u => wake(invalidate, u))
    const events = ['pointerdown', 'pointermove', 'wheel'] as const
    events.forEach(e => canvas.addEventListener(e, touched, { passive: true }))
    c.stop = () => events.forEach(e => canvas.removeEventListener(e, touched))
    cards.set(invalidate, c)
    card = c
  }
  const c = card
  c.users.add(user)
  wake(invalidate, user)
  return () => {
    clearTimeout(user.timer)
    c.users.delete(user)
    pace(invalidate, c)
    if (c.users.size > 0) return
    c.stop()
    cards.delete(invalidate)
  }
}

function wake(invalidate: () => void, user: User) {
  const card = cards.get(invalidate)
  if (!card) return
  clearTimeout(user.timer)
  user.timer = setTimeout(() => {
    user.awake = false
    pace(invalidate, card)
  }, LIVE_REST_MS)
  if (user.awake) return
  user.awake = true
  pace(invalidate, card)
}

// Starts the timer when the first one wakes and stops it when the last one
// rests.
function pace(invalidate: () => void, card: Card) {
  const any = [...card.users].some(u => u.awake)
  if (any && card.id === undefined) {
    invalidate()
    card.id = setInterval(invalidate, 1000 / LIVE_FPS)
  } else if (!any && card.id !== undefined) {
    clearInterval(card.id)
    card.id = undefined
  }
}

// Asks for a frame at the top of every second, for a clock. A frame
// callback alone would never run while the room sits still.
export function useEverySecond() {
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>
    const arm = () => {
      id = setTimeout(
        () => {
          invalidate()
          arm()
        },
        1000 - (Date.now() % 1000) + 5,
      )
    }
    arm()
    return () => clearTimeout(id)
  }, [invalidate])
}

// Leaves what moves on its own out of the shadows, a fan's blades, a drum, a
// robot on its rounds. Each frame it moves would have the sun's map and the
// lamps' near it drawn again, the most costly part of a frame, for a shadow
// nobody follows. Called on each frame, so parts that load later are caught.
export function shadowless(object: Object3D | null) {
  object?.traverse(part => {
    if (part instanceof Mesh && !part.userData.noShadow) part.userData.noShadow = true
  })
}
