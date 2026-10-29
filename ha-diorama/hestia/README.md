# HESTIA additions (not part of upstream)

| File | Purpose |
|---|---|
| `walls.test.ts` | Checks for `src/geometry/walls.ts` with Node's own test runner: `node --test hestia/walls.test.ts` (Node 23.6+ runs TypeScript directly). Upstream has no test runner, so the tests stay here and out of the pull request. |
| `deploy_dev.py` | Puts `dist/card.js` on the DEV Home Assistant over the HACS copy and gives the resource a new `?hestia=<hash>` URL (HA serves `/hacsfiles/` with a 31 day cache). `--restore` puts the HACS original back. Never for prod. |

Walls patch, state 2026-10-29: `src/geometry/walls.ts` (geometry, pure), `src/scene/Walls.tsx` (drawing, cutaway),
config in `src/types.ts` (`walls`, room `ceiling`, room `open_to`), passages respect walls
(`src/geometry/passages.ts`, `Passages.tsx`, `CameraRig.tsx`, editor `RoomInfo.tsx`), focus hides other rooms' walls
(`src/scene/focus.ts`), docs in `docs/DEVELOPMENT.md` and `CHANGELOG.md`.

Open: ceiling lights and pendants still hang from 2.6 m instead of the measured `ceiling`; doors and windows stand
above half or cut walls; no switch in the visual editor yet.

Screenshots in headless Chromium: the tab must be in front (`Page.bringToFront`), otherwise
`requestAnimationFrame` never fires and the card keeps an old or empty frame.
