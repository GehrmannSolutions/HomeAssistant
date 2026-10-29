import { MAX_SHADOW_LAMPS, MAX_SHADOW_LAMPS_TOUCH } from '#/constants.ts'
import { lean } from '#/lib/devSettings.ts'
import { coarseOnly } from '#/scene/device.ts'
import { Group, PointLight, RectAreaLight, type Object3D, type Scene } from 'three'

// Three bakes the count of each kind of light into every shader, so a lamp
// switched on asked for a new shader for every material in the home. Built
// ahead in the background that no longer froze the card, but on a phone the
// lamp still came on a second or two late the first time, and the card
// stuttered while it waited.
//
// So the counts are held to a few steps. The lights that are on are topped
// up with dark ones to the next step, and as many of those cast a shadow as
// it takes to keep the shadows at the budget. A lamp switched on or off then
// mostly lands on the step the scene is already at, with every shader built.
// The steps next to it are built in the background, see `ahead`, so the lamp
// that does cross a step finds its shaders waiting too.
//
// A dark light still costs each pixel its turn of the loop, which is why the
// counts go in steps rather than every lamp staying in the scene for good.
export const POINT_STEP = 4
export const AREA_STEP = 2

type Counts = { point: number; area: number }

type Pads = {
  group: Group
  plain: PointLight[]
  casting: PointLight[]
  area: RectAreaLight[]
  // Lights added on top while the step above is being built.
  extra: Counts
  // The counts the scene was last topped up to, without the extra.
  level: Counts
  budget: number
  // The lamps that cast, each with how strong its shadow is, from 0 to 1,
  // and whether it is on its way up or down.
  shade: Map<PointLight, { level: number; goal: number }>
  // When the shadows last moved, in milliseconds.
  last: number
}

const pads = new WeakMap<Scene, Pads>()

function of(scene: Scene): Pads {
  let p = pads.get(scene)
  if (!p) {
    const group = new Group()
    group.name = 'pads'
    // Far below the home, where they light and shade nothing.
    group.position.set(0, -1000, 0)
    scene.add(group)
    p = {
      group,
      plain: [],
      casting: [],
      area: [],
      extra: { point: 0, area: 0 },
      level: { point: 0, area: 0 },
      budget: coarseOnly() ? MAX_SHADOW_LAMPS_TOUCH : MAX_SHADOW_LAMPS,
      shade: new Map(),
      last: 0,
    }
    pads.set(scene, p)
  }
  // Performance mode, on a phone or tablet, takes every lamp's shadow away.
  p.budget = lean() ? 0 : coarseOnly() ? MAX_SHADOW_LAMPS_TOUCH : MAX_SHADOW_LAMPS
  // Something that emptied the scene took the group with it.
  if (p.group.parent !== scene) scene.add(p.group)
  return p
}

const up = (n: number, step: number) => Math.ceil(n / step) * step

type Lights = { point: PointLight[]; area: RectAreaLight[] }

// The lights of the home itself: those on, or with `hidden` all of them.
function collect(object: Object3D, skip: Object3D, hidden: boolean, into: Lights) {
  for (const child of object.children) {
    if (child === skip || (!hidden && !child.visible)) continue
    if (child instanceof PointLight) into.point.push(child)
    else if (child instanceof RectAreaLight) into.area.push(child)
    collect(child, skip, hidden, into)
  }
  return into
}

const rank = (lamp: PointLight): number => lamp.userData.rank ?? lamp.intensity

function fit<T extends Object3D>(p: Pads, list: T[], wanted: number, make: () => T) {
  while (list.length < wanted) {
    const light = make()
    p.group.add(light)
    light.updateMatrixWorld(true)
    list.push(light)
  }
  list.forEach((light, i) => {
    light.visible = i < wanted
  })
}

function pointPad(casting: boolean) {
  const light = new PointLight('#000000', 0, 0.1)
  if (casting) {
    light.castShadow = true
    light.shadow.mapSize.set(16, 16)
    light.shadow.camera.far = 1
  }
  return light
}

// How long a shadow takes to fade out, or in, when a lamp hands it over.
const FADE_S = 0.7

const ease = (t: number) => t * t * (3 - 2 * t)

// Which lamps cast. The brightest lamps that are on hold the shadows, up to
// the budget. A lamp past it gives its shadow up, and the one that takes it
// over gets it, but the count of shadows is in every shader and cannot go
// over the budget even for a frame, so the two cannot both cast at once.
// The shadow that is going fades out first, and only then does the other
// fade in. Switched at once, a shadow vanished from under a lamp the moment
// a brighter one came on, and it caught the eye. A lamp that comes on when
// there is a shadow to spare casts straight away, since its light is still
// coming up anyway. Says whether a shadow is on the move, so the frames
// keep coming until it is done.
function hand(p: Pads, lamps: PointLight[]) {
  const now = performance.now()
  // Long gaps are frames that were not drawn, not time a fade had to take.
  const step = Math.min(0.05, (now - p.last) / 1000) / FADE_S
  p.last = now
  const lit = new Set(lamps)
  for (const lamp of p.shade.keys()) if (!lit.has(lamp) || !lamp.castShadow) p.shade.delete(lamp)
  const wanted = lamps
    .filter(lamp => !lamp.userData.through && rank(lamp) > 0.001)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, p.budget)
  const keep = new Set(wanted)
  // A lamp that asked for its shadow itself, as it came on.
  for (const lamp of lamps) {
    if (!lamp.castShadow || p.shade.has(lamp)) continue
    if (p.shade.size < p.budget) p.shade.set(lamp, { level: 1, goal: 1 })
    else lamp.castShadow = false
  }
  let moving = false
  for (const [lamp, s] of p.shade) {
    s.goal = keep.has(lamp) ? 1 : 0
    // A shadow that has arrived stays put. Nudged down and back up, it kept
    // the frames coming for as long as a lamp was on.
    if (s.goal > s.level) s.level = Math.min(1, s.level + step)
    else if (s.goal < s.level) s.level = Math.max(0, s.level - step)
    if (s.goal === 0 && s.level === 0) {
      lamp.castShadow = false
      p.shade.delete(lamp)
    } else {
      lamp.shadow.intensity = ease(s.level)
      if (s.level !== s.goal) moving = true
    }
  }
  // The shadows that were let go of are taken up by the lamps waiting.
  for (const lamp of wanted) {
    if (p.shade.size >= p.budget) break
    if (p.shade.has(lamp)) continue
    lamp.castShadow = true
    lamp.shadow.intensity = 0
    p.shade.set(lamp, { level: 0, goal: 1 })
    moving = true
  }
  return moving
}

// Tops the lights up to their step. Called before every draw, ahead of
// three counting the lights, and before shaders are built ahead. Only the
// draw, `live`, moves the shadows from lamp to lamp. Building ahead only
// keeps the count of shadows to the budget, by leaving out a lamp that
// asked for one when there is none to spare, and says nothing.
export function balance(scene: Scene, live = false) {
  const p = of(scene)
  const on = collect(scene, p.group, false, { point: [], area: [] })
  let moving = false
  if (live) moving = hand(p, on.point)
  else {
    let free = p.budget - on.point.filter(lamp => lamp.castShadow && p.shade.has(lamp)).length
    for (const lamp of on.point) {
      if (!lamp.castShadow || p.shade.has(lamp)) continue
      if (free > 0) free--
      else lamp.castShadow = false
    }
  }
  const real = Math.min(on.point.filter(lamp => lamp.castShadow).length, p.budget)
  p.level.point = on.point.length === 0 ? 0 : up(on.point.length, POINT_STEP) + p.budget
  p.level.area = up(on.area.length, AREA_STEP)
  const point = p.level.point + p.extra.point
  const casting = point === 0 ? 0 : p.budget - real
  fit(p, p.casting, casting, () => pointPad(true))
  fit(p, p.plain, Math.max(0, point - on.point.length - casting), () => pointPad(false))
  fit(p, p.area, p.level.area + p.extra.area - on.area.length, () => new RectAreaLight('#000000', 0, 0.01, 0.01))
  return moving
}

export type Ahead = { key: string; apply: () => void; revert: () => void }

// A step next to the one the scene is at whose shaders are not built yet,
// if the home has the lamps to reach it: a step of lamps up or down, then a
// step of strips up or down. `apply` puts the scene on it and `revert` takes
// it back, and `key` names it, to tick it off once built.
export function ahead(scene: Scene, built: Set<string>): Ahead | null {
  const p = of(scene)
  const all = collect(scene, p.group, true, { point: [], area: [] })
  const on = collect(scene, p.group, false, { point: [], area: [] })
  const { point, area } = p.level
  built.add(`${point}|${area}`)
  const top = {
    point: all.point.length === 0 ? 0 : up(all.point.length, POINT_STEP) + p.budget,
    area: up(all.area.length, AREA_STEP),
  }
  const first = POINT_STEP + p.budget
  const tries: Counts[] = [
    { point: point === 0 ? first : point + POINT_STEP, area },
    { point: point === first ? 0 : point - POINT_STEP, area },
    { point, area: area + AREA_STEP },
    { point, area: area - AREA_STEP },
  ]
  for (const to of tries) {
    if (to.point < 0 || to.area < 0 || to.point > top.point || to.area > top.area) continue
    const key = `${to.point}|${to.area}`
    if (built.has(key)) continue
    // Up is extra dark lights. Down is the last few lit ones hidden for the
    // moment it takes to ask for the shaders, never for a frame.
    const extra = { point: Math.max(0, to.point - point), area: Math.max(0, to.area - area) }
    const hide: Object3D[] = []
    if (to.point < point) {
      const keep = to.point === 0 ? 0 : to.point - p.budget
      hide.push(...on.point.slice(keep))
    }
    if (to.area < area) hide.push(...on.area.slice(to.area))
    return {
      key,
      apply: () => {
        p.extra = extra
        for (const light of hide) light.visible = false
      },
      revert: () => {
        p.extra = { point: 0, area: 0 }
        for (const light of hide) light.visible = true
      },
    }
  }
  return null
}
