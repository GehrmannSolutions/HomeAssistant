import { claim } from '#/lib/longPress.ts'
import { cn } from '#/lib/utils.ts'
import { appOf, PACKAGE } from '#/tiles/apps.ts'
import { bylineOf, PLACEHOLDER, twinOf } from '#/tiles/playing.ts'
import { callService, entityName, formatState, haptic, type TileEnv } from '#/tiles/actions.ts'
import { useArmed, useConfirm } from '#/tiles/twice.ts'
import { Control } from '#/tiles/Control.tsx'
import { MEDIA, VolumeSlider } from '#/tiles/features/media.tsx'
import { numberOf, supports } from '#/tiles/features/parts.tsx'
import { useNow } from '#/tiles/history.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Panel } from '#/tiles/Panel.tsx'
import { cornerOf, CornerKeys, remoteOf, RemoteKeys, type RemoteConfig } from '#/tiles/cards/Remote.tsx'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'

const OFF = ['off', 'standby', 'unavailable', 'unknown']
// The colors of the light behind a card that plays from an app it does
// not know, or that tells of none.
const NEUTRAL = ['var(--_accent-media)', '#7c8aa5', '#5b6b8c']
// How far a finger goes sideways before the press is a drag along the song.
const SLOP_PX = 8
// How long the lit card takes to fade into what plays once it is on.
const WAKE_FADE_MS = 700
// How long the card with the remote shows as on or off before the player
// says so, at most.
const GOING_MS = 20000
// How long the card with the remote takes to grow, as its height eases.
const GROW_MS = 300
// Where a tap on the card can turn it on from.
const ASLEEP = ['off', 'standby']

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const hours = Math.floor(minutes / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes % 60)}:${pad(whole % 60)}` : `${minutes}:${pad(whole % 60)}`
}

// What the progress leaves out: the boxes that hold the buttons and the
// volume, so it passes behind them without showing through.
const HOLES = '.dio-media-buttons, .dio-slider, .dio-media-small[aria-checked="true"], .dio-pad, .dio-volume'

// A mask the size of the card, clear where each box is, with its corners.
const holes = (tile: HTMLElement) => {
  const card = tile.getBoundingClientRect()
  if (!card.width || !card.height) return undefined
  const rects = [...tile.querySelectorAll<HTMLElement>(HOLES)].map(hole => {
    const box = hole.getBoundingClientRect()
    // A box that grows while it is pressed is measured at its own size.
    const width = hole.offsetWidth
    const height = hole.offsetHeight
    const x = box.left + box.width / 2 - width / 2 - card.left
    const y = box.top + box.height / 2 - height / 2 - card.top
    const corner = getComputedStyle(hole).borderTopLeftRadius
    const radius = corner.endsWith('%') ? height / 2 : Math.min(parseFloat(corner) || 0, height / 2)
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/>`
  })
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${card.width}" height="${card.height}">` +
    `<mask id="m"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join('')}</g></mask>` +
    `<rect width="100%" height="100%" mask="url(#m)"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export type MediaControlConfig = TileConfig & {
  // Where the cover art goes: washed large and blurred behind the whole
  // card, or square in place of the icon.
  art?: 'background' | 'icon'
  // With the remote, like the remote card: a command of its own for a key,
  // and another player for the volume, for a player that is not on the
  // same device as its remote.
  commands?: RemoteConfig['commands']
  volume_entity?: string
  power_entity?: RemoteConfig['power_entity']
}

// What is playing, with the cover art washed large and blurred behind the
// whole card, or square in place of the icon: the title and the artist in
// the bottom left corner where a tile has its name, the buttons to play it
// in the top right with how far into it it is on their left, and across
// from the title its volume, with shuffle and repeat to its right. The
// card fills from the left as far into the song as it is, faintly, and a
// drag sideways anywhere on it moves along the song when the player can.
// A tap plays or pauses it, and a long press opens the player's dialog.
// While it is off, play still shows, greyed out, and the card turns it on
// as the double tap toggle does: the first tap lights half of it, which
// runs back, and a second one in time lights it all and turns it on. The
// lit card stays until it is on, then fades into what plays. A power
// button beside play turns it off on a second press within a few seconds.
// A player that cannot tell what plays in it takes that from another of a
// device with the same name, like the one a TV box casts from, which also
// says which buttons the app takes.
// Playing from a known app with no cover art, the app's logo takes the
// place of the icon, and a soft light in the app's colors drifts behind
// the card, or in quieter colors for any other app.
// Made two rows tall or half as wide, it leaves out the volume, shuffle and
// repeat, and keeps the buttons and how far in it is. Half as wide, it
// also leaves out the icon, so the buttons fit across the top.
// With `remote`, it is the media card with the remote: two rows across the
// whole width while it is off, with only its icon, its name and its state,
// and turned on by the double tap. Once on, it grows to show the remote's pad and
// volume under what plays, and has back, home and power in a group of their
// own beside the buttons that play it. Power turns it off on a second press.
export default function MediaControl({
  env,
  config,
  remote = false,
}: {
  env: TileEnv
  config: MediaControlConfig
  remote?: boolean
}) {
  const entity = env.hass.states[config.entity!]
  const attributes = entity?.attributes ?? {}
  const off = !entity || OFF.includes(entity.state)
  // The remote of the same device, for its keys and, when the player
  // cannot, to turn it on and off.
  const keys = remote
    ? remoteOf(env.hass, { entity: config.entity, commands: config.commands, volume_entity: config.volume_entity })
    : null
  const switcher = keys?.keys?.entity.startsWith('remote.') ? keys.keys.entity : undefined
  const turnOf = (on: boolean) => {
    const turn = on ? 'turn_on' : 'turn_off'
    if (config.power_entity)
      return () => callService(env.hass, `homeassistant.${turn}`, { entity_id: config.power_entity })
    if (supports(entity, on ? MEDIA.turnOn : MEDIA.turnOff))
      return () => callService(env.hass, `media_player.${turn}`, { entity_id: config.entity })
    if (switcher) return () => callService(env.hass, `remote.${turn}`, { entity_id: switcher })
    return null
  }
  const wakeUp = turnOf(true)
  const wakes = !!entity && ASLEEP.includes(entity.state) && !!wakeUp
  // With the remote, the card does not wait for the player to say it is on
  // or off, which can take a few seconds: it grows or shrinks at once, and
  // what plays comes in once the player tells it.
  const [going, setGoing] = useState<'on' | 'off' | null>(null)
  const [wasOff, setWasOff] = useState(off)
  const [leaving, setLeaving] = useState(false)
  const confirm = useConfirm(!off, () => {
    if (remote) {
      setGoing('on')
      setLeaving(true)
    }
    wakeUp?.()
  })
  const { lit } = confirm
  // The lit card, filled by the second tap, fades out once it is on, or at
  // once with the remote, as the card grows.
  if (wasOff !== off) {
    setWasOff(off)
    setLeaving(!off && confirm.step === 2 && !remote)
  }
  if (going && (going === 'on') !== off) setGoing(null)
  useEffect(() => {
    if (!going) return
    const timer = setTimeout(() => setGoing(null), GOING_MS)
    return () => clearTimeout(timer)
  }, [going])
  // Whether the lit card shows, filled by the taps that turn it on.
  const lighting = (wakes && going !== 'on') || leaving
  // Whether the card with the remote shows as on.
  const shownOn = going ? going === 'on' : !off
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLeaving(false), WAKE_FADE_MS)
    return () => clearTimeout(timer)
  }, [leaving])
  const sendOff = off ? null : turnOf(false)
  const turnOff =
    sendOff &&
    (() => {
      if (remote) setGoing('off')
      sendOff()
    })
  const power = useArmed(off, turnOff)
  // Where what plays is told, and where the buttons that play it go.
  const media = entity && !off ? (twinOf(env.hass, config.entity!, entity) ?? entity) : entity
  const told = media?.attributes ?? {}
  const playing = media?.state === 'playing'
  // A player that only says it is on, like some TVs, never tells whether it
  // plays or is paused, so its button shows both.
  // Some apps cast to a box, like Netflix, say they play even while paused,
  // and then tell neither how far in nor how long it is, so their button
  // shows both too.
  const unsure =
    !!media &&
    (!['playing', 'paused', 'idle', 'buffering'].includes(media.state) ||
      (media !== entity && playing && told.media_position == null && told.media_duration == null))
  const picture = typeof told.entity_picture === 'string' ? told.entity_picture : null
  const square = config.art === 'icon'
  const { rows, columns } = config.grid_options ?? {}
  const narrow = !remote && typeof columns === 'number' && columns <= 6
  const compact = !remote && (narrow || (typeof rows === 'number' && rows <= 2))
  // The remote's pad and volume show under what plays while it is on.
  const pad = !!keys && shownOn
  const cover = square && !off ? picture : null
  const said = typeof told.media_title === 'string' ? told.media_title : null
  // A player with nothing to tell, like a speaker playing from a phone over
  // the air, says so in the title, which then goes under the player's name.
  const blank = said !== null && PLACEHOLDER.test(said.trim())
  const title = blank ? null : said
  // A known app goes by its own name, with its logo in place of the icon.
  // Any other is named only by a name of its own, never by a package id
  // like com.example.app, which is all some players know of an app they
  // have no name for.
  const known = off ? null : appOf(attributes.app_name, attributes.app_id)
  const app =
    known?.name ??
    (typeof attributes.app_name === 'string' && !PACKAGE.test(attributes.app_name) ? attributes.app_name : null)
  // With no cover art behind it, a card that is on has a soft light behind
  // it in the colors of its app, which drifts while it plays.
  const glow = !off && going !== 'off' && !(picture && !square) ? (known?.colors ?? NEUTRAL) : null
  const artist = bylineOf(told, app, title)
  const duration = numberOf(media, 'media_duration')
  const position = numberOf(media, 'media_position')
  const updated = typeof told.media_position_updated_at === 'string' ? told.media_position_updated_at : null
  const now = useNow(1000)
  // The position moves on from when the player last said where it was.
  const at = position === null ? null : playing && updated ? position + (now - Date.parse(updated)) / 1000 : position
  const run =
    (service: string, entityId = config.entity) =>
    () =>
      callService(env.hass, `media_player.${service}`, { entity_id: entityId })
  const has = (bit: number) => supports(entity, bit)
  // What the player of what plays can do. A button goes to the player
  // itself when it can take it, as a box's own keys work in any app even
  // with nothing open yet, and to the player of what plays otherwise.
  const can = (bit: number) => supports(media, bit)
  const play = (service: string, bit: number) => run(service, has(bit) ? config.entity : media?.entity_id)
  // With the remote, play and pause go as its key when it has one, which
  // works in any app, as some apps cast to a box, like Netflix, refuse a
  // pause sent to the player.
  const playKey = keys?.reach('play') ?? null
  const playable = !off && (!!playKey || can(playing ? MEDIA.pause : MEDIA.play))
  const playPause = playKey ?? play('media_play_pause', playing ? MEDIA.pause : MEDIA.play)
  const name = entityName(config, entity)
  const timed = !off && duration !== null && duration > 0 && at !== null
  const seekable = timed && can(MEDIA.seek)
  // Where a drag along the song is, from 0 to 1, until it lets go.
  const [drag, setDrag] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // Turned on from the card, it scrolls into view once it has grown, so
  // the remote under it is never left below the edge.
  useEffect(() => {
    if (going !== 'on') return
    const timer = setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), GROW_MS)
    return () => clearTimeout(timer)
  }, [going])
  const start = useRef<{ x: number; y: number; from: number; dragging: boolean } | null>(null)
  const share = drag ?? (timed ? Math.min(at / duration, 1) : 0)
  // The window listeners outlive a render, so they reach the latest ones
  // through here.
  const latest = useRef({ drag, duration, entityId: media?.entity_id, hass: env.hass })
  useEffect(() => {
    latest.current = { drag, duration, entityId: media?.entity_id, hass: env.hass }
  })
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = start.current
      if (!s || !box.current) return
      const along = e.clientX - s.x
      if (!s.dragging) {
        if (Math.abs(along) < SLOP_PX || Math.abs(along) < Math.abs(e.clientY - s.y)) return
        s.dragging = true
        claim()
      }
      setDrag(Math.min(1, Math.max(0, s.from + along / box.current.getBoundingClientRect().width)))
    }
    const up = () => {
      const s = start.current
      start.current = null
      if (!s?.dragging) return
      const { drag, duration, entityId, hass } = latest.current
      setDrag(null)
      if (drag === null || !duration) return
      haptic('selection')
      void callService(hass, 'media_player.media_seek', {
        entity_id: entityId,
        seek_position: Math.round(drag * duration),
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])
  // The boxes move when the card changes size or shows other buttons, so
  // they are measured again after every render and on every resize.
  const [mask, setMask] = useState<string>()
  const measure = useRef(() => {})
  useLayoutEffect(() => {
    measure.current = () => {
      const tile = box.current?.querySelector<HTMLElement>('.dio-tile')
      if (tile) setMask(holes(tile))
    }
    measure.current()
  })
  useEffect(() => {
    if (!box.current) return
    const observer = new ResizeObserver(() => measure.current())
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [])
  // A drag that starts on the volume or a button is theirs.
  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !seekable) return
    if ((e.target as Element).closest('button, [role="slider"], .dio-feature, .dio-control, .dio-pad')) return
    start.current = { x: e.clientX, y: e.clientY, from: share, dragging: false }
  }
  // While it waits for the second tap, and once that is sent until it is on.
  const waking = confirm.waiting
    ? 'Tap again to turn on'
    : confirm.step === 2 || leaving || going === 'on'
      ? 'Turning on'
      : going === 'off'
        ? 'Turning off'
        : null
  const looks = cn('dio-media-control', compact && 'dio-media-compact', narrow && 'dio-media-narrow')
  const powerOff = turnOff && (
    <Control
      icon="ph:power-bold"
      label={power.armed ? 'Press again to turn off' : 'Turn off'}
      className={power.className}
      style={power.style}
      onPress={power.press}
    />
  )
  // The buttons that play it, in the top right, or beside the remote's pad
  // above its volume while the pad shows.
  const buttons = (
    <div className="dio-media-buttons">
      {!off && can(MEDIA.previous) && (
        <Control icon="ph:skip-back" label="Previous" onPress={play('media_previous_track', MEDIA.previous)} />
      )}
      {off && <Control icon="ph:play" label="Play" disabled onPress={() => {}} />}
      {playable && (
        <Control
          icon={unsure ? 'ph:play-pause' : playing ? 'ph:pause' : 'ph:play'}
          label={unsure ? 'Play or pause' : playing ? 'Pause' : 'Play'}
          onPress={playPause}
        />
      )}
      {!off && can(MEDIA.next) && (
        <Control icon="ph:skip-forward" label="Next" onPress={play('media_next_track', MEDIA.next)} />
      )}
      {!remote && powerOff}
    </div>
  )
  const time = timed && <span className="dio-media-time">{clock(share * duration)}</span>
  const shuffle = !off && can(MEDIA.shuffle) && (
    <Control
      icon="ph:shuffle"
      label="Shuffle"
      className="dio-media-small"
      role="radio"
      checked={told.shuffle === true}
      onPress={() =>
        callService(env.hass, 'media_player.shuffle_set', {
          entity_id: media?.entity_id,
          shuffle: told.shuffle !== true,
        })
      }
    />
  )
  const repeat = !off && can(MEDIA.repeat) && (
    <Control
      icon={told.repeat === 'one' ? 'ph:repeat-once' : 'ph:repeat'}
      label="Repeat"
      className="dio-media-small"
      role="radio"
      checked={told.repeat === 'all' || told.repeat === 'one'}
      onPress={() =>
        callService(env.hass, 'media_player.repeat_set', {
          entity_id: media?.entity_id,
          repeat: told.repeat === 'off' ? 'all' : told.repeat === 'all' ? 'one' : 'off',
        })
      }
    />
  )
  const volume = entity && !off && has(MEDIA.volumeSet) && (
    <div className="dio-feature">
      <VolumeSlider env={env} config={config} entity={entity} />
    </div>
  )
  return (
    <div
      ref={box}
      className={cn('dio-media-seek', lighting && 'dio-fill dio-confirm dio-media-wake')}
      data-seekable={seekable || undefined}
      data-dragging={drag !== null || undefined}
      data-step={lighting ? confirm.step : undefined}
      data-leaving={leaving || undefined}
      data-remote={remote || undefined}
      data-on={(remote && shownOn) || undefined}
      style={{ '--_wake-ms': `${WAKE_FADE_MS}ms` } as CSSProperties}
      onPointerDownCapture={down}
    >
      <Panel
        env={env}
        config={{ ...config, name: off || going ? name : (title ?? name) }}
        entity={entity}
        state={
          (off || going ? waking : null) ??
          (off
            ? formatState(env.hass, entity)
            : blank
              ? said
              : (artist ?? (title ? 'On' : formatState(env.hass, entity))))
        }
        accent="var(--_accent-media)"
        onTap={wakes ? confirm.tap : playable ? playPause : null}
        className={cn(
          looks,
          cover && 'dio-media-cover',
          glow && !playing && 'dio-media-still',
          pad && 'dio-remote dio-media-remote',
        )}
        picture={cover ?? undefined}
        // Over the cover art, which is darkened, or the dark lights of the
        // app, the logo is the one for a dark card whatever the theme.
        logo={known && ((picture && !square) || glow) ? { ...known.logo, light: known.logo.dark } : known?.logo}
        style={
          {
            '--_art': picture && !square && going !== 'off' ? `url("${picture}")` : undefined,
            '--_glow-a': glow?.[0],
            '--_glow-b': glow?.[1],
            '--_glow-c': glow?.[2],
            '--_progress': timed ? `${share * 100}%` : undefined,
            '--_holes': timed ? mask : undefined,
          } as CSSProperties
        }
        controls={
          entity &&
          (remote && !shownOn ? null : (
            <>
              {!remote && time}
              {!pad && buttons}
              {remote && (keys || powerOff) && (
                <div className="dio-media-buttons">
                  {keys && <CornerKeys corner={cornerOf(keys.reach)} />}
                  {powerOff}
                </div>
              )}
            </>
          ))
        }
      >
        {pad && keys && <RemoteKeys sendOf={keys.reach} muted={keys.muted} above={buttons} />}
        {!compact && !remote && (shuffle || repeat || volume) && (
          <div className="dio-media-row">
            {volume}
            {shuffle}
            {repeat}
          </div>
        )}
      </Panel>
      {lighting && (
        // A lit copy of the card as it was while off, cut off where the
        // light ends. It starts cut off, so it never shows before it is
        // placed.
        <div ref={lit} className="dio-fill-lit" style={{ clipPath: 'inset(0 100% 0 0)' }} inert>
          <Panel
            env={env}
            config={{ ...config, name }}
            entity={entity}
            state={waking ?? formatState(env.hass, entity)}
            accent="var(--_accent-media)"
            active
            onTap={null}
            className={looks}
            controls={
              !remote && (
                <div className="dio-media-buttons">
                  <Control icon="ph:play" label="Play" disabled onPress={() => {}} />
                </div>
              )
            }
          />
        </div>
      )}
    </div>
  )
}

// The media card with the remote under it while it is on.
export function MediaRemote(props: { env: TileEnv; config: MediaControlConfig }) {
  return <MediaControl {...props} remote />
}
