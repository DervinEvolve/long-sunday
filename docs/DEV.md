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

Measured with all eleven districts built, 1280 by 720, high tier: 43 to 75 draw calls and 161,000 to
350,000 triangles from the arrival points, 79 calls and 376,000 triangles from the overview. The
heaviest districts on their own are Sky Harbor (9 calls, 38,400 triangles) and the Mask Garden (7 calls,
36,800). The overview sits close to the triangle limit, so anything added to the ground, sky or city
has to come out of somewhere else.

## The second look

The world has two looks. `ink` is the drawing and what every page opens in. `real` is the same place
as if it had been built from the same blueprints and photographed late in the day. The pipeline that
makes the real look's files is in `docs/REAL.md`. This section is about the page.

```ts
world.look()              // 'ink' or 'real'
world.lookAvailable()     // false in the single file build, from disk, or on a device that cannot draw it
world.setLook('real')     // a promise: resolves when that look fills the screen
world.on('look', (e) => {})   // { look, state: 'loading' | 'on' | 'failed', progress? }
```

`?look=real` in the address starts the switch as soon as the world is ready. The page still opens as
the drawing and crosses over when the files are in.

What I hold myself to:

- The ink look pays next to nothing: 2.9 kB gzipped in the first bundle, for the switch itself.
  Everything else is in `src/real/` behind one dynamic import in `src/engine/world.ts`. No file
  under `real/` is asked for, and not a line of that code is loaded, until the first
  `setLook('real')`. Asking `lookAvailable()` fetches nothing.
- The switch is in place. Same spot, same camera, the walk goes on. The first switch loads the
  manifest, the sky, the base set (ground, city, far sky) and the district nearest the visitor, then
  the picture crosses over in 0.6 seconds, spreading out from where he stands. The 0.6 seconds are
  on the wall clock, not the frame step (which is capped at a tenth of a second), so a slow device
  does not stretch it. With reduced motion it is a cut. The other districts stream in by distance
  after that.
- There is never a hole. Until a district's baked files arrive it is drawn from the ink geometry with
  a stand-in material that reads the same vertex attributes. Everything that moves is always drawn
  that way: the figure, the markers, the train, the whale, flags. A mesh the manifest does
  not name at all is newer than the bake, and it is drawn the same way. A change inside a mesh the
  bake already covers does not show until the pipeline bakes that district again.
- `setLook` can be called at any time, twice, or during a load. The last call wins and every promise
  settles when it lands, so after a promise resolves ask `look()` which look that was. When the files
  cannot be loaded the world stays in the drawing and the promise rejects with a sentence that can be
  shown as it is. The base set has to load. A district that fails keeps its stand-in and is tried
  again twice. A shared texture that fails (a 404, a bad picture) does not stop anything: the
  surfaces that use it are drawn flat, the console says so once, and the file is asked for again by
  the next chunk that needs it after 20 seconds.
- During the 0.6 seconds of a change-over both looks are drawn, so those frames cost about the two
  added together.
- Going back to the drawing keeps the real look's files on the graphics card for a short while (10
  seconds on low, 25 on medium, 45 on high), so flipping back and forth is instant. Then they are
  freed and the card holds what it held before: the same textures and shader programs, and the same
  geometry once the drawing has drawn its own meshes (the real look draws further, so it can send
  some of the drawing's meshes to the card a little early).
- Each district keeps its own sky. The drawing gives the Switchboard an amber sky, the Mask Garden a
  red one, Sky Harbor teal, the Studio pink, Postcards peach. The built look takes the same blend of
  palettes the drawing uses where the visitor stands and leans the open sky toward it, after the
  tone curve, most at the horizon and least round the sun. The haze takes the horizon's colour too.
  The drawn clouds stay in the drawing: the built sky is clear.

### Tiers

| | low | medium | high |
| --- | --- | --- | --- |
| Files | half size lightmaps and textures | full size | full size |
| Samples per pixel | 1 | 4 | 4 |
| Sun shadow map for what moves | none, a soft patch under his feet | 1024 | 2048 |
| Bloom | no | no | yes |
| Memory ceiling for baked chunks | 100 MB | 230 MB | 340 MB |
| Triangles in a frame, at most | 480,000 | 600,000 | 700,000 |

A phone or tablet, and any device that reports 4 GB of memory or less, gets the half size files on
every tier, and with them the 100 MB ceiling. Which files to fetch is decided at the first switch.
A tier change after that turns bloom, the shadow map and the extra samples on or off at once and
leaves the files alone.

The quality governor keeps a tier and a resolution for each look (`quality.setLook` in
`src/engine/quality.ts`). The real look costs more to draw, and what it teaches the governor stays
with it: coming back to the drawing brings back the drawing's own tier and resolution. A tier pinned
in the settings holds in both.

### Budgets

The real look has its own ceiling: 250 draw calls and 700,000 triangles on high (`REAL_BUDGET` in
`src/engine/world.ts`). The culling is the same code as for the drawing. It asks the real look what a
district costs right now: the baked chunk plus that district's moving parts when the chunk is in, the
ink geometry when it is not. The base set is 268,000 triangles and 74 draw calls on the golden hour
bake and is always there. `stats()` and `costs()` report what is on screen in either look.

### Looking at it

`?debug=1` shows which look is on beside the counts. In the console:

```
await __world.setLook('real')
__world.realInfo()        // chunks loaded, loading, failed; megabytes held; bloom, shadows, samples; mix; reserve
__world.gpu()             // geometries, textures and programs as three.js counts them
__world.holdLook(0.5)     // stop the next change-over half way, null lets it finish
__world.dropReal()        // back in the drawing: free the real look's files now, without the wait
__world.realBudget.triangles = 500000
__world.realTune('uShine', [1, 1, 2, 1])   // mirrored sky, sun glint, closed-in power, horizon
__world.realTune('uAo', 0.4)               // how much the joints shade
__world.realTune('uTint', [0.75, 0.35, 0.4])  // district sky: share at the horizon, overhead, brightness kept
__world.realTune('uExposure', 1.3)         // exposure of the output pass (manifest 1.25 times my trim 1.04)
__world.realTune('clouds', 1)              // bring the drawn clouds back, to look at them
```

`scripts/shot.mjs` takes its picture as soon as the world is ready, so for the real look open the
page with `?look=real` and wait for `__world.realInfo().loading.length === 0` before the shot.
Under software GL the first switch takes about half a minute and every district is in after two to
six minutes. I have not timed it on a graphics card. A Playwright screenshot waits on the compositor,
which is slow there; `.shots/real/pr-lib.mjs` reads the canvas inside the frame that drew it
instead, which is several times quicker.

## The locked copy

The hosted page has a password. The copy that goes on a public address holds only an unlock screen
and the whole application sealed inside it. View source shows no caption, no name of an employer and
no code of the world, only the unlock page and a block of sealed text.

### Build it here

```
LONG_SUNDAY_PASSWORD='five or six random words' npm run build:locked
npm run preview:locked     # http://localhost:4174
```

`build:locked` runs the single file build, then `scripts/lock.mjs` wraps `dist-single/index.html`
into `dist-locked/index.html`. That one file is the site. It also opens straight from disk.

The password comes from the environment and nowhere else. It has to be at least 12 characters.
Spaces at either end are dropped, at build time and in the page, so a stray space from a paste does
no harm. Without a password, or with a short one, the build stops before Vite runs, exits with an
error and leaves no `dist-locked` behind. The script never prints the password or writes it anywhere.
To keep it out of the shell history, read it in first:

```
read -rs LONG_SUNDAY_PASSWORD && export LONG_SUNDAY_PASSWORD
npm run build:locked
```

What the script does: gzip the application, make a key from the password with PBKDF2 (HMAC-SHA-256,
600,000 rounds, a new random 16 byte salt every build), seal the gzip with AES-256-GCM under a new
random 12 byte nonce, and put salt, nonce, round count and sealed bytes into the unlock page as
base64 in one JSON script tag (`#ls-box`). The unlock page is written by hand in `src/lock/`
(`lock.html`, `lock.css`, `lock.js`) and inlined as it is. Both sides use the standard Web Crypto API.
Before it writes anything the script opens its own result again and checks that no part of the
application and no password can be read in it.

In the page, a right password opens the box and the page writes the application over itself, so it
runs exactly as the single file build does, at the same address. A wrong password and a damaged file
both get the same line: "That is not it. Try again."

### Host it on GitHub Pages

1. Repository, Settings, Secrets and variables, Actions: add a repository secret named
   `LONG_SUNDAY_PASSWORD`.
2. Settings, Pages: set the source to "GitHub Actions".
3. Actions, "Deploy locked copy to Pages", Run workflow.

The workflow (`.github/workflows/pages.yml`) only runs when started by hand. It builds the locked
copy and uploads `dist-locked`, nothing else. With the secret missing the build step fails and
nothing is deployed. Pages from a private repository needs a paid GitHub plan. On the free plan,
use Vercel.

A project site without a custom domain lives at `<user>.github.io/<repo>/`, the same address as
every other Pages site on the account. That matters for "Stay unlocked", see below.

### Host it on Vercel

1. In Vercel, import the private repository. `vercel.json` already says what to build
   (`npm run build:locked`) and what to serve (`dist-locked`), with no framework preset.
2. Project, Settings, Environment Variables: add `LONG_SUNDAY_PASSWORD` for Production and mark it
   sensitive. Add it for Preview too if branch previews should build. Without it a build fails and
   nothing is published.
3. Deploy.

Vercel builds again on every push. `vercel.json` also sets three headers: the page is checked for a
newer copy on every visit, `nosniff`, and a referrer policy of `no-referrer`. GitHub Pages cannot set
headers, so the unlock page carries the same referrer policy in a meta tag. It also asks search
engines not to list it.

### The one click link

Put the password in the fragment:

```
https://example.org/long-sunday/#k=five-or-six-random-words
https://example.org/long-sunday/#k=five-or-six-random-words&d=studio
```

The page takes `k` out of the address bar before it does anything else, keeps the other parts
(`#d=` and `#e=` still work) and opens. It does the same when a key link is followed in a tab that
already shows the page, locked or open. A browser never sends the fragment to the server. If the
key in the link is wrong the form shows, with no error. A password made of letters, digits and
hyphens can go in as it is. Anything else has to be encoded first:

```
node -p 'encodeURIComponent(process.env.LONG_SUNDAY_PASSWORD)'
```

Out of the address bar does not mean gone. The browser still keeps the full link, key included, in
its history and its restore-tabs list, and it syncs it if sync is on. Anyone who uses that browser
can find it there, and address bar suggestions can show it. No page can take a link out of the
browser's history. Mail link scanners and link shorteners can also rewrite the whole URL, fragment
included, into a query string that reaches their servers. Where any of that matters, send the plain
address and give the password another way.

### Stay unlocked

The box under the field, off by default, keeps the derived key (never the password) in this
browser's localStorage under `long-sunday.lock`, tied to the salt of the build it opened. Every
build has a new salt, so every new deploy asks for the password again, even when the password has
not changed. To lock a device again, clear the site's data in the browser, or run
`localStorage.removeItem('long-sunday.lock')` in the console.

The stored key opens the current build without the password, so it is only as private as this
site's storage. On GitHub Pages without a custom domain, every Pages site on the account shares this
storage, so only use Stay unlocked there if this is the only one, or use Vercel or a custom domain.

### Side files (`real/`)

Files the world fetches while it runs go in `public/real/`. `build:locked` seals every file under
`public/real/` with the same key into `dist-locked/real/`, at the same paths with `.sealed` added
(`real/chunks/studio.glb.gz` becomes `real/chunks/studio.glb.gz.sealed`, so no host takes a sealed
file for gzip and tries to open it on the way out). Nothing else is read:
`build:locked` never writes `dist/`, so a `dist/real/` on disk is left over from an older build and
stays out. Each file gets its own nonce, stored in front of the sealed bytes. `.glb`, `.webp`, `.ktx2`, `.avif`,
`.jpg` and `.png` go in as they are, everything else is gzipped first. File names stay readable. The
contents do not.

The contract is one line. In the locked build `window.__lsAsset(path)` exists before the world
starts. It takes a path relative to the page, fetches the sealed file, opens it and resolves with
the plain bytes as an `ArrayBuffer`. It rejects with an `Error` when the file is missing or does not
open. In a plain build it does not exist, so:

```ts
const bytes = await (window.__lsAsset?.(path) ?? fetch(path).then((r) => r.arrayBuffer()));
```

The type is in `src/lock/asset.d.ts`. Side files need a server. A page opened from disk cannot fetch
them, locked or plain.

### What the lock does and does not do

- The sealed file is public. Anyone can download it and try guesses against it for as long as they
  like, at their own pace, and nothing can slow them down or lock them out. The lock is exactly as
  strong as the password. Use a long passphrase of five or six random words.
- Anyone who has the password can pass it on. The same goes for the one click link: the link is the
  password, and it stays in a resume, an email or a chat for as long as those exist.
- The one click link also stays in the browser that opened it: in its history, in its restore-tabs
  list, and on the visitor's other devices if sync is on. Anyone who uses that browser can find it
  there. A mail link scanner or a link shortener can pass the whole link, key included, to its own
  servers.
- "Stay unlocked" leaves a key in the browser that opens the current build with no password. Any
  script that runs at the same address can read it. On GitHub Pages without a custom domain that
  includes every other Pages site on the account.
- Changing the password means building and deploying again. The old copy, if someone saved it,
  still opens with the old password.
- The unlocked copies made by `npm run build` and `npm run build:single` must not be hosted in
  public if the lock matters.
- The repository has to stay private for the same reason. A public repository holds every caption
  in plain text, and the lock would then guard only the hosted link.
- Once the page is open, everything in it is open: a visitor can save what they see.
