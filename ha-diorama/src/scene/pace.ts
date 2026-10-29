// The card draws at most sixty frames a second. A screen that refreshes
// faster asks for a frame twice as often, and drawing every one of them
// doubled the work for a picture the eye can barely tell apart. Performance
// mode, on a phone or tablet, lowers that to twenty four. The ticks in
// between still run, so the camera and whatever moves keep their time, but
// nothing is drawn on them.

import { MAX_FPS, PERFORMANCE_MAX_FPS } from '#/constants.ts'
import { lean } from '#/lib/devSettings.ts'
import type { Clock } from 'three'

// A tick a hair early still counts, or a sixty hertz screen would lose one
// frame in every few to the jitter of its own timing.
const SLACK_S = 0.002

// Each card on the page keeps its own pace, by the clock of its canvas.
const paces = new WeakMap<Clock, { next: number; tick: number; answer: boolean }>()

// Whether the tick the clock is at is one to draw. Asked any number of
// times on the same tick, it gives the same answer.
export function due(clock: Clock) {
  const t = clock.elapsedTime
  let p = paces.get(clock)
  if (!p) paces.set(clock, (p = { next: 0, tick: -1, answer: true }))
  if (t === p.tick) return p.answer
  // The clock starts over when the card is paused and comes back.
  if (t < p.tick) p.next = 0
  p.tick = t
  p.answer = t + SLACK_S >= p.next
  const gap = 1 / (lean() ? PERFORMANCE_MAX_FPS : MAX_FPS)
  // After a rest the next frame is a whole gap away, not owed at once.
  if (p.answer) p.next = t - p.next > gap ? t + gap : p.next + gap
  return p.answer
}
