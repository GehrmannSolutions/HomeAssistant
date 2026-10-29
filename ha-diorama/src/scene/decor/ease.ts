import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'

// Eases a value toward its target instead of letting it jump. Home Assistant
// reports a cover's position every second or so while it travels, and a
// switch flips in one step, so without this a door opens in stutters and a
// window snaps. The approach is exponential and scaled by the frame time, so
// it looks the same whatever the frame rate, and it only asks for a new
// render while it is actually moving.
export function useEased(target: number, rate = 3) {
  // A target that is not a number, a sensor reading of unknown say, would
  // poison the eased value for good, so it is taken as nothing instead.
  const aim = Number.isFinite(target) ? target : 0
  const [shown, setShown] = useState(aim)
  const from = useRef(aim)
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => {
    if (from.current !== aim) invalidate()
  }, [aim, invalidate])
  useFrame((_, delta) => {
    if (from.current === aim) return
    invalidate()
    const next =
      Math.abs(aim - from.current) < 0.001
        ? aim
        : from.current + (aim - from.current) * (1 - Math.exp(-rate * Math.min(delta, 0.1)))
    from.current = next
    setShown(next)
  })
  return shown
}

// A cover reports its position several times on the way: 20, 40, 60. The
// shown value only ever heads for the last one reported, never past it, so
// it can never be somewhere Home Assistant did not say it was. What the
// reports give is the pace: how far it moved between one and the next,
// divided by how long that took, is how fast the cover travels. Aiming at
// the reported position at that pace means arriving just as the next report
// lands, so the travel reads as one movement instead of a set of steps.

// Bounds on the pace, in units of the full travel per second. A cover that
// takes half a minute end to end and one that snaps shut both stay sane.
const SLOWEST = 0.05
const FASTEST = 2
// A step is one of the positions on the way. A larger change is a cover
// with no position at all, saying only open or shut, and is paced by the
// model's own guess instead.
const STEP = 0.5
// How long the first step is assumed to have taken, before there are two
// reports to measure between.
const FIRST_STEP_S = 1

// A target that is being dragged is shown where it is, with no easing, so
// the piece stays under the finger.
export function useTravel(target: number, fallback = 0.9, snap = false) {
  const [shown, setShown] = useState(target)
  const value = useRef(target)
  const report = useRef({ target, at: 0, speed: fallback })

  useEffect(() => {
    const now = performance.now() / 1000
    const last = report.current
    const gap = target - last.target
    if (gap === 0) return
    const since = last.at ? now - last.at : 0
    const stepped = Math.abs(gap) <= STEP
    // Two reports close enough together to be one travel are what the pace
    // is measured from. A first step, or one after a long quiet, is paced as
    // if it had taken about a second.
    const measured = stepped && since > 0.05 && since < 5 ? Math.abs(gap) / since : 0
    const paced = measured || (stepped ? Math.abs(gap) / FIRST_STEP_S : fallback)
    report.current = { target, at: now, speed: Math.min(Math.max(paced, SLOWEST), FASTEST) }
  }, [target, fallback])

  const invalidate = useThree(state => state.invalidate)
  useEffect(() => {
    invalidate()
  }, [target, invalidate])
  useFrame((_, delta) => {
    const aim = Number.isFinite(target) ? Math.min(Math.max(target, 0), 1) : value.current
    if (value.current === aim) return
    invalidate()
    if (snap) {
      value.current = aim
      setShown(aim)
      return
    }
    const step = report.current.speed * Math.min(delta, 0.1)
    const rest = aim - value.current
    value.current = Math.abs(rest) <= step ? aim : value.current + Math.sign(rest) * step
    setShown(value.current)
  })

  return snap && Number.isFinite(target) ? Math.min(Math.max(target, 0), 1) : shown
}
