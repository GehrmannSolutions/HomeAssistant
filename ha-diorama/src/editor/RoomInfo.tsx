import { Select } from '#/components/ui/select.tsx'
import { decorationKind } from '#/decoration/catalog.ts'
import { ResetButton, SelectedHeader, Slider, Switch } from '#/editor/panel.tsx'
import { neighboursOf } from '#/geometry/passages.ts'
import { EDITOR_TINT_COLOR, FLOOR_MATERIALS, ROOM_COLORS } from '#/theme.ts'
import type { Area, DecorationConfig, RoomConfig } from '#/types.ts'
import { useFlash } from '#/lib/flash.ts'
import { cn } from '#/lib/utils.ts'
import { colorWell, deleteButton, field, group, groupTitle, note, plainButton, row } from '#/editor/look.ts'
import { faCamera, faCheck, faDoorOpen, faEye, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

type Props = {
  room: RoomConfig
  rooms: RoomConfig[]
  areas: Area[]
  onRename: (id: string, name: string | undefined) => void
  onRenameDone: () => void
  onAssignArea: (roomId: string, areaId: string | undefined) => void
  onFloor: (roomId: string, floor: RoomConfig['floor']) => void
  // Every piece of the home, to tell which rooms beside this one a door
  // leads into.
  decorations: DecorationConfig[]
  // Shows or hides the sign on the floor into a room open beside this one.
  onArrow: (roomId: string, other: string, shown: boolean) => void
  // The room's view: saved from where the 3D view's camera stands now,
  // shown by flying the camera to it, or forgotten.
  onSaveCamera: (roomId: string) => void
  onShowCamera: (roomId: string) => void
  onClearCamera: (roomId: string) => void
  // Whether there is a 3D view to take the camera from.
  hasPreview: boolean
  onDelete: (roomId: string) => void
  onDeselect: () => void
}

const input = field
const cameraButton = plainButton

// The selected room: its name, the area it stands for, the floor under it,
// and the way to be rid of it.
export default function RoomInfo({
  room,
  rooms,
  areas,
  onRename,
  onRenameDone,
  onAssignArea,
  onFloor,
  decorations,
  onArrow,
  onSaveCamera,
  onShowCamera,
  onClearCamera,
  hasPreview,
  onDelete,
  onDeselect,
}: Props) {
  // The save button shows for a moment that the view was taken.
  const [saved, flashSaved] = useFlash()
  const accent = EDITOR_TINT_COLOR
  const index = rooms.findIndex(r => r.id === room.id)
  const sorted = [...areas].sort((a, b) => a.name.localeCompare(b.name))
  const used = new Map(rooms.filter(r => r.area_id).map(r => [r.area_id!, r.id]))
  const swatch = (
    <span
      className="ring-fill-strong size-3 shrink-0 rounded-full ring-2"
      style={{ background: room.color ?? ROOM_COLORS[(index < 0 ? 0 : index) % ROOM_COLORS.length] }}
    />
  )
  const neighbours = neighboursOf(room, rooms, decorations)
  // A setting of the floor put back to what the material comes with.
  const resetFloor = (key: 'color' | 'scale' | 'intensity' | 'rotation') => {
    if (!room.floor) return
    const { [key]: _, ...rest } = room.floor
    onFloor(room.id, rest)
  }
  const slider = (label: string, key: 'scale' | 'intensity' | 'rotation', min: number, max: number, step: number) => {
    const initial = key === 'rotation' ? 0 : 1
    const value = room.floor?.[key] ?? initial
    return (
      <label className={cn(row, 'grid-cols-[96px_1fr_56px_24px]')}>
        {label}
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onFloor(room.id, { ...room.floor!, [key]: Number(e.target.value) })}
        />
        <span className="text-label-2 text-right text-xs tabular-nums">
          {key === 'rotation' ? `${value}°` : `${value.toFixed(2)}x`}
        </span>
        <ResetButton label={label} changed={value !== initial} onReset={() => resetFloor(key)} />
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <SelectedHeader title={room.name ?? room.id} tag={swatch} onBack={onDeselect} />
      <div className={group}>
        <label className={cn(row, 'grid-cols-[96px_1fr]')}>
          Name
          <input
            className={input}
            value={room.name ?? ''}
            placeholder={room.id}
            onChange={e => onRename(room.id, e.target.value || undefined)}
            onBlur={onRenameDone}
          />
        </label>
        <label className={cn(row, 'grid-cols-[96px_1fr]')}>
          Area
          <Select
            aria-label="Area"
            value={room.area_id ?? ''}
            options={[
              { value: '', label: 'No area' },
              ...sorted.map(a => {
                const owner = used.get(a.area_id)
                const taken = owner !== undefined && owner !== room.id
                return { value: a.area_id, label: taken ? `${a.name} (used)` : a.name, disabled: taken }
              }),
            ]}
            onChange={v => onAssignArea(room.id, v || undefined)}
          />
        </label>
      </div>
      <div className={group}>
        <label className={cn(row, 'grid-cols-[96px_1fr_24px]')}>
          Floor
          <Select
            aria-label="Floor"
            value={room.floor?.material ?? ''}
            options={[
              { value: '', label: 'Room color' },
              ...Object.entries(FLOOR_MATERIALS).map(([id, m]) => ({ value: id, label: m.label })),
            ]}
            onChange={v => onFloor(room.id, v ? { ...room.floor, material: v } : undefined)}
          />
          <ResetButton label="Floor" changed={!!room.floor} onReset={() => onFloor(room.id, undefined)} />
        </label>
        {room.floor && (
          <>
            <label className={cn(row, 'grid-cols-[96px_1fr_24px]')}>
              Tint
              <input
                type="color"
                className={colorWell}
                value={room.floor.color ?? FLOOR_MATERIALS[room.floor.material]?.color ?? '#ffffff'}
                onChange={e => onFloor(room.id, { ...room.floor!, color: e.target.value })}
              />
              <ResetButton label="Tint" changed={room.floor.color !== undefined} onReset={() => resetFloor('color')} />
            </label>
            {slider('Pattern size', 'scale', 0.25, 4, 0.05)}
            {slider('Pattern depth', 'intensity', 0, 2, 0.05)}
            {slider('Pattern angle', 'rotation', 0, 175, 5)}
          </>
        )}
      </div>
      <div className={group}>
        <div className={cn(row, 'grid-cols-[96px_1fr]')}>
          Camera
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              disabled={!hasPreview}
              title={hasPreview ? "Save where the 3D view stands now as this room's view" : 'Open the 3D view first'}
              onClick={() => {
                onSaveCamera(room.id)
                flashSaved()
              }}
              className={cn(cameraButton, 'min-w-0 flex-1 px-2', saved && 'text-success')}
            >
              <FontAwesomeIcon icon={saved ? faCheck : faCamera} className="size-3.5" />
              <span className="truncate">
                {saved ? 'View saved' : room.camera ? 'Replace view' : 'Use current view'}
              </span>
            </button>
            <button
              type="button"
              disabled={!hasPreview}
              aria-label="Fly to this room's view"
              title="Fly to this room's view"
              onClick={() => onShowCamera(room.id)}
              className={cn(cameraButton, 'size-8 shrink-0 px-0')}
            >
              <FontAwesomeIcon icon={faEye} className="size-3.5" />
            </button>
            {room.camera && (
              <button
                type="button"
                aria-label="Go back to the view the room comes with"
                title="Go back to the view the room comes with"
                onClick={() => onClearCamera(room.id)}
                className={cn(cameraButton, 'size-8 shrink-0 px-0')}
              >
                <FontAwesomeIcon icon={faXmark} className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className={note}>
          {room.camera
            ? 'Clicking this room in the card flies the camera to this view and fades the rest of the home away.'
            : 'Clicking this room in the card flies the camera to it and fades the rest of the home away. Orbit the 3D view to where the room looks best and save it to choose the view yourself.'}
        </p>
      </div>
      {neighbours.length > 0 && (
        <div className={group}>
          <p className={groupTitle}>Rooms beside it</p>
          {neighbours.map(neighbour => {
            const other = rooms.find(r => r.id === neighbour.id)
            const name = other?.name ?? neighbour.id
            return (
              <div key={neighbour.id} className={cn(row, 'min-h-6 grid-cols-[1fr_auto]')}>
                <span className="truncate">{name}</span>
                <span className="flex items-center gap-3">
                  {neighbour.door && (
                    <span className="text-label-2 flex items-center gap-1.5 text-xs">
                      <FontAwesomeIcon icon={faDoorOpen} className="size-3" />
                      {decorationKind(neighbour.door)?.label ?? 'Door'}
                    </span>
                  )}
                  <Switch
                    checked={!room.hide_arrows?.includes(neighbour.id)}
                    accent={accent}
                    label={`Show an arrow into ${name}`}
                    onChange={shown => onArrow(room.id, neighbour.id, shown)}
                  />
                </span>
              </div>
            )
          })}
          <p className={note}>
            In this room's view a click on a door flies to the room behind it. Each room beside it also gets an arrow on
            the floor that does the same, past the door or the open stretch between them, unless it is switched off
            here.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete ${room.name ?? room.id}?`)) onDelete(room.id)
        }}
        className={deleteButton}
      >
        <FontAwesomeIcon icon={faTrash} className="size-3.5" />
        Delete room
      </button>
    </div>
  )
}
