import { useEffect, useRef, useState } from 'react'

// How long a button shows that what it did took, before it reads as before.
export const FLASH_MS = 1500

// A moment of confirmation on a button: `flash()` turns `on` for a short
// while, then it goes off by itself. Calling again restarts the moment.
export function useFlash(): [on: boolean, flash: () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const flash = () => {
    if (timer.current) clearTimeout(timer.current)
    setOn(true)
    timer.current = setTimeout(() => setOn(false), FLASH_MS)
  }
  return [on, flash]
}
