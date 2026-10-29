import type { TileEnv } from '#/tiles/actions.ts'
import type { TileConfig } from '#/tiles/host.tsx'
import { useNow } from '#/tiles/history.ts'
import { Panel } from '#/tiles/Panel.tsx'
import type { HomeAssistant } from '#/types.ts'
import { useEffect, useState, type CSSProperties } from 'react'

export type CalendarConfig = TileConfig & {
  // More calendars shown with the first one, each in its own color.
  entities?: string[]
  // How many days ahead the agenda reaches.
  days?: number
}

type When = { date?: string; dateTime?: string }
type RawEvent = { summary?: string; start: When; end: When; location?: string }
type Event = { title: string; start: Date; end: Date; allDay: boolean; location?: string; calendar: number }

// The color of each calendar, in the order the config lists them.
const COLORS = ['#12a594', '#0a84ff', '#ff9f0a', '#bf5af2', '#ff375f', '#ffd60a']

// How often the events are read again while the card shows.
const REFRESH_MS = 5 * 60_000
const DAY_MS = 86_400_000

const startOfDay = (time: number) => {
  const day = new Date(time)
  day.setHours(0, 0, 0, 0)
  return day
}

// An all day event starts at midnight where the dashboard is, not in UTC.
const parse = (when: When) => (when.dateTime ? new Date(when.dateTime) : new Date(`${when.date}T00:00:00`))

// The events of the calendars from today on, read from Home Assistant.
function useEvents(hass: HomeAssistant, ids: string[], days: number) {
  const [events, setEvents] = useState<Event[] | null>(null)
  const callApi = hass.callApi
  const key = ids.join(',')
  useEffect(() => {
    if (!callApi || !key) return
    let live = true
    const read = () => {
      const start = startOfDay(Date.now())
      const end = new Date(start.getTime() + days * DAY_MS)
      const query = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
      Promise.all(
        key.split(',').map((id, calendar) =>
          callApi<RawEvent[]>('GET', `calendars/${id}?${query}`)
            .then(list =>
              list.map(raw => ({
                title: raw.summary ?? '',
                start: parse(raw.start),
                end: parse(raw.end),
                allDay: !raw.start.dateTime,
                location: raw.location || undefined,
                calendar,
              })),
            )
            .catch(() => [] as Event[]),
        ),
      ).then(lists => {
        if (!live) return
        setEvents(lists.flat().sort((a, b) => a.start.getTime() - b.start.getTime()))
      })
    }
    read()
    const timer = setInterval(read, REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [callApi, key, days])
  return events
}

// The coming events of one calendar or more, across the whole card from
// under the icon down to the name: day by day, the events that last all
// day as plain grey round pills first, then each other event with its
// time, tinted in its calendar's color. With a single day it shows only
// today's. The line under the name says what
// is next.
export default function Calendar({ env, config }: { env: TileEnv; config: CalendarConfig }) {
  const entity = env.hass.states[config.entity!]
  const ids = [config.entity!, ...(config.entities ?? []).filter(id => id !== config.entity)]
  const days = config.days ?? 7
  const events = useEvents(env.hass, ids, days)
  const now = useNow(60_000)
  const language = env.hass.locale?.language ?? env.hass.language
  const time = (date: Date) => date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })
  const coming = (events ?? []).filter(event => event.end.getTime() > now)

  const today = startOfDay(now).getTime()
  const dayName = (day: number) => {
    if (day === today) return 'Today'
    if (day === today + DAY_MS) return 'Tomorrow'
    return new Date(day).toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'short' })
  }
  // An event that lasts days shows on each of them from today on.
  const byDay = new Map<number, Event[]>()
  for (const event of coming) {
    const last = Math.max(startOfDay(event.end.getTime() - 1).getTime(), startOfDay(event.start.getTime()).getTime())
    for (let day = Math.max(startOfDay(event.start.getTime()).getTime(), today); day <= last; day += DAY_MS) {
      if (day >= today + days * DAY_MS) break
      byDay.set(day, [...(byDay.get(day) ?? []), event])
    }
  }

  const next = coming[0]
  const state = !events
    ? 'Loading'
    : !next
      ? days === 1
        ? 'Nothing more today'
        : `Nothing in the next ${days} days`
      : next.start.getTime() <= now
        ? `Now: ${next.title}`
        : `Next: ${next.title}${next.allDay ? '' : `, ${time(next.start)}`}`

  return (
    <Panel env={env} config={config} entity={entity} state={state} accent={COLORS[0]} className="dio-calendar">
      <div className="dio-agenda" role="list">
        {events && coming.length === 0 && <div className="dio-agenda-empty">No events</div>}
        {[...byDay].map(([day, list]) => (
          <section key={day} className="dio-agenda-section" aria-label={dayName(day)}>
            <div className="dio-agenda-day" data-today={day === today || undefined}>
              {dayName(day)}
            </div>
            {list.some(event => event.allDay) && (
              <div className="dio-agenda-pills">
                {list
                  .filter(event => event.allDay)
                  .map((event, i) => (
                    <div
                      key={`${event.calendar}-${event.start.getTime()}-${i}`}
                      role="listitem"
                      className="dio-agenda-pill"
                    >
                      {event.title}
                    </div>
                  ))}
              </div>
            )}
            {list
              .filter(event => !event.allDay)
              .map((event, i) => (
                <div
                  key={`${event.calendar}-${event.start.getTime()}-${i}`}
                  role="listitem"
                  className="dio-agenda-event"
                  data-now={event.start.getTime() <= now || undefined}
                  style={{ '--_event': COLORS[event.calendar % COLORS.length] } as CSSProperties}
                >
                  <div className="dio-agenda-title">{event.title}</div>
                  <div className="dio-agenda-time">
                    {`${time(event.start)} to ${time(event.end)}`}
                    {event.location && ` · ${event.location}`}
                  </div>
                </div>
              ))}
          </section>
        ))}
      </div>
    </Panel>
  )
}
