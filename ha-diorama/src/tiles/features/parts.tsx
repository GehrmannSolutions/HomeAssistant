import { cn } from '#/lib/utils.ts'
import { haptic, type TileEnv } from '#/tiles/actions.ts'
import { insideTile, popsOver } from '#/tiles/gestures.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Icon } from '#/tiles/Icon.tsx'
import { menuKeys, openMenu } from '#/tiles/menu.ts'
import type { EntityState, HomeAssistant } from '#/types.ts'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

// The pieces the features of a tile are made of: a slider, a menu, a
// switch, a stepper and a plain button. Every one of them keeps its presses
// to itself, so the tile under it never takes them as a tap.

// How long a value that was sent shows if Home Assistant never says it
// took it.
const HOLD_MS = 5000
// How long the minus and plus wait for another press before they send.
const SEND_MS = 700

// A value sent to Home Assistant, shown until it reports it back, so the
// old one never flashes in between.
export function useHeld<T>(reported: T) {
  const [held, setHeld] = useState<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // Let go of as soon as it is reported back.
  if (held && Object.is(held.value, reported)) setHeld(null)
  const hold = (value: T) => {
    setHeld({ value })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHeld(null), HOLD_MS)
  }
  return [held ? held.value : reported, hold] as const
}

// An option or a mode as Home Assistant words it, or the raw value made
// readable when it has no words for it.
export function optionWord(hass: HomeAssistant, entity: EntityState, value: string, attribute?: string) {
  const worded = attribute
    ? hass.formatEntityAttributeValue?.(entity, attribute, value)
    : hass.formatEntityState?.(entity, value)
  if (worded && worded !== value) return worded
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// The choices an entity lists in one of its attributes.
export function listOf(entity: EntityState | undefined, attribute: string) {
  const list = entity?.attributes[attribute]
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
}

export const numberOf = (entity: EntityState | undefined, attribute: string) => {
  const value = entity?.attributes[attribute]
  return typeof value === 'number' ? value : null
}

// How many of a group's members are on, like the lights of a light group,
// or null for an entity that is not a group.
export function membersOn(hass: HomeAssistant, entity: EntityState | undefined) {
  const members = listOf(entity, 'entity_id')
  if (members.length === 0) return null
  return members.filter(id => hass.states[id]?.state === 'on').length
}

export const supports = (entity: EntityState | undefined, bit: number) =>
  (Number(entity?.attributes.supported_features ?? 0) & bit) !== 0

type SliderProps = {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  // What the value reads as, inside the bar.
  format: (value: number) => string
  onChange: (value: number) => void
  icon?: string
  // A track that is a scale of its own, like the hues of a color, draws
  // a knob where the value is instead of filling up to it.
  track?: string
  // The color the bar fills with.
  fill?: string
  // The color its words take where they lie over the fill, for a fill
  // too close to the words' own color to read them on.
  ink?: string
}

// A thick bar that fills from the left as far as its value, and follows a
// finger dragged anywhere along it. The value is sent when the finger
// lifts, or a moment after the last arrow key.
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  format,
  onChange,
  icon,
  track,
  fill,
  ink,
}: SliderProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [held, hold] = useHeld(value)
  const bar = useRef<HTMLDivElement>(null)
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(keyTimer.current), [])
  const shown = dragging ?? held
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min))
  const at = (e: PointerEvent) => {
    const box = bar.current!.getBoundingClientRect()
    return clamp(min + ((e.clientX - box.left) / box.width) * (max - min))
  }
  const share = max > min ? (Math.min(max, Math.max(min, shown)) - min) / (max - min) : 0

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const big = Math.max(step, (max - min) / 10)
    const moves: Record<string, number> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: big,
      PageDown: -big,
    }
    let next: number
    if (e.key in moves) next = clamp(shown + moves[e.key])
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else return
    e.preventDefault()
    setDragging(next)
    clearTimeout(keyTimer.current)
    keyTimer.current = setTimeout(() => {
      setDragging(null)
      hold(next)
      onChange(next)
    }, SEND_MS)
  }

  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={format(shown)}
      className={cn('dio-slider', track && 'dio-slider-scale', dragging !== null && 'dio-slider-dragging')}
      style={
        {
          '--_share': share,
          ...(track && { '--_track': track }),
          ...(fill && { '--_fill': fill }),
        } as CSSProperties
      }
      onPointerDown={e => {
        e.stopPropagation()
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(at(e))
      }}
      onPointerMove={e => {
        if (dragging === null) return
        const next = at(e)
        if (next !== dragging) setDragging(next)
      }}
      onPointerUp={e => {
        if (dragging === null) return
        const next = at(e)
        setDragging(null)
        hold(next)
        haptic('selection')
        onChange(next)
      }}
      onPointerCancel={() => setDragging(null)}
      onClick={e => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {!track && <div className="dio-slider-fill" />}
      {track && <div className="dio-slider-knob" />}
      <div className="dio-slider-label">
        {icon && <Icon icon={icon} on />}
        <span>{format(shown)}</span>
      </div>
      {ink && (
        <div className="dio-slider-label dio-slider-ink" style={{ color: ink }} aria-hidden>
          {icon && <Icon icon={icon} on />}
          <span>{format(shown)}</span>
        </div>
      )}
    </div>
  )
}

type SlimProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  // The scale the bar is drawn in, like the hues of a color.
  track: string
  format: (value: number) => string
  // Every value the finger passes over, so the tile can show it. The one
  // it lifts at comes with `sent`, and null when the drag is called off.
  onMove?: (value: number | null, sent?: boolean) => void
  onChange: (value: number) => void
  // The light is in another mode than the one the bar sets, so its handle
  // is faint.
  idle?: boolean
}

// A slim bar of a scale with round ends and a handle where the value is,
// for the top of a tile beside its icon. A press on it jumps there and a
// drag follows the finger. The value is sent when the finger lifts, or a
// moment after the last arrow key.
export function SlimSlider({ label, value, min, max, step = 1, track, format, onMove, onChange, idle }: SlimProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [held, hold] = useHeld(value)
  const bar = useRef<HTMLDivElement>(null)
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(keyTimer.current), [])
  const shown = dragging ?? held
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min))
  const at = (e: PointerEvent) => {
    const box = bar.current!.getBoundingClientRect()
    return clamp(min + ((e.clientX - box.left) / box.width) * (max - min))
  }
  const move = (next: number | null) => {
    setDragging(next)
    onMove?.(next)
  }
  const send = (next: number) => {
    setDragging(null)
    onMove?.(next, true)
    hold(next)
    onChange(next)
  }
  const share = max > min ? (Math.min(max, Math.max(min, shown)) - min) / (max - min) : 0
  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={format(shown)}
      className={cn('dio-slim', dragging !== null && 'dio-slim-dragging', idle && dragging === null && 'dio-slim-idle')}
      style={{ '--_track': track, '--_share': share } as CSSProperties}
      onPointerDown={e => {
        e.stopPropagation()
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        move(at(e))
      }}
      onPointerMove={e => {
        if (dragging === null) return
        const next = at(e)
        if (next !== dragging) move(next)
      }}
      onPointerUp={e => {
        if (dragging === null) return
        haptic('selection')
        send(at(e))
      }}
      onPointerCancel={() => move(null)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation()
        const big = Math.max(step, (max - min) / 20)
        const moves: Record<string, number> = { ArrowRight: big, ArrowUp: big, ArrowLeft: -big, ArrowDown: -big }
        let next: number
        if (e.key in moves) next = clamp(shown + moves[e.key])
        else if (e.key === 'Home') next = min
        else if (e.key === 'End') next = max
        else return
        e.preventDefault()
        move(next)
        clearTimeout(keyTimer.current)
        keyTimer.current = setTimeout(() => send(next), SEND_MS)
      }}
    >
      <span className="dio-slim-handle" />
    </div>
  )
}

// A round button or a pill with words, pressed apart from the tile.
export function press(onPress: () => void) {
  return {
    ...insideTile,
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      onPress()
    },
  }
}

type MenuProps = {
  icon?: string
  // What the menu picks, said before the choice, like Preset.
  label: string
  options: string[]
  current: string | null
  word: (option: string) => string
  onPick: (option: string) => void
}

// A pill that names what it picks and the choice it holds, and opens a
// menu of every choice beside the tile.
export function MenuPill({ icon, label, options, current, word, onPick }: MenuProps) {
  const anchor = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="menu"
        data-empty={current === null || undefined}
        className="dio-pill dio-pill-menu"
        {...insideTile}
        onClick={e => {
          e.stopPropagation()
          openMenu(menu.current, anchor.current?.getBoundingClientRect())
        }}
      >
        {icon && <Icon icon={icon} on />}
        <span className="dio-pill-label">{label}</span>
        <span className="dio-pill-value">{current !== null ? word(current) : ''}</span>
        <Icon icon="ph:caret-down" className="dio-pill-caret" on />
      </button>
      <div
        {...popsOver}
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={label}
        className="dio-menu"
        onKeyDown={menuKeys}
      >
        <div className="dio-menu-list">
          {options.map(option => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === current}
              className="dio-option"
              onClick={() => {
                menu.current?.hidePopover()
                if (option !== current) onPick(option)
              }}
            >
              <span className="min-w-0 flex-1 truncate">{word(option)}</span>
              {option === current && <Icon icon="ph:check" className="dio-check" />}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

type TogglePillProps = { icon: string; label: string; on: boolean; onToggle: () => void }

// A pill with words that stays pressed while what it says is on, like a
// fan that oscillates, filled in the color of the words.
export function TogglePill({ icon, label, on, onToggle }: TogglePillProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      className="dio-pill dio-pill-toggle"
      {...press(() => {
        haptic('selection')
        onToggle()
      })}
    >
      <Icon icon={icon} on />
      <span className="dio-pill-label">{label}</span>
    </button>
  )
}

// How long a pressed button stays lit, and then how long it takes to fade.
export const FLASH_MS = 500
export const FADE_MS = 1000

export type Flash = 'lit' | 'fading' | null

// A press that lights something up at once, holds it for a moment and
// then lets it fade slowly back, like a button that was pressed.
export function useFlash() {
  const [flash, setFlash] = useState<{ phase: Flash; n: number }>({ phase: null, n: 0 })
  useEffect(() => {
    if (!flash.phase) return
    const id = setTimeout(
      () => setFlash(f => ({ ...f, phase: f.phase === 'lit' ? 'fading' : null })),
      flash.phase === 'lit' ? FLASH_MS : FADE_MS,
    )
    return () => clearTimeout(id)
  }, [flash])
  return [flash.phase, () => setFlash(f => ({ phase: 'lit', n: f.n + 1 }))] as const
}

type PillProps = {
  icon?: string
  label: ReactNode
  onPress: () => void
  disabled?: boolean
  // One of a set where only one is chosen, like the position of a lock.
  checked?: boolean
  // Spoken instead of the label, for a pill that is only a number.
  ariaLabel?: string
  // Lit for a moment after a press, then fading back.
  flash?: Flash
}

// A pill with words, for an action the words say better than an icon.
export function Pill({ icon, label, onPress, disabled, checked, ariaLabel, flash }: PillProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      role={checked === undefined ? undefined : 'radio'}
      aria-checked={checked}
      data-flash={flash ?? undefined}
      className="dio-pill dio-pill-action"
      {...press(onPress)}
    >
      {icon && <Icon icon={icon} on />}
      <span className="dio-pill-label">{label}</span>
    </button>
  )
}

type StepperProps = {
  label: string
  value: number | null
  step: number
  min?: number
  max?: number
  format: (value: number) => string
  onSend: (value: number) => void
}

// Minus and plus around a value. A few quick presses make one change,
// sent a moment after the last of them.
export function Stepper({ label, value, step, min = -Infinity, max = Infinity, format, onSend }: StepperProps) {
  const [pending, setPending] = useState<number | null>(null)
  const [shown, hold] = useHeld(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const now = pending ?? shown
  const nudge = (by: number) => {
    if (now === null) return
    const next = Math.min(max, Math.max(min, Math.round((now + by * step) / step) * step))
    setPending(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPending(null)
      hold(next)
      onSend(next)
    }, SEND_MS)
  }
  return (
    <div className="dio-group dio-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="dio-control"
        aria-label={`Lower ${label.toLowerCase()}`}
        {...insideTile}
        onClick={e => {
          e.stopPropagation()
          nudge(-1)
        }}
      >
        <Icon icon="ph:minus-bold" on />
      </button>
      <span className="dio-stepper-value" aria-live="polite">
        {now === null ? '' : format(now)}
      </span>
      <button
        type="button"
        className="dio-control"
        aria-label={`Raise ${label.toLowerCase()}`}
        {...insideTile}
        onClick={e => {
          e.stopPropagation()
          nudge(1)
        }}
      >
        <Icon icon="ph:plus-bold" on />
      </button>
    </div>
  )
}

// What a feature beside the icon shows on the tile while a finger moves
// it: what the state line says, and the color the tile takes.
// What a tile shows while a feature beside its icon is moved. Once it is
// `sent`, it stays until Home Assistant says the entity changed.
export type Preview = { state: string; color?: string; sent?: boolean }

// What every feature is handed: the tile's entity, its config and Home
// Assistant, and for one beside the icon, a way to show where it is going.
export type FeatureProps = {
  env: TileEnv
  config: TileConfig
  entity: EntityState
  onPreview?: (preview: Preview | null) => void
}

export const domainOf = (entity: EntityState) => entity.entity_id.split('.')[0]

// A number as the user's language writes it.
export const formatNumber = (hass: HomeAssistant, value: number, digits = 1) =>
  new Intl.NumberFormat(hass.locale?.language, { maximumFractionDigits: digits }).format(value)

// A temperature with a degree sign and no unit, like 21.5°.
export const formatDegrees = (hass: HomeAssistant, value: number) => `${formatNumber(hass, value)}°`

// A temperature shown large, the whole degrees big and the degree sign
// over the tenths small beside them. The tenths keep their room when there
// are none, so the number stays still as it goes from 21° to 21.5°.
export function BigDegrees({ hass, value }: { hass: HomeAssistant; value: number }) {
  const format = new Intl.NumberFormat(hass.locale?.language, { maximumFractionDigits: 1 })
  const parts = format.formatToParts(value)
  const fraction = parts.find(part => part.type === 'fraction')?.value
  const point = format.formatToParts(0.5).find(part => part.type === 'decimal')?.value ?? '.'
  const whole = parts
    .filter(part => part.type !== 'decimal' && part.type !== 'fraction')
    .map(part => part.value)
    .join('')
  return (
    <span className="dio-degrees">
      <span className="dio-degrees-whole">{whole}</span>
      <span className="dio-degrees-side">
        <span>°</span>
        <span data-empty={!fraction || undefined}>
          {point}
          {fraction ?? '0'}
        </span>
      </span>
    </span>
  )
}

// Round buttons side by side in one frosted pill, like the modes of a
// thermostat or the buttons of a player.
export function Group({ label, radio, children }: { label: string; radio?: boolean; children: ReactNode }) {
  return (
    <div className="dio-group" role={radio ? 'radiogroup' : 'group'} aria-label={label}>
      {children}
    </div>
  )
}
