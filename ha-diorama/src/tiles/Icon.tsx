import { cn } from '#/lib/utils.ts'
import { PHOSPHOR_ICONS, phosphor } from '#/tiles/icons.ts'
import { useEffect, useState } from 'react'

const warned = new Set<string>()

// Longer than the slowest fade from one icon to the next in tiles.css, to
// clear the old one should its fade never end, as with reduced motion.
const FADE_MS = 1500

type Props = { icon: string; on?: boolean; className?: string }
type Drawn = { icon: string; on: boolean }

const same = (a: Drawn, b: Drawn) => a.icon === b.icon && (a.on === b.on || !a.icon.startsWith('ph:'))

// An icon written as `ph:<name>` is drawn from the bundled Phosphor set.
// Anything else, like `mdi:lightbulb`, goes to Home Assistant's own icon
// element, which knows every icon Home Assistant does. When it changes,
// to another icon or to filled, the old one fades out as the new one fades
// in over it, so there is always an icon.
export function Icon({ icon, on = false, className }: Props) {
  const [shown, setShown] = useState<Drawn>({ icon, on })
  const [old, setOld] = useState<Drawn | null>(null)
  if (!same(shown, { icon, on })) {
    setOld(shown)
    setShown({ icon, on })
  }
  useEffect(() => {
    if (!old) return
    const timer = setTimeout(() => setOld(null), FADE_MS)
    return () => clearTimeout(timer)
  }, [old])
  return (
    <span
      aria-hidden
      className={cn('dio-icon', className)}
      onAnimationEnd={event => {
        if (event.target instanceof HTMLElement && event.target.dataset.out !== undefined) setOld(null)
      }}
    >
      {old && <Layer key={`${old.icon}:${old.on}:out`} drawn={old} out />}
      <Layer key={`${shown.icon}:${shown.on}`} drawn={shown} fresh={!!old} />
    </span>
  )
}

function Layer({ drawn, out, fresh }: { drawn: Drawn; out?: boolean; fresh?: boolean }) {
  const flags = { 'data-out': out || undefined, 'data-in': fresh || undefined }
  if (!drawn.icon.startsWith('ph:')) return <ha-icon className="dio-icon-layer" icon={drawn.icon} {...flags} />
  const name = drawn.icon.slice(3)
  let svg = phosphor(name, drawn.on)
  if (!svg) {
    if (!warned.has(name)) {
      warned.add(name)
      console.warn(`Diorama tiles: ph:${name} is not one of the bundled icons: ${PHOSPHOR_ICONS.join(', ')}`)
    }
    svg = phosphor('question', drawn.on)
  }
  return <span className="dio-icon-layer" {...flags} dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
}
