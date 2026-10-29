# Demo Home Assistant

A Home Assistant in Docker with the demo flat already on a dashboard, so you can see the card working against real entities without setting anything up. The devices come from Home Assistant's own Demo integration: lights, covers, a vacuum, media players, a thermostat and the rest are all made up, and they respond when you use them.

## Run it

You need Node, pnpm and Docker. From the root of the repo, build the card once:

```bash
pnpm install
pnpm build
```

Then start Home Assistant from this folder:

```bash
cd ha-demo
docker compose up -d
```

Open http://localhost:8124 and create the owner account when Home Assistant asks for it. The first start takes a minute or two. Once you are in, open Diorama in the sidebar.

It runs on port 8124, so it can sit next to another Home Assistant on the usual 8123.

## What is in it

- `compose.yaml` mounts the repo's `dist` folder, so the dashboard always runs the card you last built, and the `themes` folder, for the Diorama Glass theme the dashboard uses.
- `config/configuration.yaml` loads the Demo integration and registers the card and the dashboard in YAML. It adds a projector screen, which the Demo integration does not have, Projector scene, TV scene, All lights and Cleaning switches for the side panel's Home section, and sets the demo lights to a warm white and turns the living room TV off on every start.
- `config/diorama.yaml` is the dashboard. It is written by `pnpm demoflat` from `scripts/demoflat.plan.ts`, the same plan as `demoflat.yaml`, with each piece bound to its Demo integration entity. Do not edit it by hand.
- `seed/core.config_entries` sets up the backyard camera on the first start, since that kind of camera can only be added from the UI. It loops `config/cameras/backyard.gif`, made from [a clip on Pexels](https://www.pexels.com/video/a-black-cat-on-the-backyard-9337775/).

Everything else Home Assistant writes into `config` while it runs stays out of git.

## Try your changes

Run `pnpm watch` in the repo root, or `pnpm build` after each change, and reload the page with the cache cleared.

The Diorama dashboard is kept in YAML, so it cannot be saved from the UI. To try the editor, add a new dashboard from Settings, Dashboards, add a manual card to it and paste the card from `config/diorama.yaml`, everything under `cards:`, so its pieces stay bound to the demo entities. Or add a Diorama card and draw your own rooms.

## Start again

To throw everything away, including the owner account, stop it and clear what Home Assistant wrote:

```bash
docker compose down
git clean -fdX config
```
