import type { HomeAssistant } from '#/types.ts'

export type TitleConfig = { type: string; title?: string; area?: string }

type Props = { hass: HomeAssistant | null; config: TitleConfig; area: string | null }

// A section heading, larger than Home Assistant's own, that hides with the
// room filter like the tiles under it.
export default function Title({ hass, config, area }: Props) {
  const text = config.title ?? (area ? hass?.areas[area]?.name : undefined) ?? ''
  return (
    <div className="dio-title" role="heading" aria-level={2}>
      <span className="truncate">{text}</span>
    </div>
  )
}
