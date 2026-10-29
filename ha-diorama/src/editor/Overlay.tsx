import styles from '#/index.css?inline'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { holdEditorOpen } from '#/lib/editorOpen.ts'

function createHost() {
  // A modal dialog lives in the browser's top layer, above anything HA stacks
  // with z-index and above dialogs HA opened earlier.
  const dialog = document.createElement('dialog')
  Object.assign(dialog.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    maxWidth: 'none',
    maxHeight: 'none',
    margin: '0',
    padding: '0',
    border: 'none',
    background: 'transparent',
    overflow: 'hidden',
  })
  // Escape is handled by the editor itself, not by closing the dialog.
  dialog.addEventListener('cancel', e => e.preventDefault())
  // HA closes its own dialog on clicks it sees as outside. Nothing that
  // happens in here concerns it, so stop events at the boundary. React's own
  // handlers sit inside the dialog and have already run by then.
  // The editor has its own right click menus.
  dialog.addEventListener('contextmenu', e => e.preventDefault())
  const isolated = [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'touchstart',
    'touchend',
    'keydown',
    'keyup',
  ]
  for (const type of isolated) {
    dialog.addEventListener(type, e => {
      e.stopPropagation()
      // Three's OrbitControls waits for the pointer release on the document.
      // Hand it a copy straight on the document, which never reaches HA's
      // dialog, when the release belongs to a canvas.
      if (type === 'pointerup' && e.composedPath().some(n => n instanceof HTMLCanvasElement)) {
        document.dispatchEvent(new PointerEvent('pointerup', e as PointerEvent))
      }
    })
  }
  dialog.addEventListener('pointercancel', e => {
    e.stopPropagation()
    if (e.composedPath().some(n => n instanceof HTMLCanvasElement)) {
      document.dispatchEvent(new PointerEvent('pointercancel', e as PointerEvent))
    }
  })
  const host = document.createElement('div')
  host.style.height = '100%'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)
  const mount = document.createElement('div')
  mount.style.height = '100%'
  shadow.appendChild(mount)
  dialog.appendChild(host)
  return { dialog, mount }
}

// Renders children fullscreen in the top layer, outside the HA dialog, so no
// ancestor can clip, scale or cover the editor.
export default function Overlay({ children }: { children: ReactNode }) {
  const [{ dialog, mount }] = useState(createHost)

  useLayoutEffect(() => {
    document.body.appendChild(dialog)
    // Older Home Assistant opens its dialogs with a polyfill that marks
    // everything else on the page inert, even elements added after it, which
    // left the editor unable to take a single click. Nothing should.
    const live = new MutationObserver(() => {
      if (dialog.inert) dialog.inert = false
    })
    live.observe(dialog, { attributes: true, attributeFilter: ['inert'] })
    dialog.showModal()
    // The cards under it stop drawing while it covers them.
    const release = holdEditorOpen()
    return () => {
      release()
      live.disconnect()
      dialog.close()
      dialog.remove()
    }
  }, [dialog])

  return createPortal(children, mount)
}
