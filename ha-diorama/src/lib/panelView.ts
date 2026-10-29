// The nearest ancestor with the given tag, looking up through the shadow
// roots on the way.
export function closest(element: HTMLElement, tag: string) {
  let node: Node | null = element
  while (node) {
    if (node instanceof HTMLElement && node.localName === tag) return node
    node = node instanceof ShadowRoot ? node.host : node.parentNode
  }
  return null
}

// The nearest ancestor with the given class, looking up through the
// shadow roots on the way.
export function closestClass(element: HTMLElement, name: string) {
  let node: Node | null = element
  while (node) {
    if (node instanceof HTMLElement && node.classList.contains(name)) return node
    node = node instanceof ShadowRoot ? node.host : node.parentNode
  }
  return null
}

// Whether the element sits in a panel view, which gives its one card the
// whole screen.
export const inPanelView = (element: HTMLElement) => !!closest(element, 'hui-panel-view')
