// Development entry, loaded straight from the Vite dev server as the Home
// Assistant resource: http://localhost:5173/src/dev/entry.ts
//
// Vite normally injects the React Fast Refresh preamble through index.html,
// which this project does not have. Install it here, then load the card.
// The production build never includes this file.
const base = new URL(import.meta.url).origin
const runtime = await import(/* @vite-ignore */ `${base}/@react-refresh`)
runtime.injectIntoGlobalHook(window)

const w = window as unknown as Record<string, unknown>
w.$RefreshReg$ = () => {}
w.$RefreshSig$ = () => (type: unknown) => type
w.__vite_plugin_react_preamble_installed__ = true

await import('#/main.tsx')
