import type { HomeAssistant } from '#/types.ts'

// The domains a decoration item can stand in for. Anything else is left out
// of the picker: it has nothing a model could show.
const PLACEABLE_DOMAINS = [
  'light',
  'switch',
  'cover',
  'media_player',
  'fan',
  'climate',
  'humidifier',
  'lock',
  'camera',
  'vacuum',
  'sensor',
  'binary_sensor',
  'button',
  'input_button',
]

// Sensors are noisy. Only these device classes are offered.
const SENSOR_CLASSES: Record<string, string[]> = {
  sensor: ['temperature', 'humidity'],
  binary_sensor: ['door', 'window', 'opening', 'motion', 'occupancy'],
}

export const domainOf = (entityId: string) => entityId.split('.')[0]

export type EntityInfo = {
  entity_id: string
  name: string
  domain: string
  // Area the entity belongs to in Home Assistant, directly or through its device.
  area_id: string | null
}

export function entityName(hass: HomeAssistant, entityId: string) {
  const state = hass.states[entityId]
  const friendly = state?.attributes.friendly_name
  if (typeof friendly === 'string' && friendly) return friendly
  return hass.entities?.[entityId]?.name ?? entityId
}

// Whether Home Assistant still has the entity. Only answered once it has
// sent its lists: before that every entity looks missing. One that is only
// unavailable, a device that is off or out of reach, is still there.
export function entityGone(hass: HomeAssistant, entityId: string) {
  const loaded = Object.keys(hass.entities ?? {}).length > 0 && Object.keys(hass.states).length > 0
  return loaded && !hass.entities?.[entityId] && !hass.states[entityId]
}

export function entityArea(hass: HomeAssistant, entityId: string): string | null {
  const entry = hass.entities?.[entityId]
  if (!entry) return null
  return entry.area_id ?? (entry.device_id ? (hass.devices?.[entry.device_id]?.area_id ?? null) : null)
}

// Every entity a decoration item can be bound to, from the entity registry.
// Areas are not required: Home Assistant does not force one on anything.
export function placeableEntities(hass: HomeAssistant): EntityInfo[] {
  const out: EntityInfo[] = []
  for (const entry of Object.values(hass.entities ?? {})) {
    if (entry.hidden || entry.entity_category) continue
    const domain = domainOf(entry.entity_id)
    if (!PLACEABLE_DOMAINS.includes(domain)) continue
    const classes = SENSOR_CLASSES[domain]
    if (classes) {
      const deviceClass = hass.states[entry.entity_id]?.attributes.device_class
      if (typeof deviceClass !== 'string' || !classes.includes(deviceClass)) continue
    }
    out.push({
      entity_id: entry.entity_id,
      name: entityName(hass, entry.entity_id),
      domain,
      area_id: entityArea(hass, entry.entity_id),
    })
  }
  return out.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
}
