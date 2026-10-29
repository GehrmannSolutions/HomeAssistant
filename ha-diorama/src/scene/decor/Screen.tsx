import { useFrame } from '@react-three/fiber'
import { throws, useThrown, type Throw } from '#/scene/decor/throw.ts'
import { screenTint, showingTint } from '#/scene/decor/tint.ts'
import { useEased } from '#/scene/decor/ease.ts'
import { useLive } from '#/scene/live.ts'
import { useWarmed } from '#/scene/warm.ts'
import { LAMP_SHADOW_MAP_PX, LAMP_SHADOW_RADIUS } from '#/constants.ts'
import { sameShowing, usePicture, useShowingColor, type Showing } from '#/scene/decor/showing.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasTexture,
  DoubleSide,
  LinearMipmapLinearFilter,
  NoColorSpace,
  Texture,
  Vector2,
  Vector3,
  type Mesh,
  type Object3D,
  type PointLight,
  type ShaderMaterial,
} from 'three'

// A screen that is playing. Soft blocks of changing color glow out of black
// and drift across it, so a TV or a monitor that is on reads as running
// from across the room, without any video to load. The material lights
// itself, since a picture is not lit by the room.

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform float uTime;
uniform float uLevel;
// 0 for the colors it always had, 1 for the colors of an app, and 2 for
// cover art.
uniform float uMode;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform sampler2D uArt;
// How much of the art shows across and up, so it covers the screen.
uniform vec2 uFit;
// The logo and the title, over the picture.
uniform sampler2D uOver;
uniform float uHasOver;

// A deep, muted color of the given hue, from 0 to 1 round the wheel.
vec3 shade(float h) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(0.12), k, 0.75) * 0.62;
}

void main() {
  vec2 p = vUv;
  float t = uTime * 0.45;
  float a = sin(p.x * 4.0 + t * 1.7) * 0.5 + 0.5;
  float b = sin((p.y + p.x * 0.4) * 5.0 - t * 2.1) * 0.5 + 0.5;
  float c = sin((p.y - p.x) * 3.0 + t * 1.1) * 0.5 + 0.5;
  // The colors glow out of a dark screen, brightest where the waves overlap.
  float glow = smoothstep(0.0, 0.75, a * 0.45 + c * 0.35 + b * 0.2);
  vec3 col;
  if (uMode > 1.5) {
    // The cover art, darkened a little so the words over it read, and
    // softened only a hint, so it shows almost as sharp as it is. It drifts
    // slowly in and out, easing at each end, so the picture is never still.
    float zoom = 1.0 - 0.18 * (0.5 - 0.5 * cos(uTime * 0.45));
    vec3 art = texture2D(uArt, (p - 0.5) * uFit * zoom + 0.5, 0.3).rgb;
    float grey = dot(art, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(grey), art, 1.2) * 0.8;
  } else if (uMode > 0.5) {
    // The app's three colors in the same waves, out of a dark shade of its
    // first one, as on its card.
    vec3 lit = mix(mix(uA, uB, clamp(a * 0.6 + c * 0.4, 0.0, 1.0)), uC, b * 0.35);
    col = mix(uA * 0.3, lit * 0.6, glow * 0.85);
  } else {
    // The hue starts on blue green and sways between greens and blues. Once
    // every hundred seconds it goes the whole way round the wheel, through
    // the yellows, oranges, reds and pinks, and back to blue green in half a
    // minute. The blocks drift between the tone of the moment and its
    // neighbor, so there are never more than two colors on it at once.
    float trip = smoothstep(0.7, 1.0, fract(uTime / 100.0));
    float hue = 0.47 + 0.1 * sin(uTime * 0.15) + trip;
    col = mix(shade(hue), shade(hue + 0.08), clamp(a * 0.6 + c * 0.4, 0.0, 1.0));
    col = mix(vec3(0.02, 0.02, 0.03), col, glow);
  }
  vec4 over = texture2D(uOver, p);
  col = mix(col, over.rgb, over.a * uHasOver);
  gl_FragColor = vec4(col, uLevel);
}
`

// The colors of a hex color from 0 to 1, as they are, the way the picture
// writes its own.
const rgbOf = (hex: string, out: Vector3) =>
  out.set(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255)

// How wide a card is, in its own pixels, for a TV to show what plays in
// the same proportions. A projection is bigger and seen from further, so
// its logo and its words take less of it.
export const TV_CARD_PX = 245
export const PROJECTION_CARD_PX = 340
// The logo, the title and the space round them on a card, in its pixels.
const PADDING_PX = 18
const LOGO_PX = 30
const LOGO_MAX_PX = 120
const TITLE_PX = 15
const SUBTITLE_PX = 11
// How much faster the colors of an app drift on a screen than on its card.
const COLORS_PACE = 3
// How wide the drawing of the words and the logo is, in texture pixels.
const OVER_PX = 2048

// The logo in the top left corner and the title in the bottom left one,
// with the app it plays from in a smaller line under it, on
// the clear canvas of `over`, `aspect` times as wide as it is tall, as on a
// card `card` pixels wide.
function drawOver(
  over: CanvasTexture,
  aspect: number,
  card: number,
  logo: { image: HTMLImageElement; mono: boolean } | null,
  title: string | null,
  subtitle: string | null,
) {
  const canvas = over.image as HTMLCanvasElement
  const height = Math.round(OVER_PX / aspect)
  // The graphics card keeps the size the texture was first sent at, often
  // that of the empty canvas, so a canvas that changes size is sent anew.
  if (canvas.width !== OVER_PX || canvas.height !== height) over.dispose()
  over.needsUpdate = true
  canvas.width = OVER_PX
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return
  const k = OVER_PX / card
  const pad = PADDING_PX * k
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (logo) {
    const { naturalWidth: lw, naturalHeight: lh } = logo.image
    const ratio = lw && lh ? lw / lh : 3
    // A long wordmark stands lower, as on the card.
    let h = LOGO_PX * k * Math.min(1, (ratio / 2) ** -0.5)
    let w = h * ratio
    if (w > LOGO_MAX_PX * k) {
      w = LOGO_MAX_PX * k
      h = w / ratio
    }
    // Over a dark shade fading out from the corner, and on a soft shadow,
    // so a logo in the colors of its own app, like a red one over red,
    // still stands out of them.
    const reach = Math.max(w, h) * 1.6 + pad
    const shade = context.createRadialGradient(pad + w / 2, pad + h / 2, 0, pad + w / 2, pad + h / 2, reach)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = shade
    context.fillRect(0, 0, pad + w / 2 + reach, pad + h / 2 + reach)
    context.filter = `${logo.mono ? 'brightness(0) invert(1) ' : ''}drop-shadow(0 0 ${3 * k}px rgba(0, 0, 0, 0.8))`
    context.drawImage(logo.image, pad, pad, w, h)
    context.filter = 'none'
  }
  if (title) {
    const size = TITLE_PX * k
    context.font = `600 ${size}px Inter, system-ui, sans-serif`
    context.fillStyle = '#ffffff'
    context.textBaseline = 'alphabetic'
    // Two lines at most, the second cut short, as on the card.
    const room = canvas.width * 0.62
    const words = title.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (line && context.measureText(next).width > room) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
    if (lines.length > 2) lines.splice(1, lines.length, lines.slice(1).join(' '))
    // The app's line, smaller and fainter, under the title.
    const small = SUBTITLE_PX * k
    const below = subtitle ? small * 1.5 : 0
    // Over a dark shade rising from the bottom, so it reads on a light cover.
    const rise = lines.length * size * 1.2 + below + pad * 3
    const shade = context.createLinearGradient(0, canvas.height, 0, canvas.height - rise)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.5)')
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = shade
    context.fillRect(0, canvas.height - rise, canvas.width, rise)
    context.fillStyle = '#ffffff'
    // A black outline round each letter, as subtitles have.
    context.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    context.lineWidth = size * 0.16
    context.lineJoin = 'round'
    lines.forEach((text, i) => {
      let shown = text
      if (context.measureText(shown).width > room) {
        while (shown.length > 1 && context.measureText(`${shown}…`).width > room) shown = shown.slice(0, -1)
        shown = `${shown.trimEnd()}…`
      }
      const y = canvas.height - pad - below - (lines.length - 1 - i) * size * 1.2 - size * 0.25
      context.strokeText(shown, pad, y)
      context.fillText(shown, pad, y)
    })
    if (subtitle) {
      context.font = `500 ${small}px Inter, system-ui, sans-serif`
      context.lineWidth = small * 0.16
      context.fillStyle = '#ffffff'
      // Faded, outline and all, so it reads as a note to the title.
      context.globalAlpha = 0.5
      const y = canvas.height - pad - small * 0.25
      context.strokeText(subtitle, pad, y)
      context.fillText(subtitle, pad, y)
      context.globalAlpha = 1
    }
  }
}

/**
 * A screen that plays. Bound to a player that is on, it shows what plays
 * the way its card does: the cover art, or else the colors of its app in
 * the same waves, held still while it is paused, with the app's logo and
 * the title over them. `aspect` is how much wider the picture is than it is
 * tall and `card` how wide a card it is drawn like, in the card's pixels.
 * `level`, when given, fades the picture in over whatever is behind it, for
 * one that is thrown onto a projection screen rather than lit from inside.
 */
export default function ScreenMaterial({
  level,
  showing,
  aspect = 16 / 9,
  card = TV_CARD_PX,
}: {
  level?: { current: number }
  showing?: Showing | null
  aspect?: number
  card?: number
}) {
  const ref = useRef<ShaderMaterial>(null)
  const over = useMemo(() => {
    const texture = new CanvasTexture(document.createElement('canvas'))
    texture.colorSpace = NoColorSpace
    // Sharp when the screen is seen from the side.
    texture.anisotropy = 8
    return texture
  }, [])
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 1 },
      uMode: { value: 0 },
      uA: { value: new Vector3() },
      uB: { value: new Vector3() },
      uC: { value: new Vector3() },
      uArt: { value: null as Texture | null },
      uFit: { value: new Vector2(1, 1) },
      uOver: { value: over },
      uHasOver: { value: 0 },
    }),
    [over],
  )
  const cover = usePicture(showing?.art)
  const logo = usePicture(showing?.logo?.src)
  const art = useMemo(() => {
    if (!cover) return null
    const texture = new Texture(cover.image)
    texture.colorSpace = NoColorSpace
    texture.minFilter = LinearMipmapLinearFilter
    texture.needsUpdate = true
    return texture
  }, [cover])
  useEffect(() => () => art?.dispose(), [art])
  useEffect(() => () => over.dispose(), [over])
  const title = showing?.title ?? null
  const subtitle = showing?.subtitle ?? null
  const mono = !!showing?.logo?.mono
  useLayoutEffect(() => {
    // The material keeps its own copy of the uniforms, so its are the ones
    // set.
    const u = ref.current?.uniforms as typeof uniforms | undefined
    if (!u) return
    u.uOver.value = over
    u.uMode.value = !showing ? 0 : art ? 2 : 1
    if (showing) showing.colors.forEach((hex, i) => rgbOf(hex, [u.uA, u.uB, u.uC][i].value))
    u.uArt.value = art
    if (cover) {
      // Covering the screen, cut at its long sides.
      const ratio = cover.image.naturalWidth / Math.max(1, cover.image.naturalHeight)
      u.uFit.value.set(ratio > aspect ? aspect / ratio : 1, ratio > aspect ? 1 : ratio / aspect)
    }
    const shown = showing && (logo || title)
    u.uHasOver.value = shown ? 1 : 0
    if (shown) {
      drawOver(over, aspect, card, logo && { image: logo.image, mono }, title, subtitle)
    }
  }, [uniforms, showing, art, cover, logo, mono, title, subtitle, aspect, card, over])
  // Only shown while the screen is on, so it plays for as long as it is.
  // On the scene's clock, so the glow round it keeps the same color. A
  // player's colors run on a clock of their own, which stops while it is
  // paused. Without cover art that clock runs faster than on the card, so
  // the colors are seen to move from across the room.
  useLive(true)
  const own = useRef(0)
  const still = !!showing && !showing.playing
  const pace = cover ? 1 : COLORS_PACE
  useFrame(({ clock }, delta) => {
    if (!ref.current) return
    if (!still) own.current += delta * pace
    ref.current.uniforms.uTime.value = showing ? own.current : clock.elapsedTime
    // Copied each frame, since the material keeps its own copy of the uniforms.
    if (level) ref.current.uniforms.uLevel.value = level.current
  })
  return (
    <shaderMaterial
      ref={ref}
      uniforms={uniforms}
      vertexShader={VERTEX}
      fragmentShader={FRAGMENT}
      toneMapped={false}
      transparent={!!level}
      side={level ? DoubleSide : undefined}
    />
  )
}

/**
 * The light a playing screen throws on the room, in the color on the
 * screen at the moment, so a TV that is on reads from behind it too. It
 * fades in and out with the screen and stays mounted at zero when off,
 * since adding and removing lights recompiles every material in the scene.
 */
export function ScreenGlow({
  on,
  position,
  intensity,
  distance,
  showing,
}: {
  on: boolean
  position: [number, number, number]
  intensity: number
  distance: number
  showing?: Showing | null
}) {
  const lit = useEased(on ? 1 : 0, 4)
  const light = useRef<PointLight>(null)
  // Ranked for the shadows by where it is heading, the way a lamp is,
  // and casting from the first frame it is lit. Ranked by its fade, it took
  // a shadow from a lamp already on while it came up, and the shadows of
  // both jumped about.
  const rank = on ? intensity : 0
  const latestRank = useRef(rank)
  useLayoutEffect(() => {
    latestRank.current = rank
  })
  const shown = useWarmed(lit > 0.01, visible => {
    if (!light.current) return
    light.current.visible = visible
    if (visible && latestRank.current > 0) light.current.castShadow = true
  })
  const rgb = useMemo<[number, number, number]>(() => [0, 0, 0], [])
  // Showing what a player plays, it is the main color of its picture.
  const color = useShowingColor(showing)
  useLive(on)
  useFrame(({ clock }) => {
    if (!light.current) return
    if (color) showingTint(color, rgb)
    else screenTint(clock.elapsedTime, rgb)
    light.current.color.setRGB(rgb[0], rgb[1], rgb[2])
  })
  return (
    <pointLight
      ref={light}
      position={position}
      intensity={intensity * lit}
      distance={distance}
      decay={1}
      visible={shown}
      userData={{ rank }}
      shadow-mapSize={[LAMP_SHADOW_MAP_PX, LAMP_SHADOW_MAP_PX]}
      shadow-radius={LAMP_SHADOW_RADIUS}
      shadow-bias={-0.0012}
      shadow-normalBias={0.008}
      shadow-camera-near={0.05}
      shadow-camera-far={distance}
    />
  )
}

// How square on a projector must face a projection screen for its picture
// to land on it, as the cosine of the angle between the two.
const FACING = Math.cos((35 * Math.PI) / 180)

// How far past its drawn beam a projector's picture still lands, since the
// beam is only the haze in the air, as a share of its throw.
const REACH = 2

const top = (object: Object3D) => {
  while (object.parent) object = object.parent
  return object
}

/**
 * The picture on a projection screen `w` by `h`, rolled out to `open` of
 * its height: the same colors as a TV that is on, faded in while a
 * projector that is on throws its picture at it. The projector has to face
 * the screen, from either side, near enough square on, and the middle of
 * its throw has to land on the sheet within its reach. Placed in the middle
 * of the sheet as it hangs. A projector aimed at it is told where the
 * picture will be once the sheet is all the way down, even while it is
 * rolled up, so its beam never changes shape as the sheet comes down.
 */
export function Projection({ w, h, open }: { w: number; h: number; open: number }) {
  // Nothing to look for, and no frames to keep coming, while no projector
  // anywhere is on.
  return useThrown() ? <Picture w={w} h={h} open={open} /> : null
}

function Picture({ w, h, open }: { w: number; h: number; open: number }) {
  // A picture never quite fills the sheet, so a little of it shows white
  // all round.
  const edge = Math.min(w, h) * 0.05
  const mesh = useRef<Mesh>(null)
  const level = useRef(0)
  // What the projector that lands on it shows.
  const [showing, setShowing] = useState<Showing | null>(null)
  const latest = useRef<Showing | null>(null)
  const v = useMemo(
    () => ({
      c: new Vector3(),
      n: new Vector3(),
      x: new Vector3(),
      y: new Vector3(),
      o: new Vector3(),
      d: new Vector3(),
      p: new Vector3(),
    }),
    [],
  )
  // The corners of the picture with the sheet all the way down, which the
  // projector aimed at it is told of, so its beam reaches them.
  const corners = useMemo(() => [new Vector3(), new Vector3(), new Vector3(), new Vector3()], [])
  const lit = useRef<Throw | null>(null)
  useEffect(
    () => () => {
      if (lit.current?.lands === corners) lit.current.lands = null
    },
    [corners],
  )
  useFrame((_, delta) => {
    const m = mesh.current
    const sheet = m?.parent
    if (!m || !sheet) return
    sheet.updateWorldMatrix(true, false)
    sheet.matrixWorld.extractBasis(v.x, v.y, v.n)
    v.x.normalize()
    v.y.normalize()
    v.n.normalize()
    // The middle of the sheet as it hangs, and how far above the middle of
    // the whole sheet that is.
    const raised = (h * (1 - open)) / 2
    v.c.set(0, -raised, 0).applyMatrix4(sheet.matrixWorld)
    const home = top(sheet)
    let target = 0
    let side = 1
    let shows: Showing | null = latest.current
    let aimed: Throw | null = null
    let strongest = 0
    for (const t of throws) {
      const o = t.object
      if (!o || top(o) !== home) continue
      o.updateWorldMatrix(true, false)
      v.o.setFromMatrixPosition(o.matrixWorld)
      v.d.setFromMatrixColumn(o.matrixWorld, 2).normalize()
      const facing = v.d.dot(v.n)
      if (Math.abs(facing) < FACING) continue
      const along = v.p.subVectors(v.c, v.o).dot(v.n) / facing
      if (along <= 0 || along > t.length * REACH) continue
      v.p.copy(v.o).addScaledVector(v.d, along).sub(v.c)
      const x = v.p.dot(v.x)
      const y = v.p.dot(v.y)
      if (Math.abs(x) > w * 0.6 || Math.abs(y) > h / 2 + h * 0.1) continue
      if (t.strength > strongest) {
        strongest = t.strength
        aimed = t
      }
      // The picture only shows on as much of the sheet as hangs down.
      if (Math.abs(y - raised) > (h * open) / 2 + h * 0.1) continue
      if (t.strength > target) {
        target = t.strength
        // On the face the light comes from.
        side = facing < 0 ? 1 : -1
        shows = t.showing
      }
    }
    // Kept while the picture fades out, so it fades out as it was.
    if (target > 0 && !sameShowing(shows, latest.current)) {
      latest.current = shows
      setShowing(shows)
    }
    level.current += (target - level.current) * Math.min(1, delta * 4)
    m.visible = level.current > 0.01 && h * open > 2 * edge
    m.position.z = side * 0.003
    // Seen from the face the light comes from, so it never reads backwards.
    m.scale.x = (side * (w - 2 * edge)) / w
    if (lit.current !== aimed && lit.current?.lands === corners) lit.current.lands = null
    lit.current = aimed
    if (aimed) {
      corners.forEach((corner, i) =>
        corner
          .set(i % 3 === 0 ? edge - w / 2 : w / 2 - edge, (i < 2 ? edge - h / 2 : h / 2 - edge) - raised, 0)
          .applyMatrix4(sheet.matrixWorld),
      )
      aimed.lands = corners
    }
  })
  return (
    <mesh ref={mesh} scale-y={Math.max(0.001, h * open - 2 * edge) / h}>
      <planeGeometry args={[w, h]} />
      <ScreenMaterial
        level={level}
        showing={showing}
        aspect={(w - 2 * edge) / (h - 2 * edge)}
        card={PROJECTION_CARD_PX}
      />
    </mesh>
  )
}
