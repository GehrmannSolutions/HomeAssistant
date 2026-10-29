import { due } from '#/scene/pace.ts'
import { cn } from '#/lib/utils.ts'
import { useFrame } from '@react-three/fiber'
import { useEffect, useState } from 'react'

// A count of the frames the card drew in the last second, a developer
// setting. A room standing still reads zero, since nothing is drawn then.
// The ticker counts inside the 3D view and the badge shows the count over
// it, both holding the same list of when each frame was drawn.
export type FpsTicks = number[]

// Notes every tick that is drawn. It never asks for a frame itself, so a
// room that stands still stays still.
export function FpsTicker({ ticks }: { ticks: FpsTicks }) {
  useFrame(state => {
    if (due(state.clock)) ticks.push(performance.now())
  })
  return null
}

export function FpsBadge({ ticks }: { ticks: FpsTicks }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now()
      while (ticks.length > 0 && now - ticks[0] >= 1000) ticks.shift()
      setCount(ticks.length)
    }, 250)
    return () => clearInterval(id)
  }, [ticks])
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-2 right-2 z-10 rounded-lg bg-black/70 px-2.5 py-1 font-mono text-sm font-semibold tabular-nums',
        count === 0 ? 'text-[#5cff8a]' : count > 61 ? 'text-[#ff6b5c]' : 'text-[#ffd25c]',
      )}
    >
      {count} fps
    </div>
  )
}
