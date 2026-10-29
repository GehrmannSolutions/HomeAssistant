import { useUnechoed } from '#/lib/echo.ts'
import { claim } from '#/lib/longPress.ts'
import { callService, haptic, type TileEnv } from '#/tiles/actions.ts'
import CoverControls from '#/tiles/cards/CoverControls.tsx'
import { STOP } from '#/tiles/features/cover.tsx'
import { numberOf, supports, useHeld } from '#/tiles/features/parts.tsx'
import type { TileConfig } from '#/tiles/host.tsx'
import { Tile } from '#/tiles/Tile.tsx'
import type { EntityState } from '#/types.ts'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

type Props = {
  env: TileEnv
  config: TileConfig
  entity: EntityState
  // How far it is, from 0 to 100, and the steps it stops at, like the
  // speeds of a fan.
  value: number
  step?: number
  accent: string
  glow?: string
  // Whether it is on, open for a cover, when Home Assistant says more than
  // on and off.
  on?: boolean
  // What the line under the name says for a value, a percentage unless
  // it says otherwise.
  format?: (value: number) => string
  onTap: () => void
  onSend: (value: number) => void
  // The side it fills from: the left, or the bottom or the top for one
  // dragged up and down, like a blind or a screen that comes down.
  from?: 'left' | 'bottom' | 'top'
  // Only shows the value, like a battery's charge, with nothing to drag.
  readOnly?: boolean
  // Buttons in the top right corner, like a cover's up, stop and down.
  controls?: ReactNode
  // Something that takes a while to get where it is sent, like a blind,
  // and whether it is on its way now.
  travels?: { moving: boolean }
}

// How far a finger goes along the fill before the press is a drag.
const SLOP_PX = 8
// The strip along the bottom of the screen where a phone's own swipe home
// starts. A touch there is the phone's, even over a tile.
const SYSTEM_EDGE_PX = 24
// The value the handle at the end starts to fade in at, the one the handle
// at the start is gone by, and how strong both are at their end.
const GRIP_FROM = 95
const GRIP_TO = 5
const GRIP_OPACITY = 0.35
// How long the arrow keys wait for another press before they send.
const SEND_MS = 700
// How long a value sent to something that travels waits for it to start
// moving, and is kept once it stops short of it.
const SETTLE_MS = 3000
// How long the band fades out for once it is not needed, and how long it
// waits first, while the fill glides the last of the way to it.
const BAND_FADE_MS = 400
const BAND_LINGER_MS = 1000
// The smallest step that gets a tick at each stop, so a fan's few speeds
// show and a percent at a time does not.
const DOTS_FROM_STEP = 5

// A short tick at each stop past the start and short of the end, along
// the edge of the tile, in the color of the words on the side it is on,
// cut off by its rounded corners like the rest of it.
function StepTicks({ step }: { step: number }) {
  if (step < DOTS_FROM_STEP) return null
  const stops: number[] = []
  for (let at = step; at < 100 - step / 100; at += step) stops.push(at)
  return (
    <span className="dio-fill-ticks">
      {stops.map(at => (
        <span key={at} className="dio-fill-tick" style={{ '--_at': `${at}%` } as CSSProperties} />
      ))}
    </span>
  )
}

// A tile that is a value from 0 to 100 across its whole width, like a
// light's brightness, a fan's speed or how far a blind is open. The tile fills from the left as far
// as the value and looks like one that is on up to there, and like one
// that is off past it. A drag sideways anywhere on it moves that edge from
// where it was, following the finger smoothly, and when it lifts the value
// goes to the nearest step; down to nothing turns it off. A tap still turns
// it on or off. Near the end, where the edge is about to go, a short bar
// fades in just inside it to show there is something to drag. One that
// fills from the bottom or the top does the same up and down.
//
// One that travels, like a blind, always fills as far as it really is. A
// drag lays a paler band from there to the finger, which stays where it was
// let go while the fill moves to meet it, and fades once the fill gets
// there or stops short.
export function FillTile({
  env,
  config,
  entity,
  value: raw,
  step = 1,
  accent,
  glow,
  on = entity.state === 'on',
  format = v => (v === 0 ? 'Off' : `${v}%`),
  onTap,
  onSend,
  from = 'left',
  readOnly = false,
  controls,
  travels,
}: Props) {
  const [value, hold] = useHeld(raw)
  const [drag, setDrag] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const start = useRef<{ id: number; x: number; y: number; from: number; dragging: boolean } | null>(null)
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Where something that travels was sent, until it gets there or stops.
  const [sent, setSent] = useState<number | null>(null)
  const moving = travels?.moving ?? false
  const reported = useUnechoed(raw, travels ? sent : null, moving, 1)
  const arrived = sent !== null && Math.abs(reported - sent) < 1
  const pending = travels && sent !== null && !arrived ? sent : null
  useEffect(() => {
    if (sent === null || (moving && !arrived)) return
    const timer = setTimeout(() => setSent(null), arrived ? 0 : SETTLE_MS)
    return () => clearTimeout(timer)
  }, [sent, moving, arrived])
  // The band, kept where it was while it fades out.
  const aim = travels ? (drag ?? pending) : null
  const [band, setBand] = useState<number | null>(null)
  const [fading, setFading] = useState(false)
  if (aim !== null && aim !== band) setBand(aim)
  if (aim !== null && fading) setFading(false)
  useEffect(() => {
    if (aim !== null || band === null) return
    const fade = setTimeout(() => setFading(true), BAND_LINGER_MS)
    const gone = setTimeout(() => {
      setBand(null)
      setFading(false)
    }, BAND_LINGER_MS + BAND_FADE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [aim, band])

  const shown = travels ? reported : (drag ?? value)
  // A drag starts from where the fill is, or from the band when there is one.
  const grabbed = travels ? (pending ?? reported) : shown

  // The nearest step, and the end itself for a step of a third that lands
  // a hair short of it.
  const snap = (v: number) => {
    const stepped = Math.round(v / step) * step
    if (100 - stepped < step / 100) return 100
    return Math.min(100, Math.max(0, Math.round(stepped * 100) / 100))
  }
  const send = (next: number) => {
    if (travels) setSent(next)
    else hold(next)
    onSend(next)
  }
  // The window listeners outlive a render, so they reach the latest ones
  // through here.
  const latest = useRef({ send, drag, snap, from })
  useEffect(() => {
    latest.current = { send, drag, snap, from }
  })

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = start.current
      if (!s || s.id !== e.pointerId || !box.current) return
      const { from } = latest.current
      const vertical = from !== 'left'
      const along = from === 'left' ? e.clientX - s.x : from === 'top' ? e.clientY - s.y : s.y - e.clientY
      const across = vertical ? e.clientX - s.x : e.clientY - s.y
      if (!s.dragging) {
        if (Math.abs(along) < SLOP_PX || Math.abs(along) < Math.abs(across)) return
        s.dragging = true
        claim()
      }
      const rect = box.current.getBoundingClientRect()
      const size = vertical ? rect.height : rect.width
      setDrag(Math.min(100, Math.max(0, s.from + (along / size) * 100)))
    }
    const up = (e: PointerEvent) => {
      mirror(null, 'data-active')
      const s = start.current
      if (!s || s.id !== e.pointerId) return
      start.current = null
      if (!s.dragging) return
      const { send, drag, snap } = latest.current
      setDrag(null)
      // The phone or the browser took the touch over, like a swipe home
      // that crossed the tile, so it sends nothing.
      if (drag === null || e.type === 'pointercancel') return
      haptic('selection')
      send(snap(drag))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      clearTimeout(keyTimer.current)
    }
  }, [])

  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0 || readOnly) return
    if (e.pointerType === 'touch' && e.clientY > window.innerHeight - SYSTEM_EDGE_PX) return
    // A press on a button is the button's, not the start of a drag.
    if (e.target instanceof Element && e.target.closest('button')) {
      mirror(button(e.target), 'data-active')
      return
    }
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: grabbed, dragging: false }
  }

  // The lit copy and the band lie over the tile and draw its buttons again,
  // so a button under them would never show it is pointed at or pressed.
  // The same button in each copy takes it on too.
  const button = (target: EventTarget | null) =>
    target instanceof Element ? target.closest('.dio-fill > .dio-tile .dio-control') : null
  function mirror(pressed: Element | null, attr: string) {
    const root = box.current
    if (!root) return
    for (const copy of root.querySelectorAll(`.dio-control[${attr}]`)) copy.removeAttribute(attr)
    const tile = root.querySelector(':scope > .dio-tile')
    if (!pressed || !tile) return
    const at = [...tile.querySelectorAll('.dio-control')].indexOf(pressed)
    for (const layer of root.querySelectorAll('.dio-fill-lit, .dio-fill-band'))
      layer.querySelectorAll('.dio-control')[at]?.setAttribute(attr, '')
  }

  // The arrows toward and away from where it fills from move a tenth, or a
  // step when steps are bigger.
  const keys = (e: KeyboardEvent) => {
    const [more, less] = {
      left: ['ArrowRight', 'ArrowLeft'],
      top: ['ArrowDown', 'ArrowUp'],
      bottom: ['ArrowUp', 'ArrowDown'],
    }[from]
    const by = e.key === more ? 1 : e.key === less ? -1 : 0
    if (!by || readOnly) return
    e.preventDefault()
    const next = snap((drag ?? grabbed) + by * Math.max(step, 10))
    setDrag(next)
    clearTimeout(keyTimer.current)
    keyTimer.current = setTimeout(() => {
      setDrag(null)
      send(next)
    }, SEND_MS)
  }

  const state = format(Math.round(drag ?? shown))
  // Clips that keep a layer from the side it fills from up to a value, or
  // from that value on to the far side.
  const upTo = (v: number) =>
    ({
      left: `inset(0 ${100 - v}% 0 0)`,
      top: `inset(0 0 ${100 - v}% 0)`,
      bottom: `inset(${100 - v}% 0 0 0)`,
    })[from]
  const past = (v: number) =>
    ({
      left: `inset(0 0 0 ${v}%)`,
      top: `inset(${v}% 0 0 0)`,
      bottom: `inset(0 0 ${v}% 0)`,
    })[from]
  // The band is drawn twice, and only ever clipped by where it ends. Ahead
  // of the fill it lies under the fill, which covers it up to where the fill
  // really is. Behind the fill it lies inside the fill, which cuts it off
  // there. So the band always meets the fill as it glides. Each copy draws
  // its words again over itself, in the color they have there, so the band
  // never dims them.
  const bandLayer = (ahead: boolean) =>
    band !== null && (
      <div
        className="dio-fill-band"
        data-on={!fading || undefined}
        data-back={!ahead || undefined}
        inert
        style={{ clipPath: ahead ? upTo(band) : past(band) }}
      >
        <div className="dio-fill-band-tint">
          <Tile
            env={env}
            config={config}
            entity={entity}
            active={ahead || on}
            looksOff={!ahead}
            accent={accent}
            glow={ahead ? glow : undefined}
            state={state}
            controls={controls}
          />
        </div>
        <div className="dio-fill-band-ink">
          <Tile
            env={env}
            config={config}
            entity={entity}
            active={!ahead || on}
            looksOff={ahead}
            accent={accent}
            state={state}
            controls={controls}
          />
        </div>
      </div>
    )
  return (
    <div
      ref={box}
      className="dio-fill"
      data-dragging={drag !== null || undefined}
      data-vertical={from !== 'left' || undefined}
      data-from={from}
      data-readonly={readOnly || undefined}
      data-travels={travels ? true : undefined}
      onPointerDownCapture={down}
      onPointerOver={e => mirror(button(e.target), 'data-hover')}
      onPointerLeave={() => mirror(null, 'data-hover')}
      onKeyDown={keys}
    >
      <Tile
        env={env}
        config={config}
        entity={entity}
        active={on}
        looksOff
        role={readOnly ? 'button' : 'switch'}
        accent={accent}
        state={state}
        onTap={onTap}
        controls={controls}
      />
      {!readOnly && <StepTicks step={step} />}
      {!readOnly && (
        <span
          className="dio-fill-grip"
          data-start
          style={{ opacity: GRIP_OPACITY * Math.max(0, (GRIP_TO - shown) / GRIP_TO) }}
        />
      )}
      {bandLayer(true)}
      <div className="dio-fill-lit" inert style={{ clipPath: upTo(shown) }}>
        <Tile
          env={env}
          config={config}
          entity={entity}
          active
          accent={accent}
          glow={glow}
          state={state}
          controls={controls}
        />
        {!readOnly && <StepTicks step={step} />}
        {!readOnly && (
          <span
            className="dio-fill-grip"
            style={
              {
                '--_edge': `${shown}%`,
                opacity: GRIP_OPACITY * Math.max(0, (shown - GRIP_FROM) / (100 - GRIP_FROM)),
              } as CSSProperties
            }
          />
        )}
        {bandLayer(false)}
      </div>
    </div>
  )
}

const SIDEWAYS = ['curtain', 'gate', 'door']

// A cover's or a valve's tile that is how far it is open, or with `tilt`
// how far its slats are tilted. A tap opens or closes it. A cover that
// goes up and down, like a blind, a shutter or a garage door, fills from
// the bottom as it rises, or from the top for a screen that comes down to
// open; one that slides aside, like a curtain or a gate, from the left.
// With `buttons` a cover also has its up, stop and down buttons in the
// top right corner, as on its own tile.
export function PositionTile({
  env,
  config,
  entity,
  tilt = false,
  buttons = false,
}: {
  env: TileEnv
  config: TileConfig
  entity: EntityState
  tilt?: boolean
  buttons?: boolean
}) {
  const valve = entity.entity_id.startsWith('valve.')
  const domain = valve ? 'valve' : 'cover'
  const open = entity.state === 'open' || entity.state === 'opening'
  const value = tilt
    ? (numberOf(entity, 'current_tilt_position') ?? 0)
    : (numberOf(entity, 'current_position') ?? (open ? 100 : 0))
  const target = { entity_id: entity.entity_id }
  const sideways = valve || tilt || SIDEWAYS.includes(String(entity.attributes.device_class))
  const invert = (config as { invert?: boolean }).invert === true
  const run = (service: string) => () => callService(env.hass, `cover.${service}`, target)
  return (
    <FillTile
      from={sideways ? 'left' : invert ? 'top' : 'bottom'}
      env={env}
      config={config}
      entity={entity}
      value={value}
      on={tilt ? value > 0 : open}
      accent="var(--_accent-cover)"
      format={v => (tilt ? `Tilt ${v}%` : v === 0 ? 'Closed' : v === 100 ? 'Open' : `${v}%`)}
      travels={{ moving: entity.state === 'opening' || entity.state === 'closing' }}
      onTap={() => callService(env.hass, `${domain}.toggle`, target)}
      onSend={v =>
        tilt
          ? callService(env.hass, 'cover.set_cover_tilt_position', { ...target, tilt_position: v })
          : callService(env.hass, `${domain}.set_${domain}_position`, { ...target, position: v })
      }
      controls={
        buttons && !valve ? (
          <CoverControls
            invert={invert}
            stops={supports(entity, STOP)}
            onOpen={run('open_cover')}
            onStop={run('stop_cover')}
            onClose={run('close_cover')}
          />
        ) : undefined
      }
    />
  )
}
