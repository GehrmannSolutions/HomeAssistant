// Saving the card from inside Home Assistant's own card dialog.
//
// The card's editor lives in HA's "Edit card" dialog, and a config-changed
// event only updates what that dialog holds in memory. It reaches the
// dashboard when the dialog's Save is pressed. So Save & Close in the
// fullscreen editor looked like it saved, but closing HA's dialog after it,
// to leave visibility and layout alone, threw the whole edit away.
//
// The dialog is handed a saveCardConfig function by whatever opened it, and
// its own Save calls exactly that and nothing else. Calling it from here
// saves through HA's own path, so the dashboard it holds in memory is
// updated too and nothing later writes an older copy over it. Then the
// dialog's dirty baseline is reset to what was saved, so closing it does
// not ask about unsaved changes and its Save has nothing left to do. The
// dialog itself stays open, for visibility and layout.
//
// With nothing left to save the dialog greys its Save out, which left only
// Cancel to get out by, and Cancel reads as throwing the edit away. Its Save
// with nothing to save only closes the dialog, so the button is switched
// back on once the dialog has drawn itself clean, and a press on it leaves.
// The dialog greys it out by itself again after the next edit is saved, and
// it is switched on again then.
//
// This reaches into the dialog's internals. Anything that is not there, on
// an older or a newer Home Assistant, falls back to the old behaviour rather
// than guessing.

type EditCardDialog = HTMLElement & {
  _params?: {
    saveCardConfig?: (config: unknown) => unknown
    isNew?: boolean
  }
  _cardConfig?: unknown
  _markDirtyStateClean?: () => void
  updateComplete?: Promise<unknown>
}

// Switches the dialog's Save back on once the dialog has drawn itself with
// nothing to save.
async function enableSave(dialog: EditCardDialog) {
  await dialog.updateComplete
  const button = dialog.shadowRoot?.querySelector<HTMLElement & { disabled?: boolean }>(
    'ha-button[slot="primaryAction"]',
  )
  if (!button) return
  button.removeAttribute('disabled')
  button.disabled = false
}

// The nearest Edit card dialog above an element, across shadow roots.
function dialogAbove(start: Node): EditCardDialog | null {
  let node: Node | null = start
  while (node) {
    if (node instanceof HTMLElement && node.localName === 'hui-dialog-edit-card') return node as EditCardDialog
    node = node instanceof ShadowRoot ? node.host : node.parentNode
  }
  return null
}

// A toast in Home Assistant's own style, the same one its Save shows.
function toast(from: HTMLElement, message: string) {
  from.dispatchEvent(new CustomEvent('hass-notification', { detail: { message }, bubbles: true, composed: true }))
}

// Saved through the dialog, or nothing to save through, in which case the
// edits stay where they always did: in the dialog, waiting for its Save.
export type SaveResult = 'saved' | 'unsupported'

export async function persistCard(host: HTMLElement): Promise<SaveResult> {
  const dialog = dialogAbove(host)
  const save = dialog?._params?.saveCardConfig
  if (!dialog || typeof save !== 'function') return 'unsupported'
  // A card still being added is not saved from here. Its callback may hand
  // the card to whatever is picking it, a stack or a section, and calling
  // that a second time could add it twice. HA's own Save does it once.
  if (dialog._params?.isNew) return 'unsupported'
  // What the dialog holds, not this card's own config: when the diorama
  // sits inside a stack the dialog is the stack's, and saving the diorama
  // alone in its place would replace the whole stack with it. Every edit has
  // already reached the dialog by now, since each one is sent as it is made.
  const config = dialog._cardConfig
  if (!config) return 'unsupported'
  try {
    await save.call(dialog._params, config)
  } catch (err) {
    toast(host, err instanceof Error ? err.message : 'The card could not be saved')
    throw err
  }
  if (dialog._markDirtyStateClean) {
    dialog._markDirtyStateClean()
    void enableSave(dialog)
  }
  toast(host, 'Saved')
  return 'saved'
}
