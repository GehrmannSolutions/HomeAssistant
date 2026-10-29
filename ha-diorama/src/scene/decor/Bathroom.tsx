import type { Fit } from '#/scene/decor/Kitchen.tsx'
import { useEased } from '#/scene/decor/ease.ts'
import { Fill, Hollow, SEG, Slab, Stream, Tube } from '#/scene/decor/parts.tsx'
import { BridgeTap } from '#/scene/decor/Sink.tsx'

// Toilets, basins and baths, each in three styles drawn after real pieces.
// Every one stands with its back to the wall at -z, and its style comes in
// as the variant's id, the first style when there is none.

// The waste in the floor of a bowl or a tub, a steel disc.
function Waste({ x = 0, y, z, r = 0.022, fit }: { x?: number; y: number; z: number; r?: number; fit: Fit }) {
  return (
    <mesh position={[x, y + 0.001, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[r, SEG]} />
      {fit.M('tap')}
    </mesh>
  )
}

// A seat top and its opening seen from above: a stadium the pan's width, the
// hole kept a band in from the sides and a wider one at the back.
function seatHole(w: number, l: number) {
  const hw = w - 0.1
  const hd = l - 0.14
  return { w: hw, d: hd, z: 0.02, r: Math.min(hw, hd) / 2 - 0.002 }
}

// Four toilets, each with its own pan. The first two are drawn in plan as a
// D, flat against the wall and a full semicircle at the front, after the
// Laufen Kartell. One stands skirted down to the floor with its cistern on
// the back, the same width, so the whole piece reads as one shape. The
// other is hung off the wall with nothing under it but a narrower foot,
// and a Geberit Sigma20 plate a meter up the wall to flush it. A close
// coupled one after the Duravit ME, round and soft, with its cistern
// standing on the back of the pan. A square close coupled one after the
// Duravit Vero Air, skirted down to the floor with a flat sided cistern and
// a rectangular bowl. `d` is how far it all comes out from the wall. While
// it is on, the lid stands up on its hinges.
export function Toilet({ style, w, d, on, fit }: { style?: string; w: number; d: number; on: boolean; fit: Fit }) {
  const { M } = fit
  const lift = useEased(on ? 1 : 0, 3)
  const kind = style === 'close_coupled' || style === 'square' || style === 'wall_hung' ? style : 'arc'
  const square = kind === 'square'
  const arc = kind === 'arc' || kind === 'wall_hung'
  const cistern = kind !== 'wall_hung'
  const wall = -d / 2
  const pz = 0
  const top = 0.4
  // The underside of the bowl's shell, and the narrower foot below it. A
  // square pan is skirted, one block down to the floor.
  const shell = kind === 'wall_hung' ? 0.2 : square || kind === 'arc' ? 0 : 0.2
  const foot = kind === 'wall_hung' ? 0.14 : 0
  // A cistern takes the back of the pan, so its seat stops short of it.
  const sl = Math.min(0.46, d * 0.78, d - (cistern ? 0.2 : 0.05))
  const sz = d / 2 - 0.008 - sl / 2
  const hole = seatHole(w, sl)
  if (square) hole.r = Math.min(0.06, hole.r)
  const round = square ? Math.min(0.04, w * 0.12) : arc ? 0.02 : Math.min(w, d) * 0.45
  const seatR = square ? Math.min(0.05, w * 0.14) : arc ? 0.012 : w / 2
  const seatFront = arc ? w / 2 : undefined
  const deep = top - Math.max(shell, 0.2) - 0.01
  // The pan narrows on its way down, the same shape as the seat but
  // smaller at the floor, or at the foot of a pan off the floor.
  const taper = shell > 0 ? 0.76 : 0.64
  return (
    <group>
      <Slab
        size={[w, top - shell, d]}
        radius={round}
        bevel={square ? 0.006 : 0.012}
        position={[0, shell, pz]}
        holes={[{ x: 0, z: sz + hole.z - pz, w: hole.w, d: hole.d, r: hole.r }]}
        front={arc ? w / 2 : undefined}
        taper={taper}
      >
        {M('pan')}
      </Slab>
      {/* The bowl, the glaze curving down inside the opening, or in a
          square pan falling straight. */}
      {square ? (
        <Hollow
          size={[hole.w, deep, hole.d]}
          wall={0.008}
          radius={hole.r}
          position={[0, top - deep, sz + hole.z]}
          taper={0.6}
        >
          {M('pan')}
        </Hollow>
      ) : (
        <mesh position={[0, top - 0.004, sz + hole.z]} scale={[hole.w / 2, deep, hole.d / 2]}>
          <sphereGeometry args={[1, SEG, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          {M('pan')}
        </mesh>
      )}
      {!square && shell > 0 && (
        <Slab
          size={[w * 0.66, shell - foot + 0.002, d * 0.74]}
          radius={arc ? 0.02 : Math.min(0.1, w * 0.3)}
          bevel={0.01}
          position={[0, foot, wall + d * 0.37]}
          front={arc ? w * 0.33 : undefined}
          taper={0.85}
        >
          {M('pan')}
        </Slab>
      )}
      {/* The seat and the lid down over it, and their hinges. */}
      <Slab
        size={[w, 0.018, sl]}
        radius={seatR}
        bevel={0.006}
        position={[0, top, sz]}
        holes={[{ x: 0, z: hole.z, w: hole.w, d: hole.d, r: hole.r }]}
        front={seatFront}
      >
        {M('seat')}
      </Slab>
      {/* The lid turns up about the hinges, and stops just short of
          upright so it rests back against the cistern or the wall. */}
      <group position={[0, top + 0.018, sz - sl / 2]} rotation={[-lift * 1.5, 0, 0]}>
        <Slab
          size={[w - 0.006, 0.02, sl - 0.006]}
          radius={seatR}
          bevel={0.008}
          position={[0, 0, sl / 2]}
          front={seatFront && seatFront - 0.003}
        >
          {M('seat')}
        </Slab>
      </group>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * w * 0.28, top + 0.018, sz - sl / 2 - 0.012]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 0.04, 16]} />
          {M('seat')}
        </mesh>
      ))}
      {kind === 'wall_hung' && <FlushPlate z={wall} fit={fit} />}
      {cistern && (
        <group>
          <Slab
            size={[w, 0.78 - top, 0.17]}
            radius={square ? 0.012 : arc ? 0.02 : 0.06}
            bevel={square ? 0.004 : arc ? 0.01 : 0.03}
            front={arc ? 0.07 : undefined}
            position={[0, top, wall + 0.085]}
          >
            {M('pan')}
          </Slab>
          {square ? (
            <group position={[0, 0.78, wall + 0.085]}>
              {[
                [-0.021, 0.04],
                [0.024, 0.026],
              ].map(([x, bw]) => (
                <Slab key={x} size={[bw, 0.005, 0.05]} radius={0.004} bevel={0.0015} position={[x, 0, 0]}>
                  {M('flush')}
                </Slab>
              ))}
            </group>
          ) : (
            <FlushButtons y={0.78} z={wall + 0.085} fit={fit} />
          )}
        </group>
      )}
    </group>
  )
}

// A dual flush button pressed from above: a big half for a full flush, a
// small one for half.
function FlushButtons({ y, z, fit }: { y: number; z: number; fit: Fit }) {
  return (
    <group position={[0, y, z]}>
      <mesh position={[0, 0.003, 0]}>
        <cylinderGeometry args={[0.028, 0.028, 0.006, SEG]} />
        {fit.M('flush')}
      </mesh>
      <mesh position={[0.008, 0.007, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.004, SEG]} />
        {fit.M('flush')}
      </mesh>
    </group>
  )
}

// The flush plate of a wall hung pan, set flat in the wall a meter up: a
// Sigma20, 24.6 by 16.4 cm, a large and a small button side by side in a
// frame.
function FlushPlate({ z, fit }: { z: number; fit: Fit }) {
  const { M } = fit
  return (
    <group>
      <Slab size={[0.246, 0.164, 0.008]} radius={0.01} bevel={0.002} position={[0, 0.918, z + 0.004]}>
        {M('flush')}
      </Slab>
      {[
        [-0.03, 0.13],
        [0.068, 0.056],
      ].map(([x, bw]) => (
        <Slab key={x} size={[bw, 0.124, 0.006]} radius={0.006} bevel={0.002} position={[x, 0.938, z + 0.009]}>
          {M('flush')}
        </Slab>
      ))}
    </group>
  )
}

// A slim single lever mixer after the Hansgrohe Talis E 110: a tall square
// block with its spout squared off along the top and a flat lever above.
function BlockTap({ fit }: { fit: Fit }) {
  const metal = fit.M('tap')
  return (
    <group>
      <Slab size={[0.04, 0.16, 0.05]} radius={0.012} bevel={0.004}>
        {metal}
      </Slab>
      <Slab size={[0.04, 0.024, 0.12]} radius={0.012} bevel={0.004} position={[0, 0.13, 0.05]}>
        {metal}
      </Slab>
      <Slab size={[0.028, 0.012, 0.07]} radius={0.01} bevel={0.003} position={[0, 0.16, -0.012]}>
        {metal}
      </Slab>
    </group>
  )
}

// A round single lever mixer after the Grohe Essence basin tap: a column, a
// spout that leaves it at a right angle, and a pin lever on top.
function RoundTap({ fit }: { fit: Fit }) {
  const metal = fit.M('tap')
  return (
    <group>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.02, 0.022, 0.16, SEG]} />
        {metal}
      </mesh>
      <Tube
        radius={0.011}
        points={[
          [0, 0.14, 0],
          [0, 0.145, 0.06],
          [0, 0.14, 0.11],
        ]}
      >
        {metal}
      </Tube>
      <mesh position={[0, 0.175, -0.02]} rotation={[-1.1, 0, 0]}>
        <cylinderGeometry args={[0.005, 0.006, 0.06, 12]} />
        {metal}
      </mesh>
    </group>
  )
}

// Three basins, the rim `h` off the floor. A console basin after the Duravit
// ME on an L-Cube vanity hung from the wall, one handleless drawer under it.
// A wall hung ME basin 18 cm deep with a chrome bottle trap under it. A
// basin on a pedestal after the Duravit Starck 3, rounder, with a bridge
// mixer. The bowl stays at most 55 cm wide as a basin grows, apart from the
// pedestal's, which takes up all of it.
export function Basin({ style, w, d, h, fit }: { style?: string; w: number; d: number; h: number; fit: Fit }) {
  const { M } = fit
  const kind = style === 'wall_hung' || style === 'pedestal' ? style : 'vanity'
  const t = kind === 'vanity' ? 0.05 : kind === 'wall_hung' ? 0.16 : 0.2
  const wall = 0.012
  const bw = kind === 'pedestal' ? w - 0.12 : Math.min(w - 0.1, 0.55)
  // A wider rim at the back for the tap, and on a vanity a wider one at the
  // front too, so the bowl stays inside the carcass under it.
  const bd = d - (kind === 'vanity' ? 0.15 : 0.13)
  const bz = kind === 'vanity' ? 0.015 : 0.025
  const br = Math.min(kind === 'pedestal' ? 0.14 : 0.07, bw / 2 - 0.01, bd / 2 - 0.01)
  const bh = 0.14
  const opening = { x: 0, z: bz, w: bw, d: bd, r: br + wall }
  const outer = kind === 'vanity' ? 0.01 : kind === 'wall_hung' ? 0.03 : Math.min(0.1, d * 0.25)
  const tapZ = -d / 2 + 0.045
  // Where the water leaves each tap, up from the rim and out from its foot.
  const spout = kind === 'vanity' ? [0.13, 0.095] : kind === 'wall_hung' ? [0.13, 0.11] : [0.158, 0.126]
  return (
    <group>
      <Slab size={[w, t, d]} radius={outer} bevel={0.008} position={[0, h - t, 0]} holes={[opening]}>
        {M('bowl')}
      </Slab>
      <Hollow size={[bw, bh, bd]} wall={wall} radius={br} position={[0, h - bh, bz]}>
        {M('bowl')}
      </Hollow>
      <Waste y={h - bh + wall} z={bz} fit={fit} />
      {/* A little water stands in the bowl while the tap runs. */}
      <group position={[0, 0, bz]}>
        <Fill
          on={fit.on}
          share={0.3}
          rate={0.8}
          floor={h - bh + wall}
          top={h}
          w={bw - wall * 2}
          l={bd - wall * 2}
          r={Math.max(br - wall, 0.01)}
        />
      </group>
      {kind === 'vanity' && <Vanity w={w} d={d} top={h - t} opening={opening} fit={fit} />}
      {kind === 'wall_hung' && (
        // The bottle trap, down from the waste and back into the wall.
        <group>
          <mesh position={[0, h - t - 0.05, bz]}>
            <cylinderGeometry args={[0.016, 0.016, 0.1, 20]} />
            {M('tap')}
          </mesh>
          <mesh position={[0, h - t - 0.16, bz]}>
            <cylinderGeometry args={[0.03, 0.03, 0.13, SEG]} />
            {M('tap')}
          </mesh>
          <Tube
            radius={0.016}
            points={[
              [0, h - t - 0.15, bz],
              [0, h - t - 0.15, (bz - d / 2) / 2],
              [0, h - t - 0.15, -d / 2],
            ]}
          >
            {M('tap')}
          </Tube>
        </group>
      )}
      {kind === 'pedestal' && (
        <Slab
          size={[Math.min(0.16, w * 0.3), h - t + 0.01, 0.21]}
          radius={0.06}
          bevel={0.012}
          position={[0, 0, -d / 2 + 0.105]}
        >
          {M('bowl')}
        </Slab>
      )}
      <group position={[0, h, tapZ]}>
        {kind === 'vanity' && <BlockTap fit={fit} />}
        {kind === 'wall_hung' && <RoundTap fit={fit} />}
        {kind === 'pedestal' && (
          <group scale={0.6}>
            <BridgeTap fit={fit} />
          </group>
        )}
      </group>
      <Stream on={fit.on} position={[0, h + spout[0], tapZ + spout[1]]} length={spout[0] + bh - wall} />
    </group>
  )
}

// The vanity under a console basin, hung from the wall: as tall as fits up
// to 50 cm, with the bowl let into its top and one drawer front stopping
// short of it so the gap is the grip.
function Vanity({
  w,
  d,
  top,
  opening,
  fit,
}: {
  w: number
  d: number
  top: number
  opening: { x: number; z: number; w: number; d: number; r: number }
  fit: Fit
}) {
  const { M } = fit
  const ch = Math.min(0.5, top - 0.25)
  const cd = d - 0.04
  const cz = -0.02
  const ring = 0.1
  return (
    <group>
      <Slab size={[w - 0.01, ch - ring + 0.001, cd]} radius={0.004} bevel={0.001} position={[0, top - ch, cz]}>
        {M('vanity')}
      </Slab>
      <Slab
        size={[w - 0.01, ring, cd]}
        radius={0.004}
        bevel={0.001}
        position={[0, top - ring, cz]}
        holes={[{ ...opening, z: opening.z - cz }]}
      >
        {M('vanity')}
      </Slab>
      <Slab
        size={[w - 0.012, ch - 0.035, 0.018]}
        radius={0.003}
        bevel={0.002}
        position={[0, top - ch + 0.002, cz + cd / 2 + 0.009]}
      >
        {M('vanity')}
      </Slab>
    </group>
  )
}

// An exposed wall mixer on the end wall of a bath, after the Hansgrohe
// Logis bath mixer: two rosettes on the wall, a slim body held off it on
// their elbows, a single lever on top and a short spout under the middle
// reaching over the rim.
function WallMixer({ y, z, fit }: { y: number; z: number; fit: Fit }) {
  const { M } = fit
  return (
    <group position={[0, y, z]}>
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.075, 0, 0]}>
          <mesh position={[0, 0, 0.006]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.028, 0.028, 0.012, SEG]} />
            {M('tap')}
          </mesh>
          <mesh position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.011, 0.011, 0.04, 16]} />
            {M('tap')}
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0, 0.055]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.022, 0.22, SEG]} />
        {M('tap')}
      </mesh>
      {/* The lever, on a short round cap. */}
      <mesh position={[0, 0.03, 0.055]}>
        <cylinderGeometry args={[0.018, 0.02, 0.02, SEG]} />
        {M('tap')}
      </mesh>
      <Slab size={[0.018, 0.01, 0.08]} radius={0.006} bevel={0.002} position={[0, 0.036, 0.085]}>
        {M('tap')}
      </Slab>
      <Tube
        radius={0.012}
        points={[
          [0, -0.012, 0.06],
          [0, -0.025, 0.1],
          [0, -0.03, 0.15],
        ]}
      >
        {M('tap')}
      </Tube>
      <mesh position={[0, -0.036, 0.15]}>
        <cylinderGeometry args={[0.013, 0.013, 0.014, 20]} />
        {M('tap')}
      </mesh>
    </group>
  )
}

// Three baths, the rim at the far end, -z, where the taps are. A
// freestanding shell after the Duravit Luv, 61.5 cm tall with thin walls,
// and a mixer on the wall at its end. A steel bath after the Kaldewei
// Saniform Plus let into a panelled box, its mixer on the end wall. A roll
// top after the Victoria + Albert Radford, rounded at both ends, on four
// feet, with a deck mixer on its rim.
export function Bathtub({ style, w, l, fit }: { style?: string; w: number; l: number; fit: Fit }) {
  const { M } = fit
  const kind = style === 'built_in' || style === 'roll_top' ? style : 'freestanding'
  if (kind === 'built_in') {
    const h = 0.57
    const tw = w - 0.12
    const tl = l - 0.12
    const r = Math.min(0.12, tw * 0.2)
    const deep = 0.42
    const cut = [{ x: 0, z: 0, w: tw, d: tl, r: r + 0.012 }]
    return (
      <group>
        <Slab size={[w, h - 0.015, l]} radius={0.006} bevel={0.002} holes={cut}>
          {M('panel')}
        </Slab>
        <Slab size={[w - 0.01, 0.015, l - 0.01]} radius={0.01} bevel={0.004} position={[0, h - 0.015, 0]} holes={cut}>
          {M('tub')}
        </Slab>
        <Hollow size={[tw, deep, tl]} wall={0.012} radius={r} position={[0, h - deep, 0]}>
          {M('tub')}
        </Hollow>
        <Waste y={h - deep + 0.012} z={-tl / 2 + 0.15} r={0.03} fit={fit} />
        <WallMixer y={h + 0.16} z={-l / 2} fit={fit} />
        <Stream on={fit.on} position={[0, h + 0.117, -l / 2 + 0.15]} length={deep + 0.105} radius={0.007} />
        <Fill
          on={fit.on}
          share={0.8}
          rate={0.35}
          floor={h - deep + 0.012}
          top={h - 0.015}
          w={tw - 0.024}
          l={tl - 0.024}
          r={r - 0.012}
        />
      </group>
    )
  }
  if (kind === 'roll_top') {
    const feet = 0.1
    const h = 0.65
    const wall = 0.03
    const bw = w - 0.03
    const bl = l - 0.03
    const r = Math.min(bw, bl) / 2 - wall - 0.02
    return (
      <group>
        <Hollow size={[bw, h - feet - 0.02, bl]} wall={wall} floor={0.1} radius={r} position={[0, feet, 0]}>
          {M('tub')}
        </Hollow>
        {/* The rolled rim, a rounded lip a little wider than the shell. */}
        <Slab
          size={[w, 0.045, l]}
          radius={Math.min(w, l) / 2}
          bevel={0.02}
          position={[0, h - 0.045, 0]}
          holes={[{ x: 0, z: 0, w: bw - wall * 2, d: bl - wall * 2, r }]}
        >
          {M('tub')}
        </Slab>
        <Waste y={feet + 0.1} z={-bl / 2 + 0.3} r={0.03} fit={fit} />
        {[-1, 1].flatMap(sx =>
          [-1, 1].map(sz => (
            <group key={`${sx}${sz}`} position={[sx * (w / 2 - 0.13), 0, sz * (l / 2 - 0.32)]}>
              <mesh position={[0, 0.03, 0]}>
                <sphereGeometry args={[0.032, 20, 14]} />
                {M('feet')}
              </mesh>
              <mesh position={[0, 0.075, 0]}>
                <cylinderGeometry args={[0.05, 0.028, 0.07, 20]} />
                {M('feet')}
              </mesh>
            </group>
          )),
        )}
        <group position={[0, h, -l / 2 + 0.03]}>
          <BridgeTap fit={fit} />
        </group>
        <Stream on={fit.on} position={[0, h + 0.264, -l / 2 + 0.24]} length={h + 0.264 - feet - 0.1} radius={0.007} />
        <Fill
          on={fit.on}
          share={0.8}
          rate={0.35}
          floor={feet + 0.1}
          top={h - 0.045}
          w={bw - wall * 2}
          l={bl - wall * 2}
          r={r - wall}
        />
      </group>
    )
  }
  const h = 0.615
  const r = Math.min(w, l) * 0.22
  return (
    <group>
      {/* A shadow gap under the shell, where it meets the floor. */}
      <Slab size={[w - 0.06, 0.02, l - 0.06]} radius={r} bevel={0.004}>
        {M('tub')}
      </Slab>
      <Hollow size={[w, h - 0.02, l]} wall={0.03} floor={0.15} radius={r} position={[0, 0.02, 0]}>
        {M('tub')}
      </Hollow>
      <Waste y={0.17} z={-l / 2 + 0.25} r={0.03} fit={fit} />
      {/* The mixer on the wall at its end, as on the built in bath. */}
      <WallMixer y={h + 0.16} z={-l / 2} fit={fit} />
      <Stream on={fit.on} position={[0, h + 0.117, -l / 2 + 0.15]} length={h + 0.117 - 0.17} radius={0.007} />
      <Fill on={fit.on} share={0.8} rate={0.35} floor={0.17} top={h} w={w - 0.06} l={l - 0.06} r={r - 0.03} />
    </group>
  )
}
