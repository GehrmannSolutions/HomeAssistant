import { useEffect, useRef, useState } from 'react'

// The key the card marks its own entries in the browser's history with.
const KEY = 'dioramaBack'
// The key the entry under the card's own keeps Home Assistant's state in.
const HIDDEN = 'dioramaHidden'
// Each use gets its own mark, as every card is its own React root and
// React's ids would repeat. It differs from one load of the page to the
// next, so an entry left from before a reload is never taken for a new one.
const LOAD = Math.random().toString(36).slice(2, 8)
let uses = 0
// The uses still on the page. A card built again leaves its old entry on
// top with no one to answer it.
const live = new Set<string>()

type State = Record<string, unknown> | null
const state = () => history.state as State

// Home Assistant marks the entry of each of its dialogs, like the one the
// card is edited in, and closes the dialog whenever the browser comes back
// to that entry. So while the card's own entry is on top of one, that
// entry's state is put away, and put back once the browser is back on it,
// after Home Assistant has seen it without its marks.
function push(id: string) {
  const below = state()
  if (below && ('dialog' in below || 'dialogData' in below || 'opensDialog' in below))
    history.replaceState({ [HIDDEN]: below }, '')
  // An entry left by a card that is gone is taken over, not stacked on.
  const owner = below?.[KEY]
  if (typeof owner === 'string' && !live.has(owner)) history.replaceState({ [KEY]: id }, '')
  else history.pushState({ [KEY]: id }, '')
}
function restore() {
  const hidden = state()?.[HIDDEN]
  if (hidden) history.replaceState(hidden, '')
}

// While `open`, adds an entry to the browser's history, with the same
// address, so the back button, a phone's own among them, calls `onBack`
// instead of leaving the page or closing the dialog the card sits in. When
// `onBack` returns false the entry goes back on, so whatever is open stays
// open and the next back asks again. Closing any other way takes the entry
// back off.
export function useBackButton(open: boolean, onBack: () => boolean | void, enabled = true) {
  const [id] = useState(() => `${LOAD}:${++uses}`)
  useEffect(() => {
    live.add(id)
    return () => {
      live.delete(id)
    }
  }, [id])
  // Whether the entry this use added is still in the history.
  const added = useRef(false)
  // Whether the card is taking its own entry back off, a back that is not
  // the person's.
  const leaving = useRef(false)
  const back = useRef(onBack)
  useEffect(() => {
    back.current = onBack
  })

  useEffect(() => {
    if (!enabled) return
    if (open && !added.current) {
      push(id)
      added.current = true
    } else if (!open && added.current) {
      added.current = false
      // Only while the entry is still on top, so a page gone on from it
      // since is never sent back.
      if (state()?.[KEY] === id) {
        leaving.current = true
        history.back()
      }
    }
  }, [open, enabled, id])

  useEffect(() => {
    if (!enabled) return
    const onPop = () => {
      if (leaving.current) {
        leaving.current = false
        restore()
        return
      }
      if (!added.current || state()?.[KEY] === id) return
      restore()
      if (back.current() === false) push(id)
      else added.current = false
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [enabled, id])
}

// While a room is in view, the back button takes the camera back to the
// whole home. Flying on to another room keeps the one entry.
export function useBackToHome(inRoom: boolean, goHome: () => void, enabled = true) {
  useBackButton(inRoom, goHome, enabled)
}
