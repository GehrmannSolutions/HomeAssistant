import { itemLevels, type DecorationKind } from '#/decoration/catalog.ts'
import { Slider, Switch } from '#/editor/panel.tsx'
import {
  isPositioned,
  levelTry,
  switchTry,
  KELVIN_MAX,
  KELVIN_MIN,
  WARM_WHITE_K,
  type Tint,
  type TryState,
} from '#/editor/tryState.ts'
import { colorWell, group, groupTitle, note, plainButton, row } from '#/editor/look.ts'
import { cn } from '#/lib/utils.ts'
import { faHandPointer } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

type Props = {
  kind: DecorationKind
  state: TryState | undefined
  // What it shows until something is tried, and what Reset goes back to.
  start: TryState
  accent: string
  onChange: (state: TryState | null) => void
}

// What the switch is called on each piece, where "on" would read oddly.
const SWITCH_LABELS: Record<string, string> = {
  door: 'Open',
  smart_lock: 'Locked',
  vacuum_robot: 'Running',
  sprinkler: 'Watering',
  desk: 'Standing',
  printer_3d: 'Printing',
}

// What a press does on each piece that takes one.
const PRESS_LABELS: Record<string, string> = {
  litter_box: 'Scoop',
  pet_feeder: 'Dispense',
  doorbell: 'Ring',
  door: 'Buzz open',
  coffee_machine: 'Brew a cup',
  fan_ceiling: 'One turn',
  fan_floor: 'One turn',
  fridge: 'Open and shut',
  kitchen_counter: 'Open and shut',
  upper_cabinets: 'Open and shut',
  vacuum_robot: 'Run a moment',
}
const FAMILY_PRESS_LABELS: Record<string, string> = { light: 'Blink', cover: 'Open and shut' }

const TINTS: { mode: Tint['mode'] | 'default'; label: string }[] = [
  { mode: 'default', label: 'Default' },
  { mode: 'white', label: 'White' },
  { mode: 'color', label: 'Color' },
]

// The states a piece can be tried in, one control for each thing it shows: a
// switch for on and off, a slider for each level, and a light's color. Only
// for the editor; nothing here is saved, and a device behind the piece is
// never told.
export default function TrySection({ kind, state, start, accent, onChange }: Props) {
  const s = state ?? start
  const levels = itemLevels(kind)
  // A positioned piece's switch opens and shuts it, so it is named for that.
  const switchLabel = SWITCH_LABELS[kind.id] ?? (isPositioned(kind) ? 'Open' : 'On')
  const isLight = kind.expresses.includes('color') || kind.expresses.includes('warmth')
  const set = (patch: Partial<TryState>) => onChange({ ...s, ...patch })
  const tintMode = s.tint?.mode ?? 'default'

  return (
    <div className={group}>
      <div className="flex items-center justify-between gap-2">
        <p className={groupTitle}>Try its states</p>
        {state && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-tint hover:bg-tint/10 -my-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      {/* The switch is fully on or fully off, and the first slider
          anything in between. Each moves the other. */}
      <label className={cn(row, 'grid-cols-[96px_1fr]')}>
        {switchLabel}
        <Switch checked={s.on} accent={accent} label={switchLabel} onChange={on => onChange(switchTry(kind, s, on))} />
      </label>
      {kind.expresses.includes('press') && (
        <div className={cn(row, 'grid-cols-[96px_1fr]')}>
          Press
          <button
            type="button"
            onClick={() => set({ presses: (s.presses ?? 0) + 1 })}
            className={cn(plainButton, 'justify-self-start')}
          >
            <FontAwesomeIcon icon={faHandPointer} className="size-3" />
            {PRESS_LABELS[kind.id] ?? FAMILY_PRESS_LABELS[kind.family] ?? 'Press'}
          </button>
        </div>
      )}
      {levels.map(level => {
        const value = s.levels[level.id] ?? 0
        const label = isLight ? 'Brightness' : level.label
        return (
          <label key={level.id} className={cn(row, 'grid-cols-[96px_1fr_56px]')}>
            {label}
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={value}
              aria-label={label}
              onChange={e => onChange(levelTry(kind, s, level.id, Number(e.target.value)))}
            />
            <span className="text-label-2 text-right text-xs tabular-nums">{Math.round(value * 100)}%</span>
          </label>
        )
      })}
      {isLight && (
        <>
          <div className={cn(row, 'grid-cols-[96px_1fr]')}>
            Light
            <div className="bg-fill-strong flex rounded-[8px] p-0.5">
              {TINTS.map(t => (
                <button
                  key={t.mode}
                  type="button"
                  aria-pressed={tintMode === t.mode}
                  onClick={() =>
                    set({
                      tint:
                        t.mode === 'default'
                          ? undefined
                          : t.mode === 'white'
                            ? { mode: 'white', kelvin: WARM_WHITE_K }
                            : { mode: 'color', hex: '#ff4fa0' },
                    })
                  }
                  className={cn(
                    'flex-1 rounded-[6px] py-1 text-xs font-medium transition-colors',
                    tintMode === t.mode
                      ? 'bg-raised text-(--primary-text-color) shadow-[0_1px_3px_rgba(0,0,0,0.2)]'
                      : 'text-label-2 hover:text-(--primary-text-color)',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {s.tint?.mode === 'white' && (
            <label className={cn(row, 'grid-cols-[96px_1fr_56px]')}>
              Warmth
              <Slider
                min={KELVIN_MIN}
                max={KELVIN_MAX}
                step={100}
                value={s.tint.kelvin}
                aria-label="Warmth"
                onChange={e => set({ tint: { mode: 'white', kelvin: Number(e.target.value) } })}
              />
              <span className="text-label-2 text-right text-xs tabular-nums">{s.tint.kelvin} K</span>
            </label>
          )}
          {s.tint?.mode === 'color' && (
            <label className={cn(row, 'grid-cols-[96px_1fr]')}>
              Color
              <input
                type="color"
                className={colorWell}
                value={s.tint.hex}
                onChange={e => set({ tint: { mode: 'color', hex: e.target.value } })}
              />
            </label>
          )}
        </>
      )}
      <p className={note}>
        Clicking it in 3D switches it too. Only for the editor: the real device is never touched and none of this is
        saved.
      </p>
    </div>
  )
}
