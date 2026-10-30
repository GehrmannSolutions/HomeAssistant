// Check a dashboard config against the card's own wall builder (HESTIA, local tool):
// node hestia/check_walls.ts <dashboard.json> [view path ...]
// For each view: the wall blocks src/geometry/walls.ts builds, their heights, and for every door and window
// whether it really opens a wall (the blocks change when it is left out) - an opening too far from any wall line
// would silently stay closed in the card.
import { readFileSync } from 'node:fs'
import { decorationKind, paramValue } from '#/decoration/catalog.ts'
import { wallsOf, WALL_FOOT_M, type Opening, type WallBlock } from '#/geometry/walls.ts'
import type { CardConfig } from '#/types.ts'

const DOORS = new Set(['door', 'sliding_door', 'garage_door'])

// as src/scene/Walls.tsx openingsOf
function openingsOf(config: CardConfig): (Opening & { id: string })[] {
  return (config.decorations ?? []).flatMap(item => {
    if (!DOORS.has(item.kind) && item.kind !== 'window') return []
    const kind = decorationKind(item.kind)
    if (!kind) return []
    const value = (id: string) => paramValue(kind, item.params, id, item.variant)
    const bottom = item.kind === 'window' ? value('sill') : 0
    return [{ id: item.id, at: item.position, width: value('width'), bottom, top: bottom + value('height') }]
  })
}

const area = (c: [number, number][]) => {
  let a = 0
  for (let i = 0; i < c.length; i++) a += c[i][0] * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * c[i][1]
  return Math.abs(a / 2)
}
const signature = (blocks: WallBlock[]) =>
  blocks.map(b => `${b.corners.map(p => p.map(v => v.toFixed(3)).join(',')).join(';')}|${b.bottom.toFixed(3)}|${b.top.toFixed(3)}`).sort().join('\n')

const [file, ...paths] = process.argv.slice(2)
const dashboard = JSON.parse(readFileSync(file, 'utf8'))
for (const view of dashboard.views) {
  if (paths.length && !paths.includes(view.path)) continue
  const card: CardConfig = view.cards[0]
  if (!card.walls) continue
  const openings = openingsOf(card)
  const blocks = wallsOf(card.rooms ?? [], card.walls, openings)
  const foot = blocks.filter(b => Math.abs(b.bottom - WALL_FOOT_M) < 1e-6)
  const tops = [...new Set(blocks.map(b => b.top.toFixed(3)))].sort()
  const outer = foot.filter(b => b.rooms.length === 1).length
  console.log(
    `${view.path}: ${blocks.length} wall blocks (${foot.length} at the floor, ${outer} of them outer), footprint ${foot
      .reduce((s, b) => s + area(b.corners), 0)
      .toFixed(2)} m2, tops ${tops.join(' / ')} m, ${openings.length} doors/windows`,
  )
  const full = signature(blocks)
  const shut: string[] = []
  for (const o of openings) {
    const without = wallsOf(card.rooms ?? [], card.walls, openings.filter(x => x !== o))
    if (signature(without) === full) shut.push(`${o.id} at ${o.at.map(v => v.toFixed(2)).join(',')}`)
  }
  console.log(`  openings that cut no wall: ${shut.length ? shut.join('; ') : 'none'}`)
  const sizes = openings.map(o => `${o.id.replace(/^[a-z]+_/, '')} ${o.width.toFixed(2)}x${(o.top - o.bottom).toFixed(2)}@${o.bottom.toFixed(2)}`)
  console.log(`  as the card reads them: ${sizes.join(', ')}`)
}
