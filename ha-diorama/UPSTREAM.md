# Upstream

This folder is a copy of **CarlesRojas/ha-diorama** (MIT, see `LICENSE`, copyright Carles Rojas).

| | |
|---|---|
| Source | https://github.com/CarlesRojas/ha-diorama |
| Commit | `13b2e3f98a6430bea2aef00fcc9439f11caa8e8a` (2026-10-28, release v1.8.29) |
| Copied | 2026-10-29 by HESTIA for analysis (walls, issue #102) |
| Left out | `.git`, `node_modules`, `dist`, large media (`docs/video`, `docs/tutorial/*.mp4`, `docs/images/*.gif`, `ha-demo/config/cameras/backyard.gif`), `.claude`, `.impeccable` |

Build (verified 2026-10-29, node 26, `dist/card.js` 5.9 MB):

```bash
npx -y pnpm@10.31.0 install --frozen-lockfile
npx -y pnpm@10.31.0 build
```

Update: clone upstream again, `rsync` with the same excludes, update the commit above. Own changes go on top as
separate commits so they can be offered upstream as a pull request (preferred over a long-lived fork: upstream
moves fast, about 770 commits since 2026-09-19).

Analysis: `HESTIA-ANALYSE.de.md`.
