# 🦖 Dino Farm

A co-op multiplayer third-person 3D farming game in the browser. Pick a dinosaur, tame wild
plants, raise dodos and mammoths, shape the land — and defend the farm together when giant
reptiles raid it.

## Quick start

```bash
npm install
npm run dev          # game server on :3000 + Vite client on :5173
```

Open http://localhost:5173 in a few browser tabs (or share your LAN IP) to play together.

Production: `npm run build && npm start` — the server then hosts the built client and the
WebSocket on one port (`PORT`, default 3000).

## Deploying

The game needs a long-running Node process for the WebSocket server, so **static hosts like
Vercel can only serve the client**. Two options:

1. **All-in-one on Render** (simplest): Render dashboard → *New → Blueprint* → pick this repo.
   `render.yaml` builds the client and starts the server; the Render URL is the full game.
   (Railway / Fly.io work the same way: build `npm run build`, start `npm start`.)
2. **Client on Vercel + server on Render**: deploy the server as above, then in Vercel →
   Project → Settings → Environment Variables set
   `VITE_SERVER_URL=https://<your-service>.onrender.com` and redeploy.

Free Render instances sleep when idle; the first join after a while can take ~30–50 s.

| Env var      | Default    | Meaning                                        |
| ------------ | ---------- | ---------------------------------------------- |
| `PORT`       | `3000`     | HTTP + WebSocket port                          |
| `SEED`       | `20261018` | World generation seed                          |
| `RAID_FIRST` | `150`      | Seconds until the first raid (use 30 to test)  |
| `VITE_SERVER_URL` | same origin | *Client build-time:* game server URL when the client is hosted separately |

Tests: with a server running, `npm run test:smoke -- ws://localhost:3000/ws` and
`npm run test:raid -- ws://localhost:3000/ws` (start the server with `RAID_FIRST=3` for the raid test).

## How to play

| Key            | Action                                                      |
| -------------- | ----------------------------------------------------------- |
| WASD / Mouse   | Move / look (click the game to lock the mouse)              |
| Space          | Jump (Raptor: double jump · Pteranodon: hold to fly)        |
| Shift          | Sprint (Pteranodon in the air: dive)                        |
| LMB / RMB      | Use tool / secondary (Shovel RMB digs, Shift+RMB raises)    |
| E              | Interact: chop, mine, collect seeds, tend, harvest, feed, repair, trade |
| Q              | Dino ability                                                |
| 1–8            | Hoe, Shovel, Watering Can, Seed Pouch, Hammer, Club, Sling, Bola |
| R / T / X      | Cycle seed or building / rotate building / demolish        |
| F              | Drink nectar to heal                                        |
| H / Enter      | Help / chat                                                 |

### Dinosaurs
- **Velociraptor** (Land): fastest, double jump, *Pounce* dash attack.
- **Ankylosaurus** (Land): huge HP, gathers 2× wood & stone, *Tail Quake* AoE knockback.
- **Pteranodon** (Air): flies; raiders can't reach it up high; *Boulder Drop* bombing.
- **Spinosaurus** (Water): fast swimmer, heals in water, endless watering can, *Tidal Spout* hurts raiders **and waters crops**.

### Farming & taming
1. **Shovel** clears rough/rocky ground and flattens it; dig down to make ponds (water irrigates soil within 2 tiles). A **Well** irrigates 7 m around it.
2. **Hoe** tills grass into soil. **Seed Pouch** plants. **Watering can** waters (refill at water). Plants only grow while watered (rain waters everything).
3. Every seed starts **wild**. Press **E** to tend a plant (+20 tame). It must reach 100% before it ripens + 25 s, or it goes **feral**:
   Snapjaw bites, Thornberry spreads thorns, Wanderroot walks away, Glowcap puffs spores, Sunbloom wilts and ruins the soil.
4. Tamed plants help the farm: Snapjaws bite raiders, Thornberries are living hedges, Glowcaps slow raiders at night, Sunblooms heal dinos.
5. Harvesting a tamed plant gives produce plus **heirloom seeds**, which start half-tame (domestication over generations).
6. Find more seeds by pressing **E** on wild plants around the map. Watch out: they bite, and wild Wanderroots run away.

### Animals, building & trade
Build a **Dodo Coop** (eggs) or **Mammoth Barn** (wool), and feed the animals with food (E). Trade eggs, wool and spores at the **Hut**
(also your respawn point). Other buildings: fences, stone walls, spike traps, ballista towers, glow lanterns.

### Raids
Every few minutes giant reptiles attack: packs of **Megalania** from the wilds, **Sarcosuchus** out of the lake, and a **Titanoboa**
on every third wave. Walls and fences block them (they'll chew through), towers and traps fight back. All players are on the same
team and there is no friendly fire. Clearing a raid gives a resource reward.

## Architecture

```
shared/    game rules & data (constants), terrain generation, network protocol types
server/    authoritative simulation (20 Hz): plants/taming, animals, raider AI, combat, buildings
src/       React + React Three Fiber client
  store.ts   Zustand store (UI + entity lists)      world.ts  mutable 20 Hz state (positions, terrain)
  net.ts     WebSocket client                       input.ts  keyboard/mouse/pointer lock
  game/      scene, terrain mesh, environment, local player controller, entity renderers
  models/    procedural low-poly models (no external assets)
  ui/        menu + HUD
```

Movement is client-side for responsiveness; everything else (farming, damage, AI, resources)
is validated and simulated on the server. All players share one team resource pool.

## Roadmap ideas
- World persistence (save/load the farm), multiple farm rooms
- Plant cross-breeding & mutations, seasonal crops, a greenhouse
- Ride-able/tameable wild dinos, eggs that hatch into farm helpers
- Weather events (meteor showers, droughts, floods), boss raids with phases
- Quests/achievements and cosmetic unlocks per dino
