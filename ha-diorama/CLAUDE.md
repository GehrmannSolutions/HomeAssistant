# Working rules

## Branch state before any work

Before starting any task, check the state of the branch you are working on against `main`:

- If the branch's pull request was merged into `main`: do not add commits to it. Start the new work on a fresh branch created from the latest `origin/main` (`git fetch origin main && git checkout -B <branch> origin/main`). Any pull request opened for it is a new one.
- If the branch was rebased or force-pushed: fetch it and continue the work on top of that.
- If the branch is open and unchanged: continue as is.

Check this on every new session and again right before every commit: fetch, confirm the branch's pull request is still open and the remote branch has not moved. Never commit on stale assumptions.

Whenever a pull request is merged, and whenever you check the state of the branches, fetch with `--prune` and delete every local branch whose pull request was merged and whose remote branch is gone. Never delete a local branch with commits that were not merged.

Keep working on the same branch and pull request while it is open, whatever the task. Only start a new branch when the pull request was merged or the user asks for one.

## Project

Custom Lovelace card for Home Assistant: a 3D model of the flat with entities bound to objects. React + Three.js, Vite in lib mode building a single `dist/card.js`. See `docs/DEVELOPMENT.md` for the local Home Assistant setup and the full reference; `README.md` is the short public pitch and install guide for people who are not developers.

- Package manager: pnpm. `pnpm build` runs tsc and vite, `pnpm lint` runs oxlint, `pnpm watch` rebuilds on change.
- Styling: Tailwind v4, injected into the card's shadow root from `src/index.css`. Use the `cn` helper from `src/lib/utils.ts`.
- `dist/` is bind-mounted into the Home Assistant container. Never empty it from the build config.
- Write in plain sentences. Never use em dashes, in code comments, commit messages, or docs.
- When giving the user card YAML, always give the complete card config, never a fragment to merge.
- Dev pages and previews open on a dark background, a dark gradient or a dark grey, never white, and with Home Assistant's dark theme where the page has one. A light version is only ever opt in, through a query parameter.
- `showroom.yaml` is a card with every decoration kind in its own row and each of its styles along it, at default sizes and colors. Run `pnpm showroom` to regenerate it after any change to the catalog, and commit it with that change. Do not send it to the user.

## Changelog

`CHANGELOG.md` follows Keep a Changelog. It is for people who use the card, not a record of every change: it should stay short enough to read calmly and be understood in full. Only a change a user would clearly notice, and that is not a small detail, goes under `## [Unreleased]`, in the same commit as the change. Small tweaks to spacing, sizes, colors, wording or polish of something already there do not go in, and several related changes are best told as one entry. When an entry for the same feature is already under Unreleased, change that entry rather than adding another. A new feature or piece goes under `### Added`, a change in behavior under `### Changed`, a bug fix under `### Fixed`, something taken away under `### Removed`. Write each entry as one plain sentence about what the user sees, not about the code. Internal refactors, tooling and dev pages do not go in. Never add a version heading by hand: the Release workflow moves the Unreleased entries under the new version when it publishes.
