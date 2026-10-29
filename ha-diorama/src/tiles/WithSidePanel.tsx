import { SIDE_PANEL, type SidePanel } from '#/tiles/sidePanel.ts'
import type { CardConfig, HomeAssistant } from '#/types.ts'
import { useEffect, useRef } from 'react'

// The side panel's layout, which draws the diorama again inside it.
export default function WithSidePanel({ hass, config }: { hass: HomeAssistant | null; config: CardConfig }) {
  const holder = useRef<HTMLDivElement>(null)
  const panel = useRef<SidePanel | null>(null)
  useEffect(() => {
    const element = document.createElement(SIDE_PANEL) as SidePanel
    panel.current = element
    holder.current!.replaceChildren(element)
    return () => {
      element.remove()
      panel.current = null
    }
  }, [])
  useEffect(() => {
    panel.current?.setConfig(config)
  }, [config])
  useEffect(() => {
    if (hass && panel.current) panel.current.hass = hass
  }, [hass])
  // As tall as the card is given, so the panel can fit in it.
  return <div ref={holder} style={{ height: '100%' }} />
}
