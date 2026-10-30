# HESTIA additions (not part of upstream)

| File | Purpose |
|---|---|
| `walls.test.ts` | Checks for `src/geometry/walls.ts` with Node's own test runner: `node --test hestia/walls.test.ts` (Node 23.6+ runs TypeScript directly). Upstream has no test runner, so the tests stay here and out of the pull request. |
| `planRooms.test.ts` | Checks for the room search in a plan picture, `src/editor/planRooms.ts` (prototype, not wired into the editor yet). |
| `plan_to_diorama.ts` | Reads a plan picture (local grey raster) into rooms, doors and windows for the card, in meters: `node hestia/plan_to_diorama.ts <file.gray> <w> <h> <px per m> <out.json>`. Plans stay local, never in the repo. |
| `plan_view.py` | Check picture for that output: rooms, doors (green), windows (blue) over the plan. |
| `check_walls.ts` | Runs a dashboard config through the card's own wall builder (`wallsOf`, openings as `Walls.tsx` reads them): wall blocks, heights, and every door or window that cuts no wall (too far from a wall line it would silently stay shut): `node hestia/check_walls.ts <dashboard.json> [view ...]`. |
| `deploy_dev.py` | Puts `dist/card.js` on a TEST Home Assistant over the HACS copy (`--env-file` with HA_URL/HA_TOKEN, `--config-dir`) and gives the resource a new `?hestia=<hash>` URL through ha-safe-mcp (HA serves `/hacsfiles/` with a 31 day cache). `--restore` puts the HACS original back. Never for production. |

Walls patch, state 2026-10-29: `src/geometry/walls.ts` (geometry, pure), `src/scene/Walls.tsx` (drawing, cutaway),
config in `src/types.ts` (`walls`, room `ceiling`, room `open_to`), passages respect walls
(`src/geometry/passages.ts`, `Passages.tsx`, `CameraRig.tsx`, editor `RoomInfo.tsx`), focus hides other rooms' walls
(`src/scene/focus.ts`), docs in `docs/DEVELOPMENT.md` and `CHANGELOG.md`.

Open: ceiling lights and pendants still hang from 2.6 m instead of the measured `ceiling`; doors and windows stand
above half or cut walls; no switch in the visual editor yet.

Screenshots in headless Chromium: the tab must be in front (`Page.bringToFront`), otherwise
`requestAnimationFrame` never fires and the card keeps an old or empty frame.

Room search in a plan picture (`src/editor/planRooms.ts`, `readPlan`), as of 2026-10-29 evening:

1. Ink by Otsu; dashed and dash-dotted lines (section lines, hidden edges) taken out.
2. Walls found two ways: paper strips between two lines, narrow one way (6.5 to 40 cm) and long the other
   (wall interiors; treads of stairs and panes of windows rejected as ladders, tiles as neighbours); and dense bands
   (window fronts, solid walls) that hold a long line and are not mostly tile cells.
3. The frame of the sheet dropped; openings closed only along the wall's way: up to 1.1 m always (doors), up to
   2.6 m where panes run through (windows); a wall of 0.8 m or more carried on to a wall ahead (door by a corner);
   chinks up to 30 cm sealed.
4. Rooms are the enclosed paper, straightened to right angles; each side with a room beyond its wall is moved to the
   middle of that wall, outer sides to the inner face; outer wall thickness measured.
5. Openings: what step 3 added between two rooms is a door, to the outside a window; thin bands on the outside are
   window fronts, cut into windows of at most 2.5 m.

In the editor: Trace image, set Width in meters, Find rooms (`src/editor/planImport.ts`, button in
`Toolbar.tsx`, `findRooms` in `Editor.tsx`): adds the rooms (Room n), doors and windows, and switches walls on
with the measured outer wall when the card had none. Tested on Dev 2026-10-29 with a scanned 1:100 house plan (kept local): 7 rooms,
11 doors, 18 windows in about a second; the card config held only meters (5.4 KB, no picture).

On that plan: the open living and dining area came out as one room as drawn, the hall rooms as one; only a small
room that runs into the hall is not yet found. Outer wall 0.375 m as dimensioned.
