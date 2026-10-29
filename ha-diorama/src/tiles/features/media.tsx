import { callService } from '#/tiles/actions.ts'
import { Control } from '#/tiles/Control.tsx'
import {
  Group,
  listOf,
  MenuPill,
  numberOf,
  optionWord,
  Slider,
  supports,
  type FeatureProps,
} from '#/tiles/features/parts.tsx'

// The features of a speaker or a TV.

// The media player's supported_features bits.
export const MEDIA = {
  pause: 1,
  seek: 2,
  volumeSet: 4,
  volumeMute: 8,
  previous: 16,
  next: 32,
  turnOn: 128,
  turnOff: 256,
  volumeStep: 1024,
  source: 2048,
  stop: 4096,
  play: 16384,
  shuffle: 32768,
  soundMode: 65536,
  repeat: 262144,
}

const OFF = ['off', 'standby', 'unavailable', 'unknown']

const run =
  (props: FeatureProps, service: string, data: Record<string, unknown> = {}) =>
  () =>
    callService(props.env.hass, `media_player.${service}`, { entity_id: props.entity.entity_id, ...data })

// Previous, play or pause, next, and power for one that can be turned on
// and off. Only the buttons it supports.
export function Playback(props: FeatureProps) {
  const { entity } = props
  const playing = entity.state === 'playing'
  const off = OFF.includes(entity.state)
  const has = (bit: number) => supports(entity, bit)
  return (
    <Group label="Playback">
      {!off && has(MEDIA.previous) && (
        <Control icon="ph:skip-back" label="Previous" onPress={run(props, 'media_previous_track')} />
      )}
      {!off && has(playing ? MEDIA.pause : MEDIA.play) && (
        <Control
          icon={playing ? 'ph:pause' : 'ph:play'}
          label={playing ? 'Pause' : 'Play'}
          onPress={run(props, 'media_play_pause')}
        />
      )}
      {!off && !has(MEDIA.pause) && playing && has(MEDIA.stop) && (
        <Control icon="ph:stop" label="Stop" onPress={run(props, 'media_stop')} />
      )}
      {!off && has(MEDIA.next) && (
        <Control icon="ph:skip-forward" label="Next" onPress={run(props, 'media_next_track')} />
      )}
      {has(off ? MEDIA.turnOn : MEDIA.turnOff) && (
        <Control
          icon="ph:power-bold"
          label={off ? 'Turn on' : 'Turn off'}
          onPress={run(props, off ? 'turn_on' : 'turn_off')}
        />
      )}
    </Group>
  )
}

const volumeIcon = (level: number, muted: boolean) =>
  muted ? 'ph:speaker-x' : level === 0 ? 'ph:speaker-none' : level < 50 ? 'ph:speaker-low' : 'ph:speaker-high'

// How loud it plays, along a bar.
export function VolumeSlider(props: FeatureProps) {
  const { entity } = props
  const level = Math.round((numberOf(entity, 'volume_level') ?? 0) * 100)
  const muted = entity.attributes.is_volume_muted === true
  return (
    <Slider
      label="Volume"
      icon={volumeIcon(level, muted)}
      value={level}
      fill="var(--_volume-fill, var(--_accent-media))"
      ink="var(--_volume-ink)"
      format={v => `${v}%`}
      onChange={v =>
        callService(props.env.hass, 'media_player.volume_set', { entity_id: entity.entity_id, volume_level: v / 100 })
      }
    />
  )
}

// Mute, quieter and louder, for a player that steps its volume.
export function VolumeButtons(props: FeatureProps) {
  const { entity } = props
  const muted = entity.attributes.is_volume_muted === true
  return (
    <Group label="Volume">
      {supports(entity, MEDIA.volumeMute) && (
        <Control
          icon={muted ? 'ph:speaker-x' : 'ph:speaker-high'}
          label={muted ? 'Unmute' : 'Mute'}
          onPress={run(props, 'volume_mute', { is_volume_muted: !muted })}
        />
      )}
      <Control icon="ph:minus-bold" label="Quieter" onPress={run(props, 'volume_down')} />
      <Control icon="ph:plus-bold" label="Louder" onPress={run(props, 'volume_up')} />
    </Group>
  )
}

export function Source(props: FeatureProps) {
  const { entity } = props
  return (
    <MenuPill
      icon="ph:sliders-horizontal"
      label="Source"
      options={listOf(entity, 'source_list')}
      current={typeof entity.attributes.source === 'string' ? entity.attributes.source : null}
      word={option => optionWord(props.env.hass, entity, option, 'source')}
      onPick={option => run(props, 'select_source', { source: option })()}
    />
  )
}

export function SoundMode(props: FeatureProps) {
  const { entity } = props
  return (
    <MenuPill
      icon="ph:waveform"
      label="Sound"
      options={listOf(entity, 'sound_mode_list')}
      current={typeof entity.attributes.sound_mode === 'string' ? entity.attributes.sound_mode : null}
      word={option => optionWord(props.env.hass, entity, option, 'sound_mode')}
      onPick={option => run(props, 'select_sound_mode', { sound_mode: option })()}
    />
  )
}
