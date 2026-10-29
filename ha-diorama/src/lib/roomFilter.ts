import { useEffect } from 'react'

// The room the diorama card is showing, told to the Diorama tiles
// so they can show only what is in it. Null shows everything. The filter
// lives in the window, so it is per browser tab and starts empty on every
// load, like the 3D view it follows. tiles says whether the tiles on the
// dashboard follow it too, or only the card's own side panel.
export type RoomFilter = { area_id: string | null; room_id: string | null; tiles: boolean } | null

export const ROOM_FILTER_EVENT = 'dio-room-filter'

declare global {
  interface Window {
    __fpRoomFilter?: RoomFilter
  }
  interface WindowEventMap {
    'dio-room-filter': CustomEvent<RoomFilter>
  }
}

export function roomFilter(): RoomFilter {
  return window.__fpRoomFilter ?? null
}

export function setRoomFilter(filter: RoomFilter) {
  const now = roomFilter()
  if (now?.area_id === filter?.area_id && now?.room_id === filter?.room_id && now?.tiles === filter?.tiles) return
  window.__fpRoomFilter = filter
  window.dispatchEvent(new CustomEvent(ROOM_FILTER_EVENT, { detail: filter }))
}

export function onRoomFilter(listener: (filter: RoomFilter) => void) {
  const handle = (event: CustomEvent<RoomFilter>) => listener(event.detail ?? null)
  window.addEventListener(ROOM_FILTER_EVENT, handle)
  return () => window.removeEventListener(ROOM_FILTER_EVENT, handle)
}

const warned = new Set<string>()

// Tells the tiles which room is in view, and whether the ones on the
// dashboard follow it, and clears the filter when the card goes away. A room with no area set still counts as a room in view,
// but only tiles that wait for their own room hide for it, since no other
// tile could be matched to it.
export function useRoomFilter(room: { id: string; area_id?: string } | undefined, tiles: boolean) {
  const id = room?.id ?? null
  const area = room?.area_id ?? null
  useEffect(() => {
    if (id && !area && tiles && !warned.has(id)) {
      warned.add(id)
      console.warn(`Diorama: room ${id} has no area_id, so it hides only the tiles set to room_filter room or home`)
    }
    setRoomFilter(id ? { area_id: area, room_id: id, tiles } : null)
  }, [id, area, tiles])
  useEffect(() => () => setRoomFilter(null), [])
}
