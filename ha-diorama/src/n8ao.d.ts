// n8ao ships no types. This is the part of it the scene uses.
declare module 'n8ao' {
  import type { Pass } from 'postprocessing'
  import type { Camera, Color, Scene } from 'three'

  export type N8AOQuality =
    'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra' | 'Neural-Low' | 'Neural-Medium' | 'Neural-High'

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: {
      aoSamples: number
      aoRadius: number
      denoiseSamples: number
      denoiseRadius: number
      distanceFalloff: number
      intensity: number
      color: Color
      gammaCorrection: boolean
      screenSpaceRadius: boolean
      halfRes: boolean
      depthAwareUpsampling: boolean
      transparencyAware: boolean
      accumulate: boolean
    }
    setQualityMode(mode: N8AOQuality): void
  }
}
