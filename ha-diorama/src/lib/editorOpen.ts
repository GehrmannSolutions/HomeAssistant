import { useSyncExternalStore } from 'react'

// Whether the fullscreen editor is open. It covers the whole page, and under
// it Home Assistant keeps the card running twice: once on the dashboard and
// once as the preview in its own edit dialog. Each drew the flat with its
// shadows on every frame, unseen, next to the editor's own view. The card
// holds still while this is set, showing its last frame, and carries on
// once the editor closes. The card and the editor come from the same file,
// so a flag kept here is shared by both.
let holders = 0
const listeners = new Set<() => void>()

const emit = () => listeners.forEach(listener => listener())

// Marks the editor open until the returned function is called.
export function holdEditorOpen() {
  holders++
  emit()
  return () => {
    holders--
    emit()
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useEditorOpen = () => useSyncExternalStore(subscribe, () => holders > 0)
