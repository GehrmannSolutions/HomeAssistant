import { BACKGROUNDS } from '#/lib/background.ts'

// Every background the card can lay behind a view, a row for each with its
// light version and its dark one side by side, each the size of a window.
// A click on one shows it alone over the whole page, and another click
// goes back to the list.
document.body.style.cssText = 'margin:0;background:#777;font:600 14px system-ui,sans-serif'
const list = document.createElement('div')
list.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px'
const alone = document.createElement('div')
alone.style.cssText = 'position:fixed;inset:0;display:none;cursor:zoom-out'
alone.onclick = () => (alone.style.display = 'none')

for (const background of BACKGROUNDS) {
  for (const mode of ['light', 'dark'] as const) {
    const cell = document.createElement('div')
    cell.style.cssText = `aspect-ratio:16/10;border-radius:12px;padding:12px;cursor:zoom-in;color:${mode === 'dark' ? '#fff9' : '#0008'}`
    cell.style.background = background[mode]
    cell.textContent = `${background.name} ${mode}`
    cell.onclick = () => {
      alone.style.background = background[mode]
      alone.style.display = 'block'
    }
    list.appendChild(cell)
  }
}
document.body.append(list, alone)
