import { cn } from '#/lib/utils.ts'
import { entityName, moreInfo, runAction, type TileEnv } from '#/tiles/actions.ts'
import { addsRow, besideIcon, Feature, featureState, isWide } from '#/tiles/features/index.tsx'
import type { Preview } from '#/tiles/features/parts.tsx'
import { useTileGestures } from '#/tiles/gestures.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Icon } from '#/tiles/Icon.tsx'
import { defaultIcon } from '#/tiles/icons.ts'
import type { EntityState } from '#/types.ts'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

type Props = {
  env: TileEnv
  config: TileConfig
  entity: EntityState | undefined
  active?: boolean
  // Looks like a tile that is off while it still says it is on, for a
  // tile drawn on in part over it, like a light's brightness.
  looksOff?: boolean
  // Going back to off slowly, like a button a moment after it was pressed.
  fading?: boolean
  // The color the icon takes while the tile is active.
  accent?: string
  // A color that washes over an active tile from its top left corner, like
  // the color a light shines in.
  glow?: string
  // Whether the glow comes from the top left corner, down from the top, or
  // in from the left.
  glowFrom?: 'corner' | 'top' | 'left'
  // A color that washes in from the left over a tile that is off, and
  // takes its icon, like the red of a locked lock. It stays glass.
  tint?: string
  // A picture in place of the icon, like the cover of what is playing.
  picture?: string
  // An app's logo in place of the icon, as it reads on a light card and on
  // a dark one, or in a single color made to read on either.
  logo?: { light: string; dark: string; mono?: boolean }
  state: ReactNode
  // What a tap does when the config sets no tap_action.
  onTap?: () => void
  // A switch says whether it is on to a screen reader. A button says it
  // only when it stays pressed, like a cover that is open.
  role?: 'button' | 'switch'
  toggles?: boolean
  // Buttons shown in the top right corner. On a small tile the icon makes
  // way for them when they do not fit beside it, and they shrink when they
  // do not fit at all.
  controls?: ReactNode
  // Buttons across from the name along the bottom of a wide tile, so the
  // name and the state stay in the bottom left corner. A feature beside
  // the icon takes their place.
  aside?: ReactNode
  // Whether an unknown state counts as unavailable. A button that was
  // never pressed has no time to show and says unknown, yet still works.
  unknownIsUnavailable?: boolean
}

// How long a sent preview waits for Home Assistant before it gives up.
const PREVIEW_MS = 5000

// How the buttons in a small tile's top right corner fit, checked whenever
// the tile or the buttons change size: beside the icon, in place of it when
// there is room for them only across the whole top, or there and smaller
// when even that is too narrow, like on a tablet's narrow panel. The
// buttons matter more than the icon, so it is the icon that makes way, and
// they never go.
type Fit = { kind: 'all' | 'bare' | 'crowded'; size: number }
// The room between the icon and the buttons, its gap and their margin.
const ICON_GAP_PX = 16
const ALL: Fit = { kind: 'all', size: 0 }

function useFits(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Fit>(ALL)
  useLayoutEffect(() => {
    const box = ref.current
    const top = box?.parentElement
    const icon = top?.firstElementChild
    const settle = (next: Fit) =>
      setFit(fit => (fit.kind === next.kind && fit.size === next.size ? fit : next))
    const check = () => {
      if (!enabled || !box || !top || !(icon instanceof HTMLElement)) return settle(ALL)
      // The width the buttons need at their own size, whatever they are
      // shrunk to now, and which hiding the icon does not change, so the
      // choice does not flip back and forth.
      const shrunk = box.hasAttribute('data-crowded')
      if (shrunk) box.removeAttribute('data-crowded')
      const need = box.scrollWidth
      const buttons = [...box.children].filter(child => child.classList.contains('dio-control'))
      const each = buttons[0] instanceof HTMLElement ? buttons[0].offsetWidth : 0
      if (shrunk) box.setAttribute('data-crowded', '')
      const room = top.clientWidth
      if (need + icon.offsetWidth + ICON_GAP_PX <= room) return settle(ALL)
      if (need <= room || !each) return settle({ kind: 'bare', size: 0 })
      // Only the buttons shrink, the gaps between them and the padding
      // around them stay as they are.
      const rest = need - each * buttons.length
      settle({ kind: 'crowded', size: Math.max(0, Math.floor((room - rest - 1) / buttons.length)) })
    }
    check()
    if (!enabled || !box || !top) return
    const observer = new ResizeObserver(check)
    observer.observe(top)
    observer.observe(box)
    for (const button of box.children) observer.observe(button)
    return () => observer.disconnect()
  })
  return [ref, fit] as const
}

// Whether the icon of a small tile makes way for a row of buttons beside
// it, like a cover's open and close, when they would otherwise be squeezed
// narrower than they are. Worked out from what the buttons are, since they
// shrink to the room they get and measuring them would only say that.
function useMakesWay(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [bare, setBare] = useState(false)
  useLayoutEffect(() => {
    const box = ref.current
    const top = box?.parentElement
    const icon = top?.firstElementChild
    const check = () => {
      if (!enabled || !box || !top || !(icon instanceof HTMLElement)) return setBare(false)
      const feature = box.firstElementChild
      const groups = feature ? [...feature.children].filter(child => child.classList.contains('dio-group')) : []
      const buttons = groups.every(group => [...group.children].every(child => child.classList.contains('dio-control')))
      if (!feature || !groups.length || !buttons) return setBare(false)
      const px = (value: string) => parseFloat(value) || 0
      let need = px(getComputedStyle(feature).columnGap) * (feature.children.length - 1)
      for (const group of groups) {
        const style = getComputedStyle(group)
        const each = [...group.children].map(button => px(getComputedStyle(button).maxWidth))
        need += each.reduce((sum, width) => sum + width, 0)
        need += px(style.columnGap) * (each.length - 1) + px(style.paddingLeft) + px(style.paddingRight)
      }
      setBare(need + icon.offsetWidth + ICON_GAP_PX > top.clientWidth)
    }
    check()
    if (!enabled || !box || !top) return
    const observer = new ResizeObserver(check)
    observer.observe(top)
    return () => observer.disconnect()
  })
  return [ref, bare] as const
}

// The icon set for the entity in Home Assistant, in its settings or its
// YAML, picked as `ph:` to match the other tiles or as any other icon.
const entityIcon = (entity: EntityState | undefined) =>
  typeof entity?.attributes.icon === 'string' && entity.attributes.icon ? entity.attributes.icon : undefined

// The shell every entity tile shares: the icon on top, the name and a
// dimmer state line under it, and on a wide tile a row of buttons across
// from the icon and, for some, another along the bottom. Active tiles are opaque and light, the rest are frosted glass.
export function Tile({
  env,
  config,
  entity,
  active = false,
  looksOff = false,
  fading = false,
  accent,
  glow,
  glowFrom = 'corner',
  tint,
  picture,
  logo,
  state,
  onTap,
  role = 'button',
  toggles = false,
  controls,
  aside,
  unknownIsUnavailable = true,
}: Props) {
  const unavailable = !entity || entity.state === 'unavailable' || (unknownIsUnavailable && entity.state === 'unknown')
  const { pressed, handlers } = useTileGestures({
    haptics: config.haptic !== false,
    onTap:
      unavailable || (!onTap && !config.tap_action)
        ? undefined
        : () => runAction(env, config.tap_action, () => onTap?.()),
    onHold: () => runAction(env, config.hold_action, () => moreInfo(env.host, config.entity)),
  })
  // Where a feature beside the icon is being moved to, shown on the tile
  // until Home Assistant says the entity changed, so it does not flash back
  // to what it was in between.
  const [preview, setPreview] = useState<Preview | null>(null)
  const [seen, setSeen] = useState(entity)
  if (seen !== entity) {
    setSeen(entity)
    if (preview?.sent) setPreview(null)
  }
  useEffect(() => {
    if (!preview?.sent) return
    const timer = setTimeout(() => setPreview(null), PREVIEW_MS)
    return () => clearTimeout(timer)
  }, [preview])
  const beside = besideIcon(config.feature) && !unavailable
  const wide = isWide(config, entity)
  const [corner, fit] = useFits(!beside && !!controls && !unavailable)
  const [besideBox, makesWay] = useMakesWay(beside)
  const said = (active && !unavailable && featureState(config.feature, entity!)) || state
  const shown = unavailable ? 'Unavailable' : preview ? preview.state : (config.state_text ?? said)
  const name = entityName(config, entity)
  const on = active && !unavailable
  const text = (
    <div className="dio-text">
      <div className="dio-name">{name}</div>
      <div className="dio-state">{shown}</div>
    </div>
  )
  return (
    <div
      {...handlers}
      role={role}
      tabIndex={0}
      aria-label={name}
      aria-pressed={role === 'button' && toggles ? on : undefined}
      aria-checked={role === 'switch' ? on : undefined}
      aria-disabled={unavailable || undefined}
      data-active={(on && !looksOff) || undefined}
      data-pressed={(pressed && !unavailable) || undefined}
      data-fading={fading || undefined}
      data-unavailable={unavailable || undefined}
      data-wide={wide || undefined}
      data-glow={glowFrom}
      className="dio-tile"
      style={
        {
          '--_tile-accent': preview?.color
            ? `color-mix(in oklab, ${preview.color}, black 15%)`
            : (config.color ?? accent),
          '--_tile-glow': preview?.color ?? glow,
          '--_tile-tint': tint,
        } as CSSProperties
      }
    >
      <div className="dio-top" data-bare={fit.kind !== 'all' || makesWay || undefined}>
        {picture ? (
          <img className="dio-picture" src={picture} alt="" draggable={false} />
        ) : logo ? (
          <Logo {...logo} />
        ) : (
          <Icon
            icon={
              config.icon ??
              entityIcon(entity) ??
              config.piece_icon ??
              defaultIcon(config.entity, entity?.attributes.device_class, entity?.state)
            }
            on={on && !looksOff}
          />
        )}
        {beside ? (
          <div ref={besideBox} className="dio-beside">
            <Feature env={env} config={config} entity={entity!} onPreview={setPreview} />
          </div>
        ) : (
          controls &&
          !unavailable && (
            <div
              ref={corner}
              className="dio-controls"
              data-crowded={fit.kind === 'crowded' || undefined}
              style={fit.kind === 'crowded' ? ({ '--_control': `${fit.size}px` } as CSSProperties) : undefined}
            >
              {controls}
            </div>
          )
        )}
      </div>
      {wide && aside && !unavailable && !config.feature ? (
        <div className="dio-bottom">
          {text}
          <div className="dio-aside">{aside}</div>
        </div>
      ) : (
        text
      )}
      {addsRow(config.feature) && !unavailable && (
        <div className="dio-footer">
          <Feature env={env} config={config} entity={entity!} />
        </div>
      )}
    </div>
  )
}

// How tall a logo stands. One over twice as wide as it is tall stands
// lower, so that a long wordmark weighs about what a square mark does.
const LOGO_PX = 30

// An app's logo, the one for the card's theme shown and the other hidden.
function Logo({ light, dark, mono }: NonNullable<Props['logo']>) {
  const [ratio, setRatio] = useState(3)
  const height = LOGO_PX * Math.min(1, (ratio / 2) ** -0.5)
  const measure = (event: { currentTarget: HTMLImageElement }) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (naturalWidth && naturalHeight) setRatio(naturalWidth / naturalHeight)
  }
  return (
    <span className={cn('dio-logo', mono && 'dio-logo-mono')} style={{ height }}>
      {light === dark ? (
        <img src={light} alt="" draggable={false} onLoad={measure} />
      ) : (
        <>
          <img className="dio-logo-light" src={light} alt="" draggable={false} onLoad={measure} />
          <img className="dio-logo-dark" src={dark} alt="" draggable={false} />
        </>
      )}
    </span>
  )
}
