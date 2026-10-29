import { BufferGeometry, ExtrudeGeometry, Shape } from 'three'

// Upholstered and molded plates, flat outlines given a thickness and bent
// round a vertical axis, for the backs of the office chairs.

// Adds points every centimeter along a straight edge, so a plate bends
// smoothly across its face rather than in one chord.
function edge(s: Shape, [x0, y0]: [number, number], [x1, y1]: [number, number]) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.01))
  for (let i = 1; i <= n; i++) s.lineTo(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n)
}

// An outline `w0` wide at its foot and `w1` at its head, `h` tall, the foot's
// corners rounded `r0` and the head's `r1`, shrunk all round by `inset`. The
// middle of its foot is the origin and it rises along +y.
export function taperedOutline(w0: number, w1: number, h: number, r0: number, r1: number, inset = 0) {
  const a = w0 / 2 - inset
  const b = w1 / 2 - inset
  const top = h - inset
  const bottom = inset
  const rb = Math.max(r0 - inset, 0.0005)
  const rt = Math.max(r1 - inset, 0.0005)
  const s = new Shape()
  s.moveTo(-a + rb, bottom)
  edge(s, [-a + rb, bottom], [a - rb, bottom])
  s.absarc(a - rb, bottom + rb, rb, -Math.PI / 2, 0, false)
  edge(s, [a, bottom + rb], [b, top - rt])
  s.absarc(b - rt, top - rt, rt, 0, Math.PI / 2, false)
  edge(s, [b - rt, top], [-b + rt, top])
  s.absarc(-b + rt, top - rt, rt, Math.PI / 2, Math.PI, false)
  edge(s, [-b, top - rt], [-a, bottom + rb])
  s.absarc(-a + rb, bottom + rb, rb, Math.PI, Math.PI * 1.5, false)
  return s
}

// Bends a plate standing on the XY plane round a vertical axis `radius` in
// front of it, so its edges come forward and it is concave toward +z. Its
// normals turn with it.
export function bendAround(geo: BufferGeometry, radius: number) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) / radius
    const r = radius - pos.getZ(i)
    const [c, s] = [Math.cos(t), Math.sin(t)]
    pos.setXYZ(i, r * s, pos.getY(i), radius - r * c)
    const [nx, nz] = [nor.getX(i), nor.getZ(i)]
    nor.setXYZ(i, nx * c - nz * s, nor.getY(i), nx * s + nz * c)
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  return geo
}

// A plate `thick` deep with softened edges: `outline(inset)` gives its face,
// shrunk by the bevel so the plate keeps its size. Its back face is z 0, and
// it is bent round `bend` when that is given.
export function plate(outline: (inset: number) => Shape, thick: number, bend?: number, bevel = 0.006) {
  const b = Math.min(bevel, thick / 3)
  const geo = new ExtrudeGeometry(outline(b), {
    depth: thick - b * 2,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 4,
    curveSegments: 24,
  })
  geo.translate(0, 0, b)
  return bend ? bendAround(geo, bend) : geo
}
