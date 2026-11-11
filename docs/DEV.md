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
and shows one small prompt line of its own when a caption is in reach. The interface ships in the
first bundle and mounts the moment the world object exists, so the title card is up before the
ground is built. Until the script has run, `index.html` shows one plain line (`#boot`), which
`main.ts` removes.

If the browser has no WebGL 2 the world is not created. The interface can export
`mountFallback(root)` to show the list version; otherwise a plain sentence is shown.

## URL switches

All optional, all combine.

| Switch | What it does |
| --- | --- |
| `?d=studio` | Start at that district's arrival point, facing in. |
| `?solo=studio` | Build only that district. Quick when working on one place. |
| `?still=1` | Hold the clock at zero: no sway, no bobbing, no boil. Two loads give the same picture. Walking still works. |
| `?q=low` `medium` `high` | Pin the quality tier and hold the resolution at that tier's ceiling. Without it the tier is the one saved in the settings, or a guess, and resolution adapts. |
| `?debug=1` | Readout of draw calls, triangles, frame time, pixel ratio and tier. Colliders drawn as red dithered shapes. |
| `?cam=x,y,z,tx,ty,tz` | A fixed camera at the first point looking at the second. The haze is pushed back to suit the distance. |
| `?yaw=90` | Face this way on arrival, in degrees. 0 is north, 90 is west. |
| `?ui=0` | Skip the interface even when it exists. |

District ids: trailhead, switchboard, commons, terraces, maskgarden, observatory, studio, greenhouse,
skyharbor, boneyard, postcards.

In the console, `window.__world` is the world. The typed part is `WorldApi` in `src/types.ts`
(`start`, `setPaused`, `teleport`, `player`, `stats`, `setQuality`, `setReducedMotion`,
`reducedMotion`, `visited`, `touchRoot`, `on`). On top of that there are helpers for looking around:

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

## Quality and reduced motion

The tier decides how much is built: terrain detail, how much city, how many clouds, how detailed
each district and the figure are. All of that is built once, from the tier the page starts with.
So the order at start matters: `boot()` in `src/main.ts` reads the choice saved by the settings
panel (localStorage `long-sunday.settings`, field `quality`) before it makes the world, and a
`?q=` in the address wins over that.

`world.setQuality(tier or 'auto')` while the page is open rebuilds nothing. What follows at once:
the ink line settings, the draw distance and the haze that goes with it, the pixel ratio, and the
triangle budget when the new tier is below the one the world was built for (260,000 on low, 320,000
on medium, so far districts drop out sooner and a struggling device gets relief straight away). The
full detail level of the new tier applies from the next load.

A tier picked in the settings is a ceiling for the tier only. Resolution keeps adapting under it, so
choosing Low is never heavier than Auto was. Phones and tablets start at a pixel ratio of 1 and climb
while frames stay on time.

`world.setReducedMotion(true)` stills what moves by itself: plant sway and the boiling paper grain
stop, the title camera holds still, the swing from the title framing into play is a cut, and the arm
keeps one length at a run. Clouds, markers, the train and every district's `update()` run on a clock
slowed to a twentieth, so they creep. His walk and the follow camera are untouched. The world reads
`prefers-reduced-motion` once at start for the default.

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
  The world measures how tall the geometry inside each footprint is. The camera stops at a wall and
  rides over a bench, so put a collider under everything solid and nothing under open air. Posts
  thinner than half a metre only cross the picture: they pull the camera in when the lens itself
  would end up inside one, and not otherwise.
- `update(dt, t, player)` runs only while the visitor is within the radius plus 60 m, with his position
  in local space. Do not allocate in it. Drive all motion from `dt` and `t`: with reduced motion on,
  both come from the slowed clock.
- Everything stays inside `site.radius`. If something has to reach further than the radius plus 35 m
  (a pier, something adrift), return `cullRadius` with the build so it is not culled while still in
  view. The world also measures the built geometry and widens the sphere to fit, plus 8 m.
- Only kit geometry and the one ink material. No lights, no other materials, no textures.

Look at one district on its own with `?solo=<id>&debug=1`, then run the tour.

## Budgets

| What | Limit |
| --- | --- |
| Whole picture | under 150 draw calls and 400,000 triangles |
| One district | at most 12 draw calls and 40,000 triangles |
| Terrain | at most 70,000 triangles |
| Sky | 9 draw calls |
| Scatter (the city) | 18 draw calls |
| Placeholder district | 2 draw calls, about 3,000 triangles |

One `build()` or `kit.instances()` is one draw call. The ink pass adds one.

The world keeps the picture inside the budget by itself. Each frame it sorts the districts by distance
from the eye, skips those off screen, and draws the nearest until the next one would break the budget.
It sets aside what the ground, sky, city, the figure, the markers and the ink pass cost, counted from
the meshes when the build finishes (`reserve` in `src/engine/world.ts`): 58 draw calls on every tier,
and about 118,000 triangles on low, 168,000 on medium, 202,000 on high. That is everything, in view or
not, so it errs on the safe side. The nearest district on screen is always drawn. Districts are also
dropped past a distance that depends on the tier: 250 m on low, 330 m on medium, 440 m on high, and the
haze closes in to match so they arrive pale. If far districts start popping in and out while turning,
the tour table will show which ones are too heavy.

Measured with all eleven districts built, 1280 by 720, high tier: 47 to 78 draw calls and 157,000 to
369,000 triangles from the arrival points, 84 calls and 396,000 triangles from the overview. The
heaviest districts on their own are Sky Harbor (9 calls, 38,400 triangles) and the Mask Garden (7 calls,
36,800). The overview sits close to the triangle limit, so anything added to the ground, sky or city
has to come out of somewhere else.
