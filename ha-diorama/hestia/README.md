# HESTIA additions (not part of upstream)

| File | Purpose |
|---|---|
| `walls.test.ts` | Checks for `src/geometry/walls.ts` with Node's own test runner: `node --test hestia/walls.test.ts` (Node 23.6+ runs TypeScript directly). Upstream has no test runner, so the tests stay here and out of the pull request. |
| `planRooms.test.ts` | Checks for the room search in a plan picture, `src/editor/planRooms.ts` (prototype, not wired into the editor yet). |
| `try_plan.ts` | Runs the room search on a local grey raster of a plan: `node hestia/try_plan.ts <file.gray> <w> <h> <px per m> <out.json>`. Plans stay local, never in the repo. |
| `deploy_dev.py` | Puts `dist/card.js` on the DEV Home Assistant over the HACS copy and gives the resource a new `?hestia=<hash>` URL (HA serves `/hacsfiles/` with a 31 day cache). `--restore` puts the HACS original back. Never for prod. |

Walls patch, state 2026-10-29: `src/geometry/walls.ts` (geometry, pure), `src/scene/Walls.tsx` (drawing, cutaway),
config in `src/types.ts` (`walls`, room `ceiling`, room `open_to`), passages respect walls
(`src/geometry/passages.ts`, `Passages.tsx`, `CameraRig.tsx`, editor `RoomInfo.tsx`), focus hides other rooms' walls
(`src/scene/focus.ts`), docs in `docs/DEVELOPMENT.md` and `CHANGELOG.md`.

Open: ceiling lights and pendants still hang from 2.6 m instead of the measured `ceiling`; doors and windows stand
above half or cut walls; no switch in the visual editor yet.

Screenshots in headless Chromium: the tab must be in front (`Page.bringToFront`), otherwise
`requestAnimationFrame` never fires and the card keeps an old or empty frame.

Room search in a plan picture (prototype, 2026-10-29): ink -> long straight runs only (text, slanted hatching, door
arcs go) -> openings up to 1.3 m between collinear wall lines shut -> paper worn back by 15 cm, one piece per room ->
slots filled, outline traced, straightened to right angles, grown back. Clean plans work (synthetic tests); on the
scanned house plan only 3 of about 10 rooms come out right (tile grids in kitchen and bath, stairs, a strip
between wall and dimension line). A first tile-grid filter (crossing density) cut the walls apart and was dropped.
