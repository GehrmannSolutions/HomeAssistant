// A device whose main pointer is a finger is taken to be a phone or a
// tablet, whose graphics are a fraction of a laptop's and which runs on a
// battery, so the costliest parts of the picture are scaled back on it. Only
// the main pointer is asked: many phones and tablets say they have a precise
// one as well, and a laptop with a touch screen is still a laptop.
export function coarseOnly(): boolean {
  if (typeof matchMedia !== 'function') return false
  return matchMedia('(pointer: coarse)').matches
}
