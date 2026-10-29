import { cn } from '#/lib/utils.ts'
import { haptic } from '#/tiles/actions.ts'
import { insideTile } from '#/tiles/gestures.ts'
import { Icon } from '#/tiles/Icon.tsx'
import { useState, type CSSProperties, type KeyboardEvent } from 'react'

// The code of an alarm, entered on round keys like a phone's, or typed in
// a field for an alarm whose code is not only digits.

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

type Props = {
  // number for a keypad, text for a field.
  format: 'number' | 'text'
  // What the code is for, said on the button that sends it, like Disarm.
  action: string
  onSubmit: (code: string) => void
  onCancel?: () => void
  // False while the code has nothing to do yet, like a panel where no mode
  // is picked, which turns the keys off.
  ready?: boolean
  // Smaller keys, with delete left of the zero and the key that sends the
  // code right of it in place of the button under them, for a keypad on a
  // tile.
  compact?: boolean
  // The icon and the color of the key that sends the code, saying what it
  // does, like an open lock in green to disarm. A tick unless set.
  go?: { icon: string; color: string }
  // What it says before a digit is in, Enter code unless set.
  hint?: string
  // The code, for a keypad whose code is also read outside it.
  code?: string
  onCode?: (code: string) => void
}

export function Keypad({ format, action, onSubmit, onCancel, ready = true, go, compact, hint, ...held }: Props) {
  const [own, setOwn] = useState('')
  const code = held.code ?? own
  const setCode = (next: (now: string) => string) => (held.onCode ?? setOwn)(next(code))
  const type = (key: string) => {
    haptic('selection')
    setCode(now => (now + key).slice(0, 12))
  }
  const back = () => setCode(now => now.slice(0, -1))
  const submit = () => {
    if (!code || !ready) return
    onSubmit(code)
    setCode(() => '')
  }
  const tick = (
    <button
      {...insideTile}
      type="button"
      aria-label={action}
      title={action}
      className="dio-key dio-key-go"
      style={go && ({ '--_go-color': go.color } as CSSProperties)}
      disabled={!code || !ready}
      onClick={e => {
        e.stopPropagation()
        submit()
      }}
    >
      <Icon icon={go?.icon ?? 'ph:check'} />
    </button>
  )
  const remove = (
    <button
      {...insideTile}
      type="button"
      aria-label="Delete"
      className="dio-key dio-key-plain"
      disabled={!code}
      onClick={e => {
        e.stopPropagation()
        back()
      }}
    >
      <Icon icon="ph:backspace" />
    </button>
  )
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (format !== 'number') return
    if (!ready) return
    if (/^\d$/.test(e.key)) type(e.key)
    else if (e.key === 'Backspace') back()
    else if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') onCancel?.()
    else return
    e.preventDefault()
  }
  return (
    <div
      className={cn('dio-keypad', compact && 'dio-keypad-compact')}
      onKeyDown={onKeyDown}
      onPointerDown={e => e.stopPropagation()}
    >
      {format === 'number' ? (
        <div className="dio-keypad-dots" aria-live="polite" aria-label={`${code.length} digits entered`}>
          {code.length === 0 ? (
            <span className="dio-keypad-hint">{hint ?? 'Enter code'}</span>
          ) : (
            [...code].map((_, i) => <span key={i} className="dio-keypad-dot" />)
          )}
        </div>
      ) : (
        <input
          className="dio-keypad-field"
          type="password"
          autoComplete="off"
          placeholder={hint ?? 'Code'}
          aria-label="Code"
          value={code}
          onChange={e => setCode(() => e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      )}
      {compact && format !== 'number' && tick}
      {format === 'number' && (
        <div className="dio-keypad-keys">
          {KEYS.map(key => (
            <Key key={key} label={key} disabled={!ready} onPress={() => type(key)} />
          ))}
          {compact ? (
            <>
              {remove}
              <Key label="0" disabled={!ready} onPress={() => type('0')} />
              {tick}
            </>
          ) : (
            <>
              <span />
              <Key label="0" disabled={!ready} onPress={() => type('0')} />
              {remove}
            </>
          )}
        </div>
      )}
      {!compact && (
        <div className="dio-keypad-actions">
          {onCancel && (
            <button
              {...insideTile}
              type="button"
              className="dio-pill dio-pill-action"
              onClick={e => {
                e.stopPropagation()
                setCode(() => '')
                onCancel()
              }}
            >
              <span className="dio-pill-label">Cancel</span>
            </button>
          )}
          <button
            {...insideTile}
            type="button"
            className="dio-pill dio-pill-action dio-pill-primary"
            disabled={!code || !ready}
            onClick={e => {
              e.stopPropagation()
              submit()
            }}
          >
            <span className="dio-pill-label">{action}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function Key({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <button
      {...insideTile}
      type="button"
      disabled={disabled}
      className="dio-key"
      onClick={e => {
        e.stopPropagation()
        onPress()
      }}
    >
      {label}
    </button>
  )
}
