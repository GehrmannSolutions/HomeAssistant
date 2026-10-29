import { cn } from '#/lib/utils.ts'
import { callService, haptic, type TileEnv } from '#/tiles/actions.ts'
import { Control } from '#/tiles/Control.tsx'
import { insideTile } from '#/tiles/gestures.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { Icon } from '#/tiles/Icon.tsx'
import { supports } from '#/tiles/features/parts.tsx'
import { Panel } from '#/tiles/Panel.tsx'
import type { HomeAssistant } from '#/types.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Item = { uid: string; summary: string; status: 'needs_action' | 'completed'; due?: string }

// What a to-do list lets a card do, as Home Assistant numbers it.
const CREATE = 1
const DELETE = 2
const UPDATE = 4

// The items of a list, kept up to date for as long as the card shows.
function useItems(hass: HomeAssistant, entityId: string | undefined) {
  const [items, setItems] = useState<Item[] | null>(null)
  const connection = hass.connection
  useEffect(() => {
    if (!entityId || !connection) return
    let unsubscribe: (() => void) | undefined
    let live = true
    connection
      .subscribeMessage<{ items: Item[] }>(event => live && setItems(event.items), {
        type: 'todo/item/subscribe',
        entity_id: entityId,
      })
      .then(stop => (live ? (unsubscribe = stop) : stop()))
      .catch(() => live && setItems([]))
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [connection, entityId])
  return items
}

// The rows of a dashboard's grid, and the room between two of them.
const ROW = 56
const ROW_GAP = 8

// Keeps the card an even number of grid rows tall, two at the least, so it
// grows two rows at a time as the list does.
function useEvenRows() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const body = ref.current
    const tile = body?.closest<HTMLElement>('.dio-tile')
    if (!body || !tile) return
    const snap = () => {
      tile.style.minHeight = ''
      // A pixel or two over, from rounding, does not take two more rows.
      const rows = Math.max(2, Math.ceil((tile.offsetHeight + ROW_GAP - 2) / (ROW + ROW_GAP) / 2) * 2)
      tile.style.minHeight = `${rows * (ROW + ROW_GAP) - ROW_GAP}px`
    }
    const observer = new ResizeObserver(snap)
    for (const child of body.children) observer.observe(child)
    observer.observe(body)
    return () => observer.disconnect()
  })
  return ref
}

// The teal the first calendar of a calendar card takes, so the two cards
// match side by side.
const ACCENT = '#12a594'

// A to-do list: what is left to do with a round check to tick each off, and
// what is done under it, across the card from under the icon to the name.
// Plus in the top right opens a field just left of it, and once something
// is written there it turns green and adds it. A broom clears away what is
// done.
export default function Todo({ env, config }: { env: TileEnv; config: TileConfig }) {
  const entity = env.hass.states[config.entity!]
  const items = useItems(env.hass, config.entity)
  const body = useEvenRows()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const open = (items ?? []).filter(item => item.status === 'needs_action')
  const done = (items ?? []).filter(item => item.status === 'completed')
  const language = env.hass.locale?.language ?? env.hass.language
  const target = { entity_id: config.entity }
  const tick = (item: Item) => {
    haptic('selection')
    void callService(env.hass, 'todo.update_item', {
      ...target,
      item: item.uid,
      status: item.status === 'completed' ? 'needs_action' : 'completed',
    })
  }
  const add = () => {
    const summary = draft.trim()
    if (!summary) return
    void callService(env.hass, 'todo.add_item', { ...target, item: summary })
    setDraft('')
  }
  const ready = adding && !!draft.trim()
  const row = (item: Item) => (
    <li key={item.uid} className="dio-todo-item" data-done={item.status === 'completed' || undefined}>
      <button
        {...insideTile}
        type="button"
        role="checkbox"
        aria-checked={item.status === 'completed'}
        aria-label={item.summary}
        className="dio-check"
        disabled={!supports(entity, UPDATE)}
        onClick={() => tick(item)}
      >
        {item.status === 'completed' && <Icon icon="ph:check-bold" on />}
      </button>
      <div className="dio-todo-text">
        <div className="dio-todo-summary">{item.summary}</div>
        {item.due && (
          <div className="dio-todo-due">
            {new Date(item.due.length === 10 ? `${item.due}T00:00:00` : item.due).toLocaleDateString(language, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </div>
        )}
      </div>
    </li>
  )
  return (
    <Panel
      env={env}
      config={config}
      entity={entity}
      state={!items ? 'Loading' : open.length === 0 ? 'All done' : `${open.length} to do`}
      accent={ACCENT}
      className="dio-todo"
      controls={
        (supports(entity, CREATE) || (done.length > 0 && supports(entity, DELETE))) && (
          <>
            {done.length > 0 && supports(entity, DELETE) && (
              <Control
                icon="ph:broom"
                label="Clear done"
                onPress={() => callService(env.hass, 'todo.remove_completed_items', target)}
              />
            )}
            {supports(entity, CREATE) && (
              <>
                {adding && (
                  <input
                    {...insideTile}
                    className="dio-todo-field"
                    value={draft}
                    placeholder="Add an item"
                    aria-label="Add an item"
                    enterKeyHint="done"
                    autoFocus
                    onClick={e => e.stopPropagation()}
                    onBlur={() => !draft.trim() && setAdding(false)}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') add()
                      if (e.key === 'Escape') {
                        setDraft('')
                        setAdding(false)
                      }
                    }}
                  />
                )}
                <button
                  type="button"
                  aria-label={ready ? 'Add' : 'Add an item'}
                  title={ready ? 'Add' : 'Add an item'}
                  className={cn('dio-control dio-todo-plus', ready && 'dio-todo-ready')}
                  // Pressed while the field is open, it keeps the field
                  // focused, so the field does not close and open again.
                  onPointerDown={e => {
                    e.stopPropagation()
                    if (adding) e.preventDefault()
                  }}
                  onKeyDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation()
                    if (!adding) setAdding(true)
                    else if (ready) add()
                    else setAdding(false)
                  }}
                >
                  <Icon icon="ph:plus-bold" on />
                </button>
              </>
            )}
          </>
        )
      }
    >
      <div ref={body} className="dio-todo-body" data-empty={!open.length && !done.length ? '' : undefined}>
        {open.length > 0 && <ul className="dio-todo-list">{open.map(row)}</ul>}
        {done.length > 0 && (
          <>
            <div className="dio-todo-head">
              <span>Done</span>
            </div>
            <ul className="dio-todo-list">{done.map(row)}</ul>
          </>
        )}
      </div>
    </Panel>
  )
}
