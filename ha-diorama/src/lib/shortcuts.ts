// How the modifier keys are written in menus. Mac keyboards get the symbols
// people expect there, everything else gets the words.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export const MOD_KEY = MAC ? '⌘' : 'Ctrl'
export const ALT_KEY = MAC ? '⌥' : 'Alt'

// A shortcut as a menu shows it, for example "⌘D" or "Ctrl D".
export const shortcut = (key: string, mod = false) => (mod ? `${MOD_KEY}${MAC ? '' : ' '}${key}` : key)
