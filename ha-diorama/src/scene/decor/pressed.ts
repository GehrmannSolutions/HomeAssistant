import { decorationKind } from '#/decoration/catalog.ts'
import type { ItemState } from '#/scene/decor/state.ts'
import { useEffect, useRef, useState } from 'react'

// How fast a litter box turns while it cleans, in turns a second.
export const LITTER_TURN = 0.12

// How fast a fan's blades turn at its lowest, in radians a second. A level
// adds to it.
export const FAN_SPEED: Record<string, number> = { fan_ceiling: 2, fan_floor: 3 }

// How long a piece runs for one press of a button behind it, in seconds:
// what it does while on, once. Most switch on for a moment and go back. A
// light blinks, a fan goes one turn round, a door, a window or a fridge
// opens and shuts again, a litter box goes one turn over and back, a feeder
// drops one portion, a doorbell lights the ring round its button and a
// coffee machine makes one cup.
const PRESS_SECONDS: Record<string, number> = {
  litter_box: 1 / LITTER_TURN,
  pet_feeder: 3,
  doorbell: 4,
  coffee_machine: 10,
  // What opens on a press stands open for only a moment once it gets there,
  // so each is the time it takes to open and half a second more. Doors and
  // lids swing in about a second, a speaker or a projector in half of one.
  fridge: 1.5,
  kitchen_counter: 1.5,
  upper_cabinets: 1.5,
  toilet: 1.5,
  speaker: 1,
  floor_speaker: 1,
  projector: 1,
  projector_portable: 1,
  projector_ust: 1,
  // These travel the whole way at nearly one length a second.
  curtain: 1.6,
  projector_screen: 1.6,
  driveway_gate: 1.6,
  // One turn at the speed each runs at when nothing sets it.
  fan_ceiling: (Math.PI * 2) / FAN_SPEED.fan_ceiling,
  fan_floor: (Math.PI * 2) / FAN_SPEED.fan_floor,
  vacuum_robot: 4,
}
// Every cover travels as a curtain does, a door included.
const FAMILY_SECONDS: Record<string, number> = { light: 0.8, cover: 1.6 }
const PRESS_DEFAULT = 2.5

export const pressSeconds = (id: string) => {
  const kind = decorationKind(id)
  return PRESS_SECONDS[id] ?? (kind && FAMILY_SECONDS[kind.family]) ?? PRESS_DEFAULT
}

// What a piece shows while a press runs: switched on, and anything that
// opens fully open. A light is at full brightness for its blink. A fan keeps
// its own speed, so a press on one standing still turns it once.
export function pressedState(id: string, state: ItemState): ItemState {
  const levels = 'open' in state.levels ? { ...state.levels, open: 1 } : state.levels
  const level = state.level === undefined || id in FAN_SPEED ? state.level : 1
  return { ...state, on: true, level, levels }
}

// Whether the piece is running a press right now. The count it is first
// drawn with has already played, so nothing starts on load. A press that
// lands while one is running is part of it, which also folds a click and
// Home Assistant's word on the same press into one run.
export function usePressed(kind: string, presses: number | undefined) {
  const [running, setRunning] = useState(false)
  const seen = useRef(presses)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (presses === seen.current) return
    seen.current = presses
    if (presses === undefined || timer.current !== undefined) return
    setRunning(true)
    timer.current = setTimeout(
      () => {
        timer.current = undefined
        setRunning(false)
      },
      pressSeconds(kind) * 1000,
    )
  }, [kind, presses])
  useEffect(() => () => clearTimeout(timer.current), [])
  return running
}
