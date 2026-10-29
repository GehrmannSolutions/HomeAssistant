import type { HTMLAttributes } from 'react'
import type { HomeAssistant } from '#/types.ts'

// Baked in by the build from package.json.
declare global {
  const __CARD_VERSION__: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ha-card': HTMLAttributes<HTMLElement> & { header?: string }
      // Home Assistant's own icon, for any icon that is not a bundled one.
      'ha-icon': HTMLAttributes<HTMLElement> & { icon?: string }
      // Home Assistant's camera picture, a still that refreshes or a live
      // stream. Only rendered once the element is defined, so these are
      // set as properties.
      'hui-image': HTMLAttributes<HTMLElement> & {
        hass?: HomeAssistant | null
        cameraImage?: string
        image?: string
        cameraView?: 'auto' | 'live'
        fitMode?: 'cover' | 'contain' | 'fill'
        aspectRatio?: string
      }
    }
  }
}
