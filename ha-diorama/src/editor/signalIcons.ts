import type { Signal } from '#/signals.ts'
import {
  faGauge,
  faHandPointer,
  faList,
  faPalette,
  faPowerOff,
  faSliders,
  faSun,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'

// The controls a device exposes, and what an item can express, written the
// same way in both panels so a device and an item can be compared at a
// glance.
export const SIGNAL_ICONS: Record<Signal, IconDefinition> = {
  toggle: faPowerOff,
  level: faSliders,
  color: faPalette,
  warmth: faSun,
  value: faGauge,
  enum: faList,
  press: faHandPointer,
}

export const SIGNAL_LABELS: Record<Signal, string> = {
  toggle: 'On and off',
  level: 'Percentage',
  color: 'Color',
  warmth: 'Warmth',
  value: 'Reading',
  enum: 'Modes',
  press: 'Press',
}

// The longer word for it, shown on hover.
export const SIGNAL_HINTS: Record<Signal, string> = {
  toggle: 'Turns on and off',
  level: 'A percentage, such as a position or a brightness',
  color: 'A color',
  warmth: 'Color temperature, in kelvin',
  value: 'A number it reads out',
  enum: 'One of a set of modes',
  press: 'Pressed once, it does one thing and is done',
}
