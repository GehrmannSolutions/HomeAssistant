// The class lists the editor's pieces share, so a field, a group or a
// floating panel looks the same wherever it is.

// A text field, a native select or a select's trigger: a soft fill with no
// border, and a ring in the tint while it has the focus.
export const field =
  'h-8 min-w-0 rounded-lg border border-transparent bg-fill px-2.5 text-[13px] text-(--primary-text-color) transition-[background-color,box-shadow] placeholder:text-label-2 hover:bg-fill-strong focus:bg-fill focus:ring-3 focus:ring-tint/30'

// A color well, rounded, with a hairline round it so a dark color still
// shows against the panel.
export const colorWell =
  'h-8 w-full cursor-pointer rounded-lg border-0 bg-transparent p-0 outline-1 outline-solid -outline-offset-1 outline-(--divider-color) [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0'

// A block of related settings in the sidebar, set off by a fill.
export const group = 'flex flex-col gap-2.5 rounded-xl bg-fill p-3'

// The small title over a group.
export const groupTitle = 'px-0.5 text-[11px] font-semibold tracking-wide text-label-2 uppercase'

// A row of a form: the name on the left, the control after it.
export const row = 'grid items-center gap-2 text-[13px]'

// The note under a control, saying what it does.
export const note = 'text-xs leading-snug text-label-2'

// A button with a soft fill, for the actions next to a field.
export const plainButton =
  'flex h-8 items-center justify-center gap-1.5 rounded-lg bg-fill-strong px-3 text-[13px] font-medium text-(--primary-text-color) transition-colors hover:bg-fill-stronger active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40'

// An icon alone, with a fill only under the pointer.
export const iconButton =
  'flex items-center justify-center rounded-lg text-(--primary-text-color) transition-colors hover:bg-fill-strong active:bg-fill-stronger disabled:pointer-events-none disabled:opacity-35'

// The destructive action at the end of a sidebar.
export const deleteButton =
  'flex h-9 items-center justify-center gap-2 rounded-xl bg-danger/10 text-[13px] font-semibold text-danger transition-colors hover:bg-danger/16 active:bg-danger/22'

// Anything that floats over the editor: tips, popovers, menus and dialogs.
// Frosted, so what is under it shows through, with a soft deep shadow.
export const floating =
  'dio-floating rounded-xl border border-separator bg-(--card-background-color)/80 shadow-[0_12px_40px_-10px_rgba(0,0,0,0.4),0_2px_8px_-2px_rgba(0,0,0,0.12)] backdrop-blur-2xl backdrop-saturate-150'

// A key to press, in a tip.
export const kbd =
  'min-w-5 rounded-md bg-fill-strong px-1.5 py-px text-center font-system text-[11px] font-medium text-label-2'
