import { useState } from 'react'

// A cover made from a template reports the place it was sent to for a moment
// as it starts to move, and only then where it really is. So while it still
// says it is moving, a report of the place it was sent to, from somewhere
// else, is taken as that echo, and the last place it really was is kept.
// Once it stops there, it is there.
export function useUnechoed(level: number, sent: number | null, moving: boolean, near: number) {
  const [real, setReal] = useState(level)
  const echo = moving && sent !== null && Math.abs(level - sent) < near && Math.abs(real - sent) >= near
  if (!echo && real !== level) setReal(level)
  return echo ? real : level
}
