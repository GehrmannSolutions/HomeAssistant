import { DEFAULT_ASPECT_RATIO } from '#/constants.ts'

// Parses "16:9" or "4/3" into a width over height number.
export function aspectRatioNumber(value: string | undefined) {
  const match = (value ?? DEFAULT_ASPECT_RATIO).match(/^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/)
  if (!match) return 16 / 9
  return Number(match[1]) / Number(match[2])
}

// CSS aspect-ratio value for the same input, or the fallback when it does
// not read as a ratio.
export function aspectRatioCss(value: string | undefined, fallback = DEFAULT_ASPECT_RATIO) {
  const match = value?.match(/^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/)
  if (!match) return fallback
  return `${match[1]} / ${match[2]}`
}
