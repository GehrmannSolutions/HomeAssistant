import type { EntityState, HomeAssistant } from '#/types.ts'

// What a player puts in the title when it has none.
export const PLACEHOLDER = /^not provided$/i

// The smaller line under what plays: the series of an episode, the artist
// of a song or the channel of a video, or else the album, or else the app
// it plays from. A player that sends a blank in one of them, like a space
// for the artist of an episode, has said nothing there, and one that only
// repeats the title tells nothing new. Null when it tells none of them.
export function bylineOf(told: Record<string, unknown>, app: string | null, title?: unknown): string | null {
  const same = typeof title === 'string' ? title.trim().toLowerCase() : null
  const said = [
    told.media_series_title,
    told.media_artist,
    told.media_album_artist,
    told.media_channel,
    told.media_album_name,
    app,
  ]
  for (const part of said) {
    const shown = typeof part === 'string' ? part.trim() : ''
    if (shown && shown.toLowerCase() !== same) return shown
  }
  return null
}

// What a player does while something is open in it.
const SESSION = ['playing', 'paused', 'buffering']

// A player that only assumes what it does, like a TV box driven as its
// remote, cannot tell what plays in it. Another player of a device with the
// same name, like the one the box casts from, may tell it while something
// is open in it: whether it plays or is paused, and which buttons the app
// takes, as some apps never skip to the next or the previous.
export function twinOf(hass: HomeAssistant, entityId: string, entity: EntityState): EntityState | undefined {
  if (entity.attributes.assumed_state !== true) return undefined
  const registry = hass.entities ?? {}
  const deviceName = (id: string) => {
    const device = hass.devices?.[registry[id]?.device_id ?? '']
    return device?.name_by_user ?? device?.name ?? undefined
  }
  const own = registry[entityId]?.device_id
  const name = deviceName(entityId)
  if (!own || !name) return undefined
  const id = Object.keys(registry).find(
    id =>
      id !== entityId &&
      id.startsWith('media_player.') &&
      registry[id].device_id !== own &&
      deviceName(id) === name &&
      SESSION.includes(hass.states[id]?.state ?? ''),
  )
  return id ? hass.states[id] : undefined
}
