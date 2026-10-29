import fontsCss from '#/fonts.css?inline'
import styles from '#/index.css?inline'
import type { HomeAssistant } from '#/types.ts'
import { StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const FONTS_ID = 'diorama-fonts'
const PROPERTIES_ID = 'diorama-properties'

// Fonts must live in the document, not the shadow root, for @font-face to apply.
function injectFonts() {
  if (document.getElementById(FONTS_ID)) return
  const style = document.createElement('style')
  style.id = FONTS_ID
  style.textContent = fontsCss
  document.head.appendChild(style)
}

// Tailwind registers its variables with @property, which browsers only
// honor at document level, never inside a shadow root. Without them the
// border, shadow and ring utilities resolve to nothing. Register them once
// in the document, from these styles or another sheet's, like the tiles'.
export function injectProperties(css = styles, id = PROPERTIES_ID) {
  if (document.getElementById(id)) return
  const rules = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g)
  if (!rules) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
}

// Trees of cards Home Assistant has just thrown away, by a key the card
// gives, kept a while so a card built again in their place can take them
// over instead of building its own from nothing.
type Parked = { root: Root; mount: HTMLDivElement; config: unknown }
const parked = new Map<string, Parked[]>()

// Custom element that hosts a React tree in a shadow root with the card styles.
// HA detaches and re-attaches elements when a view re-renders, so everything
// that must happen exactly once lives in the constructor.
export abstract class ReactHost<Config> extends HTMLElement {
  private root: Root | null = null
  private mount: HTMLDivElement
  protected _hass: HomeAssistant | null = null
  protected _config: Config | null = null
  // Set while the element waits to see whether it has a tree to take over,
  // so it does not build one of its own in the meantime.
  protected held = false

  constructor() {
    super()
    injectFonts()
    injectProperties()
    const shadow = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = styles
    shadow.appendChild(style)
    this.mount = document.createElement('div')
    this.mount.style.height = '100%'
    shadow.appendChild(this.mount)
  }

  connectedCallback() {
    this.render()
  }

  // HA moves elements (disconnect and reconnect in the same task) but also
  // discards them, for example the preview card on every config change. Wait
  // a tick to tell the two apart, and only tear the React tree down when the
  // element is really gone, so WebGL contexts and render loops do not leak.
  disconnectedCallback() {
    setTimeout(() => {
      if (this.isConnected || !this.root) return
      this.root.unmount()
      this.root = null
    }, 0)
  }

  // Leaves this element's tree under `key` for the one that replaces it to
  // take over with `adopt`, and tears it down if none does within `keep`
  // milliseconds.
  protected park(key: string, keep = 0) {
    if (!this.root) return
    const handed = { root: this.root, mount: this.mount, config: this._config }
    parked.set(key, [...(parked.get(key) ?? []), handed])
    this.root = null
    setTimeout(() => {
      const left = parked.get(key)?.filter(tree => tree !== handed)
      if (left?.length === parked.get(key)?.length) return
      if (left?.length) parked.set(key, left)
      else parked.delete(key)
      handed.root.unmount()
    }, keep)
  }

  // Takes over a tree parked under `key`, its own first when it was only
  // moved, so React updates it to this element's config instead of building
  // a new one from nothing. Returns the config that tree was last drawn
  // with, or undefined when there was none to take.
  protected get mounted() {
    return !!this.root
  }

  protected adopt(key: string): Config | null | undefined {
    const trees = parked.get(key)
    if (!trees?.length || this.root) return undefined
    const tree = trees.find(t => t.mount === this.mount) ?? trees[0]
    const left = trees.filter(t => t !== tree)
    if (left.length) parked.set(key, left)
    else parked.delete(key)
    if (tree.mount !== this.mount) {
      this.mount.replaceWith(tree.mount)
      this.mount = tree.mount
    }
    this.root = tree.root
    return tree.config as Config | null
  }

  // Called by HA on every state change.
  set hass(hass: HomeAssistant) {
    this._hass = hass
    this.render()
  }

  get hass() {
    return this._hass as HomeAssistant
  }

  protected abstract view(): ReactNode

  protected render() {
    if (!this._config || !this.isConnected || this.held) return
    this.root ??= createRoot(this.mount)
    this.root.render(<StrictMode>{this.view()}</StrictMode>)
  }
}
