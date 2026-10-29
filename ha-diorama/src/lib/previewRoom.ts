import { useSyncExternalStore } from 'react'

// The room whose tiles the card's settings are working on, so the preview
// in Home Assistant's edit dialog can fly to it and show what is changing.
// Null is the whole home. The settings and the card come from the same
// file, so a value kept here is shared by both.
let room: string | null = null
const listeners = new Set<() => void>()

export function setPreviewRoom(id: string | null) {
  if (id === room) return
  room = id
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const usePreviewRoom = () => useSyncExternalStore(subscribe, () => room)
