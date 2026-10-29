// How light the dashboard behind the card is, 0 for black and 1 for white.
//
// The card has no background of its own, so the home stands on whatever the
// dashboard is. On a pale one the eye is set by the white around the model,
// and a room lit for a dark dashboard reads as muddy, so the room's fill
// light is raised with this.
//
// The color is read from the theme's own variables, the same ones the card
// is drawn on. A dashboard background can be a picture rather than a color,
// which has no lightness to read, and then the theme's plain background
// stands in for it. With neither, Home Assistant's dark mode flag decides.
export function backdropLightness(element: Element, darkMode: boolean): number {
  const probe = document.createElement('div')
  probe.style.display = 'none'
  element.appendChild(probe)
  try {
    for (const name of ['--lovelace-background', '--primary-background-color']) {
      probe.style.backgroundColor = ''
      probe.style.backgroundColor = `var(${name})`
      const lightness = lightnessOf(getComputedStyle(probe).backgroundColor)
      if (lightness !== null) return lightness
    }
  } finally {
    probe.remove()
  }
  return darkMode ? 0 : 1
}

// Perceived lightness of a computed `rgb()` or `rgba()` color, 0 to 1, or
// null for one that is see through or not there at all.
function lightnessOf(color: string): number | null {
  if (!color.startsWith('rgb')) return null
  const parts = color.match(/[\d.]+/g)?.map(Number)
  if (!parts || parts.length < 3) return null
  if (parts.length > 3 && parts[3] < 0.5) return null
  const linear = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * linear(parts[0]) + 0.7152 * linear(parts[1]) + 0.0722 * linear(parts[2])
  // CIE lightness, which follows how bright a color looks rather than how
  // much light it gives: mid grey comes out near a half.
  const l = luminance > 216 / 24389 ? Math.cbrt(luminance) * 116 - 16 : luminance * (24389 / 27)
  return Math.min(Math.max(l / 100, 0), 1)
}
