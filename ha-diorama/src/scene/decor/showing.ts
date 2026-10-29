import { appOf, PACKAGE } from '#/tiles/apps.ts'
import { bylineOf, PLACEHOLDER, twinOf } from '#/tiles/playing.ts'
import type { HomeAssistant } from '#/types.ts'
import { useEffect, useState } from 'react'

// What a player that is on shows on its screen, the way its card shows it:
// the cover art, or else the colors of its app drifting, with the app's
// logo in the top left corner and what plays in the bottom left one.
export type Showing = {
  colors: [string, string, string]
  art: string | null
  // A logo for a dark screen, and whether it is drawn in a single color,
  // made white.
  logo: { src: string; mono: boolean } | null
  title: string | null
  // The artist, the album or the app, in a smaller line under the title,
  // as on the card.
  subtitle: string | null
  playing: boolean
}

const OFF = ['off', 'standby', 'unavailable', 'unknown']
// The colors of a player that plays from an app it does not know, or that
// tells of none, the same as on its card.
const NEUTRAL: Showing['colors'] = ['#0a9a7c', '#7c8aa5', '#5b6b8c']

// What the player behind a screen shows. Null for a screen bound to
// anything but a player, which keeps the colors it always had.
export function showingOf(hass: HomeAssistant, entityId: string): Showing | null {
  if (!entityId.startsWith('media_player.')) return null
  const entity = hass.states[entityId]
  if (!entity || OFF.includes(entity.state)) return null
  const media = twinOf(hass, entityId, entity) ?? entity
  const told = media.attributes
  const known = appOf(entity.attributes.app_name, entity.attributes.app_id)
  const said =
    typeof told.media_title === 'string' && told.media_title.trim() && !PLACEHOLDER.test(told.media_title.trim())
      ? told.media_title.trim()
      : null
  const app =
    known?.name ??
    (typeof entity.attributes.app_name === 'string' && !PACKAGE.test(entity.attributes.app_name)
      ? entity.attributes.app_name
      : null)
  // The line under the title, as on the card.
  const artist = bylineOf(told, app, said)
  return {
    colors: known?.colors ?? NEUTRAL,
    art: typeof told.entity_picture === 'string' ? told.entity_picture : null,
    logo: known ? { src: known.logo.dark, mono: !!known.logo.mono } : null,
    // With nothing told of what plays, that line takes its place, which is
    // the name of the app as people know it rather than as its package.
    title: said ?? artist,
    // With nothing else to tell under a title, it says the player is on.
    subtitle: said ? (artist ?? 'On') : null,
    playing: media.state === 'playing',
  }
}

export function sameShowing(a: Showing | null | undefined, b: Showing | null | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.art === b.art &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.playing === b.playing &&
    a.logo?.src === b.logo?.src &&
    a.colors.every((color, i) => color === b.colors[i])
  )
}

// Pictures by their address, loaded once for every screen that shows them.
// A cover that would not load, or that the page may not read, is null.
type Loaded = { image: HTMLImageElement; color: string } | null
const pictures = new Map<string, Loaded | Promise<Loaded>>()

// The main color of a picture: the average of its pixels, each weighed by
// how colorful it is, so a grey background does not wash out the one
// color it is about.
function mainColor(image: HTMLImageElement) {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, size, size)
  const data = context.getImageData(0, 0, size, size).data
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2])
    const min = Math.min(data[i], data[i + 1], data[i + 2])
    const weight = (max - min) / 255 + 0.02
    r += data[i] * weight
    g += data[i + 1] * weight
    b += data[i + 2] * weight
    total += weight
  }
  const hex = (n: number) =>
    Math.round(n / total)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function load(src: string): Promise<Loaded> {
  return new Promise(resolve => {
    const image = new Image()
    if (!src.startsWith('data:')) image.crossOrigin = 'anonymous'
    image.onload = () => {
      let color: string | null = null
      try {
        color = mainColor(image)
      } catch {
        // A picture from elsewhere that the page may not read.
        resolve(null)
        return
      }
      resolve(color ? { image, color } : null)
    }
    image.onerror = () => resolve(null)
    image.src = src
  })
}

// A picture once it has loaded, and null until then or if it never does.
// Kept in state rather than read from the cache while drawing, since the
// compiler holds on to what a render read for as long as `src` stays the
// same, and would never see it arrive.
export function usePicture(src: string | null | undefined) {
  const [shown, setShown] = useState<{ src: string; loaded: Loaded } | null>(null)
  useEffect(() => {
    if (!src) return
    let live = true
    let known = pictures.get(src)
    if (!known) {
      // Only a few covers are kept, the ones of what played last.
      if (pictures.size > 24) pictures.delete(pictures.keys().next().value!)
      known = load(src).then(loaded => {
        pictures.set(src, loaded)
        return loaded
      })
      pictures.set(src, known)
    }
    void Promise.resolve(known).then(loaded => live && setShown({ src, loaded }))
    return () => {
      live = false
    }
  }, [src])
  return shown && shown.src === src ? shown.loaded : null
}

// The color the light of a screen showing this takes: the main color of
// its cover art once it has loaded, and its app's own until then.
export function useShowingColor(showing: Showing | null | undefined) {
  const cover = usePicture(showing?.art)
  if (!showing) return null
  return cover?.color ?? showing.colors[0]
}
