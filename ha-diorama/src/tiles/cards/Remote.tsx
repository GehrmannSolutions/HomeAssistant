import { cn } from '#/lib/utils.ts'
import { callService, formatState, haptic, type TileEnv } from '#/tiles/actions.ts'
import { useArmed } from '#/tiles/twice.ts'
import { Control } from '#/tiles/Control.tsx'
import { MEDIA } from '#/tiles/features/media.tsx'
import { supports } from '#/tiles/features/parts.tsx'
import { insideTile } from '#/tiles/gestures.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Icon } from '#/tiles/Icon.tsx'
import { Panel } from '#/tiles/Panel.tsx'
import type { HomeAssistant } from '#/types.ts'
import { useEffect, useRef, type ReactNode } from 'react'

export type Key =
  'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home' | 'mute' | 'volume_up' | 'volume_down' | 'play'

// A command of its own for a key: the name of one the remote sends, or any
// action, like a script.
type Command = string | { action: string; data?: Record<string, unknown> }

export type RemoteConfig = TileConfig & {
  // The player whose volume the volume keys and mute change, like the TV
  // when the remote is a box plugged into it.
  volume_entity?: string
  // False leaves out the power key, as the side panel does when a toggle
  // for the same entity is already there.
  power?: boolean
  // Entities whose cards beside it already turn things on and off, set by
  // the side panel. The power key is left out when one is of its device.
  power_beside?: string[]
  // What power turns on and off instead, like a script or a toggle that
  // also sets the room for it. The state shown stays its own.
  power_entity?: string
  commands?: Partial<Record<Key, Command>>
}

// The names each integration gives the keys, as its remote sends them. A
// webOS TV has no remote, so its keys go to its player as buttons. Play,
// which plays or pauses, is there only where the remote has one key for
// both.
const PLATFORMS: Record<string, Partial<Record<Key, string>>> = {
  androidtv_remote: {
    up: 'DPAD_UP',
    down: 'DPAD_DOWN',
    left: 'DPAD_LEFT',
    right: 'DPAD_RIGHT',
    ok: 'DPAD_CENTER',
    back: 'BACK',
    home: 'HOME',
    mute: 'MUTE',
    volume_up: 'VOLUME_UP',
    volume_down: 'VOLUME_DOWN',
    play: 'MEDIA_PLAY_PAUSE',
  },
  androidtv: {
    up: 'UP',
    down: 'DOWN',
    left: 'LEFT',
    right: 'RIGHT',
    ok: 'CENTER',
    back: 'BACK',
    home: 'HOME',
    mute: 'MUTE',
    volume_up: 'VOLUME_UP',
    volume_down: 'VOLUME_DOWN',
  },
  roku: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    ok: 'select',
    back: 'back',
    home: 'home',
    mute: 'volume_mute',
    volume_up: 'volume_up',
    volume_down: 'volume_down',
    play: 'play',
  },
  samsungtv: {
    up: 'KEY_UP',
    down: 'KEY_DOWN',
    left: 'KEY_LEFT',
    right: 'KEY_RIGHT',
    ok: 'KEY_ENTER',
    back: 'KEY_RETURN',
    home: 'KEY_HOME',
    mute: 'KEY_MUTE',
    volume_up: 'KEY_VOLUP',
    volume_down: 'KEY_VOLDOWN',
  },
  philips_js: {
    up: 'CursorUp',
    down: 'CursorDown',
    left: 'CursorLeft',
    right: 'CursorRight',
    ok: 'Confirm',
    back: 'Back',
    home: 'Home',
    mute: 'Mute',
    volume_up: 'VolumeUp',
    volume_down: 'VolumeDown',
  },
  braviatv: {
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    ok: 'Confirm',
    back: 'Return',
    home: 'Home',
    mute: 'Mute',
    volume_up: 'VolumeUp',
    volume_down: 'VolumeDown',
  },
  webostv: {
    up: 'UP',
    down: 'DOWN',
    left: 'LEFT',
    right: 'RIGHT',
    ok: 'ENTER',
    back: 'BACK',
    home: 'HOME',
    mute: 'MUTE',
    volume_up: 'VOLUMEUP',
    volume_down: 'VOLUMEDOWN',
  },
}

const VOLUME: Key[] = ['mute', 'volume_up', 'volume_down']

// How long a key is held before it repeats, and how often it does then.
const REPEAT_AFTER_MS = 400
const REPEAT_EVERY_MS = 120
const OFF = ['off', 'standby', 'unavailable', 'unknown']

type Target = { entity: string; platform: string }

// The entity that takes the keys: the one picked when its integration is
// known, or else another of the same device, like the remote of a TV picked
// by its player.
export function keysOf(hass: HomeAssistant, entityId: string): Target | null {
  const registry = hass.entities ?? {}
  const device = registry[entityId]?.device_id
  const ids = [
    entityId,
    ...(device ? Object.keys(registry).filter(id => id !== entityId && registry[id].device_id === device) : []),
  ]
  for (const id of ids) {
    const platform = registry[id]?.platform
    if (!platform || !PLATFORMS[platform] || !hass.states[id]) continue
    const domain = id.split('.')[0]
    if (platform === 'webostv' ? domain === 'media_player' : domain === 'remote') return { entity: id, platform }
  }
  return null
}

// A player of the same device that can change its volume, for a remote
// whose integration has no volume keys of its own.
function playerOf(hass: HomeAssistant, entityId: string) {
  const registry = hass.entities ?? {}
  const device = registry[entityId]?.device_id
  const ids = [entityId, ...(device ? Object.keys(registry).filter(id => registry[id].device_id === device) : [])]
  return ids.find(id => id.startsWith('media_player.') && supports(hass.states[id], MEDIA.volumeStep | MEDIA.volumeSet))
}

type Props = { env: TileEnv; config: RemoteConfig }

// Whether a card beside it already turns its device on and off.
function besideOf(hass: HomeAssistant, config: RemoteConfig) {
  const registry = hass.entities ?? {}
  const own = config.entity && registry[config.entity]?.device_id
  return !!config.power_beside?.some(id => id === config.entity || (!!own && registry[id]?.device_id === own))
}

// A TV remote: back, home and power in the top right corner, minus, mute and
// plus just left of them, and arrows around OK on a round pad under them.
// Half as wide, back and home stay in the corner, and the pad and then the
// volume stand under them, in the middle. It finds
// the names of the keys from the integration of the entity, or of another
// on its device, so a remote or a TV picked from the list works as it is.
// A key can be given a command of its own, and the volume can go to
// another player, like the TV a box is plugged into. The arrows and the
// volume repeat while held. A swipe across the pad, from wherever it
// starts, moves that way, one step for every stretch the finger goes.
// While it is off only power can be pressed. The volume still goes to its
// player when that says it is off, as a TV that was just woken says so for
// a while before it takes the volume. Power turns it on at once, but turns
// it off only on a second press within a few seconds, so it is never turned
// off by mistake. It has no power key when its config says so, or when a
// toggle or what plays on its device is beside it to turn it on and off.
// A tap on the card around the keys does nothing, and a long press opens
// its dialog.
export default function Remote({ env, config }: Props) {
  const { hass } = env
  const entity = hass.states[config.entity!]
  const { keys, player, muted, reach } = remoteOf(hass, config)
  const off = !entity || OFF.includes(entity.state)
  // The service that turns it on or off, when it has one.
  const domain = config.entity?.split('.')[0]
  const powerOf = (on: boolean) =>
    config.power_entity
      ? () => callService(hass, `homeassistant.turn_${on ? 'on' : 'off'}`, { entity_id: config.power_entity })
      : domain === 'remote' || (domain === 'media_player' && supports(entity, on ? MEDIA.turnOn : MEDIA.turnOff))
        ? () => callService(hass, `${domain}.turn_${on ? 'on' : 'off'}`, { entity_id: config.entity })
        : null
  const turn = config.power === false || besideOf(hass, config) ? null : powerOf(off)
  const power = useArmed(off, turn)

  // While it is off only power can be pressed, since any other key would
  // wake it, and with it the TV.
  const sendOf = (key: Key) => (off ? null : reach(key))

  const known = !!keys || !!config.commands || !!player
  const corner = cornerOf(reach)
  return (
    <Panel
      env={env}
      config={{ ...config, icon: config.icon ?? 'ph:television' }}
      entity={entity}
      state={known ? formatState(hass, entity) : 'Unknown remote, set its commands'}
      className="dio-remote"
      onTap={null}
      controls={
        (corner.length > 0 || turn) && (
          <>
            <CornerKeys corner={corner} disabled={off} />
            {turn && (
              <Control
                icon="ph:power-bold"
                label={off ? 'Turn on' : power.armed ? 'Press again to turn off' : 'Turn off'}
                className={power.className}
                style={power.style}
                onPress={power.press}
              />
            )}
          </>
        )
      }
    >
      <RemoteKeys sendOf={sendOf} muted={muted} />
    </Panel>
  )
}

type Reach = (key: Key) => (() => void) | null

// The keys of a remote for `config.entity` and what each one does, or
// nothing for one there is no way to send.
export function remoteOf(hass: HomeAssistant, config: Pick<RemoteConfig, 'entity' | 'volume_entity' | 'commands'>) {
  const keys = config.entity ? keysOf(hass, config.entity) : null
  const player = config.volume_entity ?? (keys ? undefined : config.entity && playerOf(hass, config.entity))
  const muted = player ? hass.states[player]?.attributes.is_volume_muted === true : false
  const reach = (key: Key): (() => void) | null => {
    const own = config.commands?.[key]
    if (own) {
      if (typeof own !== 'string') return () => callService(hass, own.action, own.data)
      const remote = keys?.entity ?? config.entity
      if (!remote?.startsWith('remote.')) return null
      return () => callService(hass, 'remote.send_command', { entity_id: remote, command: own })
    }
    const toPlayer = VOLUME.includes(key) && (config.volume_entity || !keys) ? player : undefined
    if (toPlayer) {
      if (key === 'mute')
        return () => callService(hass, 'media_player.volume_mute', { entity_id: toPlayer, is_volume_muted: !muted })
      return () => callService(hass, `media_player.${key}`, { entity_id: toPlayer })
    }
    if (!keys) return null
    const command = PLATFORMS[keys.platform][key]
    if (!command) return null
    if (keys.platform === 'webostv')
      return () => callService(hass, 'webostv.button', { entity_id: keys.entity, button: command })
    return () => callService(hass, 'remote.send_command', { entity_id: keys.entity, command })
  }
  return { keys, player, muted, reach }
}

// Back and home, those of them there is a way to send.
export const cornerOf = (reach: Reach) =>
  (['back', 'home'] as const).flatMap(key => {
    const send = reach(key)
    return send ? [[key, send] as const] : []
  })

export function CornerKeys({ corner, disabled }: { corner: ReturnType<typeof cornerOf>; disabled?: boolean }) {
  return corner.map(([key, send]) => (
    <Control
      key={key}
      icon={LOOK[key].icon}
      label={LOOK[key].label}
      disabled={disabled}
      onPress={() => {
        haptic('selection')
        send()
      }}
    />
  ))
}

// The round pad, and minus, mute and plus beside it, with what goes above
// them, if anything, in a column of its own.
export function RemoteKeys({ sendOf, muted, above }: { sendOf: Reach; muted: boolean; above?: ReactNode }) {
  const volume = (
    <div className="dio-controls dio-volume" onPointerDown={e => e.stopPropagation()}>
      <RemoteKey name="volume_down" send={sendOf('volume_down')} repeats className="dio-control" />
      <RemoteKey
        name="mute"
        send={sendOf('mute')}
        icon={muted ? 'ph:speaker-x' : 'ph:speaker-high'}
        className={cn('dio-control', muted && 'dio-remote-muted')}
      />
      <RemoteKey name="volume_up" send={sendOf('volume_up')} repeats className="dio-control" />
    </div>
  )
  return (
    <>
      <Pad sendOf={sendOf} />
      {above ? (
        <div className="dio-remote-side">
          {above}
          {volume}
        </div>
      ) : (
        volume
      )}
    </>
  )
}

const LOOK: Record<Key, { icon: string; label: string }> = {
  up: { icon: 'ph:caret-up', label: 'Up' },
  down: { icon: 'ph:caret-down', label: 'Down' },
  left: { icon: 'ph:caret-left', label: 'Left' },
  right: { icon: 'ph:caret-right', label: 'Right' },
  ok: { icon: '', label: 'OK' },
  back: { icon: 'ph:arrow-u-up-left', label: 'Back' },
  home: { icon: 'ph:house', label: 'Home' },
  mute: { icon: 'ph:speaker-x', label: 'Mute' },
  volume_up: { icon: 'ph:plus', label: 'Volume up' },
  volume_down: { icon: 'ph:minus', label: 'Volume down' },
  play: { icon: 'ph:play-pause', label: 'Play or pause' },
}

type Arrow = 'up' | 'right' | 'down' | 'left'
const ARROWS: Arrow[] = ['up', 'right', 'down', 'left']

// How far a finger goes on the pad before it steers that way.
const SWIPE_PX = 28
// How often the pad sends the way it is steered while the finger stays
// down: after three quarters of a second at first, like stepping through
// a row of videos, and a little sooner each time, up to four a second.
const STEER_FIRST_MS = 750
const STEER_FASTEST_MS = 250
const STEER_SOONER = 0.85

// How long a pulse of light lasts on the pad when a key is sent.
const PULSE_MS = 260

const wayOf = (dx: number, dy: number): Arrow =>
  Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'

// The arrows around OK, and a stick: a finger that goes far enough one way
// steers that way, and the pad sends that arrow at once, then again and
// again while the finger stays down, even still. Moved far enough another
// way without lifting, it steers that way instead. A tap anywhere on it,
// not swiped, is OK, sent when the finger lifts.
// Lights a glow up and down again each time its key is sent, from wherever
// the last pulse left it, so pulses sent quickly run on into each other.
const pulse = (glow: HTMLElement | null | undefined) => {
  if (!glow) return
  const from = getComputedStyle(glow).opacity
  for (const running of glow.getAnimations()) running.cancel()
  glow.animate([{ opacity: from }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], {
    duration: PULSE_MS,
    easing: 'ease-in-out',
  })
}

function Pad({ sendOf }: { sendOf: (key: Key) => (() => void) | null }) {
  const pad = useRef<HTMLDivElement>(null)
  const press = useRef<{
    x: number
    y: number
    moved: boolean
    way: Arrow | null
    timer: number
  } | null>(null)
  const fire = (key: Key) => {
    const send = sendOf(key)
    if (!send) return
    haptic('selection')
    send()
    pulse(pad.current?.querySelector<HTMLElement>(`[data-glow='${key}']`))
  }
  const end = () => {
    const current = press.current
    if (!current) return
    clearTimeout(current.timer)
    clearInterval(current.timer)
    press.current = null
  }
  useEffect(() => end, [])
  return (
    <div
      ref={pad}
      className="dio-pad"
      onPointerDown={e => {
        e.stopPropagation()
        if (e.button !== 0) return
        end()
        // A tap anywhere on the wheel is OK, and a swipe steers it, so the
        // finger never has to find a key.
        e.currentTarget.setPointerCapture(e.pointerId)
        press.current = { x: e.clientX, y: e.clientY, moved: false, way: null, timer: 0 }
      }}
      onPointerMove={e => {
        const current = press.current
        if (!current) return
        const dx = e.clientX - current.x
        const dy = e.clientY - current.y
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return
        // Measured again from here, so the next turn is told from where the
        // finger is now.
        current.x = e.clientX
        current.y = e.clientY
        const way = wayOf(dx, dy)
        if (way === current.way) return
        clearTimeout(current.timer)
        clearInterval(current.timer)
        current.moved = true
        current.way = way
        fire(way)
        const steer = (wait: number) => {
          current.timer = window.setTimeout(() => {
            fire(way)
            steer(Math.max(STEER_FASTEST_MS, wait * STEER_SOONER))
          }, wait)
        }
        steer(STEER_FIRST_MS)
      }}
      onPointerUp={() => {
        const current = press.current
        if (current && !current.moved) fire('ok')
        end()
      }}
      onPointerCancel={end}
    >
      <span className="dio-pad-glow" data-glow="ok" />
      {[...ARROWS, 'ok' as const].map(key => {
        const { label, icon } = LOOK[key]
        return (
          <button
            key={key}
            type="button"
            data-key={key}
            aria-label={label}
            title={label}
            disabled={!sendOf(key)}
            className={cn('dio-remote-key', `dio-pad-${key}`)}
            onKeyDown={insideTile.onKeyDown}
            onContextMenu={e => e.preventDefault()}
            // A press by the keyboard, which has no pointer down before it.
            onClick={e => {
              e.stopPropagation()
              if (e.detail === 0) fire(key)
            }}
          >
            {key !== 'ok' && <span className="dio-pad-glow" data-glow={key} />}
            {icon ? <Icon icon={icon} /> : <span>{label}</span>}
          </button>
        )
      })}
    </div>
  )
}

type KeyProps = { name: Key; send: (() => void) | null; repeats?: boolean; icon?: string; className?: string }

// One key, sent on press rather than on release so it feels as quick as a
// real remote's, and again and again while held when it repeats.
function RemoteKey({ name, send, repeats, icon: own, className }: KeyProps) {
  const timer = useRef(0)
  const stop = () => {
    clearTimeout(timer.current)
    clearInterval(timer.current)
    timer.current = 0
  }
  useEffect(() => stop, [])
  const fire = () => {
    haptic('selection')
    send?.()
  }
  const { label } = LOOK[name]
  const icon = own ?? LOOK[name].icon
  return (
    <button
      {...insideTile}
      type="button"
      aria-label={label}
      title={label}
      disabled={!send}
      className={cn('dio-remote-key', className)}
      onPointerDown={e => {
        e.stopPropagation()
        if (e.button !== 0 || !send) return
        fire()
        if (!repeats) return
        stop()
        timer.current = window.setTimeout(() => {
          timer.current = window.setInterval(fire, REPEAT_EVERY_MS)
        }, REPEAT_AFTER_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={e => e.preventDefault()}
      // A press by the keyboard, which has no pointer down before it.
      onClick={e => {
        e.stopPropagation()
        if (e.detail === 0) fire()
      }}
    >
      {icon ? <Icon icon={icon} /> : <span>{label}</span>}
    </button>
  )
}
