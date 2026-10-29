// The flight each camera is on, for the fade around a focused room, which
// lasts as long as the flight there.
export const flights = new WeakMap<object, { current: { duration: number } | null }>()
