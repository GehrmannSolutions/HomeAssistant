import { cn } from '#/lib/utils.ts'
import { callService, formatState, type TileEnv } from '#/tiles/actions.ts'
import { Control } from '#/tiles/Control.tsx'
import { Keypad } from '#/tiles/features/Keypad.tsx'
import { alarmModes, codeFormat, needsCode, type AlarmMode } from '#/tiles/features/other.tsx'
import { Group } from '#/tiles/features/parts.tsx'
import type { TileConfig } from '#/tiles/host.tsx'
import { Panel } from '#/tiles/Panel.tsx'
import { useEffect, useState, type CSSProperties } from 'react'

type Props = { env: TileEnv; config: TileConfig }

// How long a picked mode waits for its code before it lets go.
const PICK_MS = 15000

// The states an alarm passes through on its way to another, in amber.
const MOVING = ['arming', 'pending', 'disarming']

// The whole alarm on one wide tile: the name and what it is doing in the
// bottom left corner like every tile, a round button for each mode it has
// in the top right like a thermostat's, and for one with a code a keypad
// across from the name, with the code large on the left over it.
// Disarmed, a press on a mode that needs no code sets it, and one that
// does takes the fill, pulsing, and wakes the keypad for the code, until
// it waits too long. Armed, the only thing left is the code that disarms
// it, so the modes are off. With a code there is no disarm button, since
// the code is it. Delete sits left of the zero and the key that sends the
// code right of it, a red lock to arm or a green open lock to disarm.
// Lit while it is not disarmed, with red washing in from the left, or
// amber on its way. Disarmed it stays glass, with a green wash and icon.
export default function AlarmPanel({ env, config }: Props) {
  const entity = env.hass.states[config.entity!]
  const [picked, setPicked] = useState<AlarmMode | null>(null)
  const [code, setCode] = useState('')
  // A mode picked is let go of once the panel changes.
  const [seen, setSeen] = useState(entity?.state)
  if (seen !== entity?.state) {
    setSeen(entity?.state)
    setPicked(null)
  }
  useEffect(() => {
    if (!picked) return
    const timer = setTimeout(() => {
      setPicked(null)
      setCode('')
    }, PICK_MS)
    return () => clearTimeout(timer)
  }, [picked, code])
  if (!entity) return <Panel env={env} config={config} entity={entity} state="" />
  const modes = alarmModes(entity)
  const coded = entity.attributes.code_format === 'number' || entity.attributes.code_format === 'text'
  const armed = entity.state !== 'disarmed'
  const target = picked ?? (armed ? (modes.find(mode => mode.state === 'disarmed') ?? null) : null)
  const accent = !armed
    ? 'var(--_alarm-disarmed)'
    : MOVING.includes(entity.state)
      ? 'var(--_accent-climate)'
      : 'var(--_alarm-armed)'
  const set = (mode: AlarmMode, typed?: string) => {
    void callService(env.hass, `alarm_control_panel.${mode.service}`, {
      entity_id: entity.entity_id,
      ...(typed && { code: typed }),
    })
    setPicked(null)
    setCode('')
  }
  const press = (mode: AlarmMode) => {
    if (entity.state === mode.state) return setPicked(null)
    if (!needsCode(entity, mode)) return set(mode)
    setPicked(mode)
    setCode('')
  }
  // Armed, a mode is pressed only to disarm one with no code.
  const off = (mode: AlarmMode) => armed && mode.state !== 'disarmed'
  // Said large on the left until a digit is in, so it is clear what the
  // code will do.
  const hint = !target
    ? 'Tap a mode to arm'
    : target.state === 'disarmed'
      ? 'Enter code to disarm'
      : `Enter code to arm ${target.label}`
  return (
    <Panel
      env={env}
      config={config}
      entity={entity}
      active={armed}
      accent={accent}
      glow={accent}
      glowFrom="left"
      tint={armed ? undefined : accent}
      state={formatState(env.hass, entity)}
      className="dio-alarm"
      controls={
        <Group label="Mode" radio>
          {modes
            .filter(mode => !coded || mode.state !== 'disarmed')
            .map(mode => (
              <Control
                key={mode.state}
                icon={mode.icon}
                label={mode.label}
                role="radio"
                checked={(picked ?? entity).state === mode.state}
                disabled={off(mode) && entity.state !== mode.state}
                className={cn('dio-mode', picked?.state === mode.state && 'dio-mode-picked')}
                style={
                  { '--_mode-color': mode.bit ? 'var(--_alarm-armed)' : 'var(--_alarm-disarmed)' } as CSSProperties
                }
                onPress={() => press(mode)}
              />
            ))}
        </Group>
      }
    >
      {coded && (
        <Keypad
          compact
          format={codeFormat(entity)}
          code={code}
          onCode={setCode}
          hint={hint}
          ready={!!target}
          action={!target ? 'Tap a mode to arm' : target.state === 'disarmed' ? 'Disarm' : `Arm ${target.label}`}
          go={
            target
              ? target.state === 'disarmed'
                ? { icon: 'ph:lock-open', color: 'var(--_alarm-disarmed)' }
                : { icon: 'ph:lock', color: 'var(--_alarm-armed)' }
              : undefined
          }
          onSubmit={typed => target && set(target, typed)}
        />
      )}
    </Panel>
  )
}
