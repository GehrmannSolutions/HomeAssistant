// A count of the frames the card drew in the last second, in a corner of
// the page. A tick counts as a frame when anything was drawn on it, so a
// room standing still reads zero.
export function showFps() {
  const box = document.createElement('div')
  box.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:99999;padding:10px 14px;border-radius:10px;background:rgba(0,0,0,.75);font:600 22px/1.2 ui-monospace,monospace;pointer-events:none'
  document.body.append(box)
  let drew = false
  let ticks: number[] = []
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const draw = proto[name]
    proto[name] = function (this: unknown, ...a: unknown[]) {
      drew = true
      return draw.apply(this, a)
    }
  }
  const tick = () => {
    if (drew) ticks.push(performance.now())
    drew = false
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  setInterval(() => {
    const now = performance.now()
    ticks = ticks.filter(t => now - t < 1000)
    box.textContent = `${ticks.length} fps`
    box.style.color = ticks.length === 0 ? '#5cff8a' : ticks.length > 61 ? '#ff6b5c' : '#ffd25c'
  }, 200)
}
