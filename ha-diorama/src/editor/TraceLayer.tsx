import { EDITOR_HANDLE_PX } from '#/constants.ts'
import type { Trace } from '#/editor/trace.ts'
import { toScreen, type View } from '#/editor/view.ts'
import { EDITOR_ACCENT_COLOR } from '#/theme.ts'
import { useId } from 'react'

function box(trace: Trace, view: View) {
  const [cx, cy] = toScreen(view, trace.center)
  const w = trace.width * view.scale
  const h = w * trace.aspect
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

// The picture itself, drawn under the rooms.
export function TraceImage({ trace, view }: { trace: Trace; view: View }) {
  const { x, y, w, h } = box(trace, view)
  const id = useId()
  const mode = trace.mode ?? 'picture'
  if (mode === 'picture')
    return (
      <image
        href={trace.src}
        x={x}
        y={y}
        width={w}
        height={h}
        opacity={trace.opacity}
        preserveAspectRatio="none"
        className="pointer-events-none"
      />
    )
  // Only the lines: the picture is the mask of a sheet in the color of the
  // text, so the lines read on a light theme and on a dark one alike, and
  // the paper lets the grid through. A mask shows where it is bright, so
  // dark lines are turned bright first.
  return (
    <g className="pointer-events-none" opacity={trace.opacity}>
      <defs>
        <filter id={`${id}-invert`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
        </filter>
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={x} y={y} width={w} height={h}>
          <image
            href={trace.src}
            x={x}
            y={y}
            width={w}
            height={h}
            preserveAspectRatio="none"
            filter={mode === 'dark-lines' ? `url(#${id}-invert)` : undefined}
          />
        </mask>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill="var(--primary-text-color)" mask={`url(#${id}-mask)`} />
    </g>
  )
}

// The frame around the picture while it is selected. The outline takes no
// press, so everything drawn over the picture is still reached first. Only
// the corners do, and dragging one sizes the picture around its middle.
export function TraceFrame({
  trace,
  view,
  onCornerDown,
}: {
  trace: Trace
  view: View
  onCornerDown: (e: React.PointerEvent) => void
}) {
  const { x, y, w, h } = box(trace, view)
  const corners: [number, number, string][] = [
    [x, y, 'cursor-nwse-resize'],
    [x + w, y, 'cursor-nesw-resize'],
    [x + w, y + h, 'cursor-nwse-resize'],
    [x, y + h, 'cursor-nesw-resize'],
  ]
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke={EDITOR_ACCENT_COLOR}
        strokeWidth={2}
        strokeDasharray="6 4"
        className="pointer-events-none"
      />
      {corners.map(([cx, cy, cursor], i) => (
        <rect
          key={i}
          x={cx - EDITOR_HANDLE_PX}
          y={cy - EDITOR_HANDLE_PX}
          width={EDITOR_HANDLE_PX * 2}
          height={EDITOR_HANDLE_PX * 2}
          rx={3}
          fill="var(--card-background-color)"
          stroke={EDITOR_ACCENT_COLOR}
          strokeWidth={2}
          className={cursor}
          onPointerDown={onCornerDown}
        />
      ))}
    </g>
  )
}
