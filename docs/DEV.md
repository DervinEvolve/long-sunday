# Working on Long Sunday

Notes for myself on running the world, looking at it, and adding to it.

## Run it

```
npm install
npm run dev            # http://localhost:5173
npm run typecheck      # tsc --noEmit, strict
npm run build          # dist/, relative paths, works from any static host
npm run build:single   # dist-single/index.html, everything inlined into one file
npm run preview        # serve dist/
```

`index.html` loads `src/main.ts`. That makes the renderer, the quality governor, the input and the
world (`src/engine/world.ts`), and runs the frame loop. The interface in `src/ui` is optional. If
`src/ui/index.ts` exists and exports `mountUi(world, root)`, it gets the world and the `#ui` element
and decides when to call `world.start()`. If it does not exist the world starts straight into walking
and shows one small prompt line of its own when a caption is in reach.

If the browser has no WebGL 2 the world is not created. The interface can export
`mountFallback(root)` to show the list version; otherwise a plain sentence is shown.

## URL switches

All optional, all combine.

| Switch | What it does |
| --- | --- |
| `?d=studio` | Start at that district's arrival point, facing in. |
| `?solo=studio` | Build only that district. Quick when working on one place. |
| `?still=1` | Hold the clock at zero: no sway, no bobbing, no boil. Two loads give the same picture. Walking still works. |
| `?q=low` `medium` `high` | Pin the quality tier. Without it the tier is guessed and resolution adapts. |
| `?debug=1` | Readout of draw calls, triangles, frame time, pixel ratio and tier. Colliders drawn as red dithered shapes. |
| `?cam=x,y,z,tx,ty,tz` | A fixed camera at the first point looking at the second. The haze is pushed back to suit the distance. |
| `?yaw=90` | Face this way on arrival, in degrees. 0 is north, 90 is west. |
| `?ui=0` | Skip the interface even when it exists. |

District ids: trailhead, switchboard, commons, terraces, maskgarden, observatory, studio, greenhouse,
skyharbor, boneyard, postcards.

In the console, `window.__world` is the world. The typed part is `WorldApi` in `src/types.ts`
(`start`, `setPaused`, `teleport`, `player`, `stats`, `setQuality`, `visited`, `touchRoot`, `on`).
On top of that there are helpers for looking around:

```
__world.teleport('observatory')
__world.teleport({ x: 0, z: 0 }, Math.PI)
__world.stats()                    // calls, triangles, fps, frameMs, pixelRatio, tier
__world.costs()                    // calls and triangles of each district on its own
__world.built()                    // districts standing so far
__world.poi()                      // the caption in reach, or null
__world.spots()                    // every point of interest, world space
__world.setFreeCamera([400, 95, 470], [0, -45, -10])   // null gives the view back
__world.showColliders(true)
__world.nearColliders()            // the colliders gathered around him this frame
__world.districtColliders('commons')   // one district, already in world space
__world.budget.calls = 60          // lower the frame budget to watch the culling work
__world.openEntry(id)              // does nothing until the interface takes it over
```

## Screenshots

`scripts/shot.mjs` drives a headless Chromium through Playwright. It needs the dev server running and
Playwright installed globally (it is not a dependency of this project).

```
node scripts/shot.mjs --port 5173 --d studio --out .shots/studio.png
node scripts/shot.mjs --port 5173 --d studio --solo --stats
node scripts/shot.mjs --port 5173 --d commons --yaw 120 --size 1600x900
node scripts/shot.mjs --port 5173 --cam 400,95,470,0,-45,-10 --out .shots/over.png
node scripts/shot.mjs --port 5173 --tour --dir .shots/tour
```

It always opens with `still=1`, pins `q=high` unless told otherwise (software GL would guess low),
skips the interface unless `--ui` is given, and waits until the world is ready and the district asked
for is built. `--stats` prints `stats()` and the per-district costs as JSON. `--debug` adds the readout
and the red colliders. `--wait 1000` gives it longer to settle.

`--tour` stands at the arrival point of every district in turn, then takes one high overview, and
prints a table of draw calls and triangles for each picture against the budget. Run it before and
after any change that adds geometry.

Headless Chromium draws in software, so frame times mean nothing there. Judge the pictures, the draw
calls and the triangles. Everything under `.shots/` is ignored by git.

## Adding a district

A district is one file, `src/districts/<id>.ts`, where `<id>` is one of the ids above. Export a
`DistrictModule` named `district` (a default export works too):

```ts
import * as THREE from 'three';
import type { DistrictModule } from '../types';
import * as geo from '../engine/geo';

export const district: DistrictModule = {
  id: 'studio',
  build(ctx) {
    const b = ctx.kit.builder();
    b.add(geo.box(4, 3, 4), { color: ctx.palette.brick, pos: [0, 0, 0] });
    const group = new THREE.Group();
    group.add(b.build('studio'));
    return {
      group,
      colliders: [{ kind: 'box', x: 0, z: 0, hw: 2, hd: 2 }],
      pois: [{ entry: ctx.entries[0].id, x: 0, z: 3.5 }],
    };
  },
};
```

Nothing else needs touching. `src/districts/index.ts` finds the file by name. A district with no file,
or whose file throws, gets the placeholder: a lettered gate, a tall landmark in the site's accent
colours, and one caption stone per entry. So the world is always walkable end to end.

Rules of the space:

- Build around the origin with y = 0 on the pad. The world puts the group at the site centre and pad
  height and never rotates it. x is east, z is south.
- The pad is flat out to 0.82 of `site.radius`. The road arrives at `site.arrive` (0.6 of the radius
  out), so keep that spot and the line from it to the centre clear.
- `ctx.groundAt(x, z)` is the ground height relative to the pad, for anything that steps off the flat.
- `ctx.rng` is seeded from the district id. Use it, not `Math.random`, so the place is the same on
  every load.
- `ctx.entries` are the captions that belong here. Give each one a point of interest. `x`, `z` are
  local, `y` is the marker height above the ground (2.4 by default), `reach` is how close the visitor
  has to stand (4.5).
- `ctx.sun` is the direction toward the sun, for baked ground shadows.
- Colliders are circles or boxes in local space. A box `rot` turns the same way as `rotation.y`.
- `update(dt, t, player)` runs only while the visitor is within the radius plus 60 m, with his position
  in local space. Do not allocate in it.
- Only kit geometry and the one ink material. No lights, no other materials, no textures.

Look at one district on its own with `?solo=<id>&debug=1`, then run the tour.

## Budgets

| What | Limit |
| --- | --- |
| Whole picture | under 150 draw calls and 400,000 triangles |
| One district | at most 12 draw calls and 40,000 triangles |
| Terrain | at most 70,000 triangles |
| Sky | 7 draw calls |
| Scatter | at most 10 draw calls |
| Placeholder district | 2 draw calls, about 3,000 triangles |

One `build()` or `kit.instances()` is one draw call. The ink pass adds one.

The world keeps the picture inside the budget by itself. Each frame it sorts the districts by distance
from the eye, skips those off screen, and draws the nearest until the next one would break the budget.
It sets aside 48 calls and 165,000 triangles for the ground, sky, scatter, the figure and the markers
(`RESERVE` in `src/engine/world.ts`, measured with nothing else in view). The nearest district on screen
is always drawn. Districts are also dropped past a distance that depends on the tier: 250 m on low,
330 m on medium, 440 m on high. If far districts start popping in and out while turning, the tour
table will show which ones are too heavy.

Measured with all eleven districts as placeholders, 1280 by 720, high tier: 35 to 53 draw calls and
89,000 to 159,000 triangles from the arrival points, 68 calls and 188,000 triangles from the overview.
