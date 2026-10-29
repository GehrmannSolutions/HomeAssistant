// Writes demoflat.yaml, the demo flat from scripts/demoflat.plan.ts as a
// complete card config, and ha-demo/config/diorama.yaml, the dashboard
// that shows it in ha-demo bound to the entities of Home Assistant's Demo
// integration. Run it with `pnpm demoflat` after changing the plan.
import { DEMO_FLAT, HA_DEMO_IDS } from './demoflat.plan.ts'
import { writeFileSync } from 'node:fs'

// Home Assistant reads YAML 1.1, where words like on and off are booleans,
// so those are quoted wherever they stand, as keys or as values.
const boolish = /^(y|n|yes|no|on|off|true|false)$/i
const bare = (s: string) => /^[A-Za-z][A-Za-z0-9_ .:&-]*$/.test(s) && !boolish.test(s)
const scalar = (v: unknown) => (typeof v === 'string' ? (bare(v) ? v : JSON.stringify(v)) : String(v))
const key = (k: string) => (boolish.test(k) ? JSON.stringify(k) : k)
const flat = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'number')

function lines(value: unknown, indent: string): string[] {
  const out: string[] = []
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (flat(entry)) out.push(`${indent}- [${(entry as number[]).join(', ')}]`)
      else if (typeof entry !== 'object' || entry === null) out.push(`${indent}- ${scalar(entry)}`)
      else {
        const inner = lines(entry, indent + '  ')
        out.push(`${indent}- ${inner[0].trimStart()}`, ...inner.slice(1))
      }
    }
    return out
  }
  for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    if (flat(v)) out.push(`${indent}${key(name)}: [${(v as number[]).join(', ')}]`)
    else if (typeof v === 'object' && v !== null) out.push(`${indent}${key(name)}:`, ...lines(v, indent + '  '))
    else out.push(`${indent}${key(name)}: ${scalar(v)}`)
  }
  return out
}

const { type, ...rest } = DEMO_FLAT
const yaml = [...lines({ type, grid_options: { columns: 'full' }, ...rest }, ''), '']
writeFileSync(new URL('../demoflat.yaml', import.meta.url), yaml.join('\n'))

// Every made up entity id in the plan swapped for its Demo integration one.
const bound = JSON.parse(JSON.stringify(DEMO_FLAT), (_, v) =>
  typeof v === 'string' && v in HA_DEMO_IDS ? HA_DEMO_IDS[v] : v,
)
const view = { title: 'Home', path: 'home', type: 'panel', theme: 'Diorama Glass', cards: [bound] }
const dashboard = [
  '# Written by `pnpm demoflat` from scripts/demoflat.plan.ts. Do not edit by hand.',
  ...lines({ views: [view] }, ''),
  '',
]
writeFileSync(new URL('../ha-demo/config/diorama.yaml', import.meta.url), dashboard.join('\n'))
