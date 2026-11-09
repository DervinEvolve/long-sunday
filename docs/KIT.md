# The kit

Everything in Long Sunday is drawn by one material and inked by one full screen pass. The kit is
how you get geometry into that material. If you build things any other way they will not get an
ink line, will not be lit, and will look wrong.

Try things on the test page: `npx vite`, then `/dev/kit.html`. Add `?cam=0..3` for the fixed
views, `?still=1` to freeze sway and grain, `?tier=low|medium|high`, `?px=2`.

## The short version

```ts
import * as geo from '../engine/geo';

const kit = ink.kit;
await kit.ready;                       // only matters if you use label()

const b = kit.builder();
const hut = b.add(geo.dome(3, 14, 5, 0.8), { color: P.teal, pos: [0, 0, 0] });
b.add(geo.cylinder(0.05, 0.05, 0.9, 6), { color: P.brass, pos: [0, 2.4, 0] });
b.label({ text: 'OPEN', size: 0.3, pos: [0, 1.2, 3.05], plate: P.bone });
scene.add(b.build('hut'));             // one mesh, one draw call
```

A builder bakes any number of parts into one mesh. One builder, one draw call, however many
parts, colours and labels went in. Build a whole street in one builder if it never moves.

## builder.add(geometry, opts)

Takes any indexed or plain BufferGeometry with normals. Returns the outline id it used.

| option | what it does |
| --- | --- |
| `color` | Fill colour. `0xRRGGBB` or a CSS string. Comes out on screen as that exact hex when lit. |
| `gradient` | `{ bottom, top }`. Runs from the lowest vertex of the part to the highest. Replaces `color`. |
| `pos`, `rot`, `scale` | Placement inside the builder. `rot` is Euler XYZ in radians. |
| `id` | Outline group. See below. Omit for a fresh one. |
| `flat` | 0..1. How much the part ignores light. 1 is a poster colour that never goes into shade. |
| `hatch` | 0..1. Extra hatching on top of what the light gives. |
| `dither` | 0..1 coverage. Below 1 the part is a screen door. Glass, cloud floors, portals. |
| `sway` | 0..1. Wind. Grows with height above the lowest vertex of the part. |
| `swayBase` | Height that sway is measured from, when trunk and crown should bend as one plant. |
| `outline` | `false` removes the ink line around and inside the part. Decals, soft things. |

The builder copies what it needs, so one geometry can go into many `add` calls. The simple shapes
in `geo` are cached by their arguments: ask for the same box twice and you get the same object
back. Never change one in place and never dispose one. `extrude`, `lathe` and `tube` are only
cached if you pass a `cacheKey`.

## Outline ids

The ink line is drawn wherever two neighbouring pixels have different ids, wherever the surface
turns a sharp corner, and wherever there is a step in depth.

* Every `add` without an `id` gets a new id, so every part is outlined against every other part.
* Parts that share an id get no line where they meet. Use this for things that should read as one
  mass: the rocks of one cliff, the puffs of one bush, a wall and its buttress.
  `const cliff = b.newId();` then pass `id: cliff` to each rock.
* Sharp corners inside a part still get a line. That is what draws the facets of a rock. If you
  want a smooth blob with a silhouette only, give it smooth normals (`geo.sphere`, `geo.blobs`).
* `outline: false` means no line at all, including against the things around it.

Ids wrap at 251. Two different things can land on the same number, and if they also touch on
screen with the same facing and no depth step you lose that one line. It is rare and nobody has
noticed it yet. Do not try to manage id numbers by hand.

## Light, shade and hatching

There are no lights. The material knows the sun direction and gives every surface one of three
tones: light (the authored colour), half light, and shade (pulled toward the violet shadow colour
of the palette). Shade also gets diagonal violet hatching. The hatching is stuck to the object, it
does not swim when the camera moves, and it keeps the same spacing on screen at any distance.

* `flat: 1` for things that should be the same colour from every side: signs, awnings, painted
  marks, anything emissive looking.
* `flat: 0.5` softens the shade without removing it.
* `hatch: 0.3` adds a light hatch even in sunlight. Good for rough rock, old walls, dirt.
  Above about 0.95 total you get cross hatching. Keep big areas under 0.4 or the page gets grey.
* Surfaces darker than the shadow violet are hatched darker, not lighter.

Shading uses the face normal as given. Flat shaded geometry gives hard facets, smooth normals give
a soft terminator. `geo.creased(g, degrees)` gives you both: smooth under the angle, hard above it.

## Gradients

`gradient: { bottom: P.sand, top: P.rose }` paints a vertical ramp across one part. It is per
vertex, so a box gets a clean ramp and a tall cylinder with no rings gets a clean ramp too. Use it
for mesas, towers, cloth. It costs nothing.

## Dither

`dither: 0.5` draws half the pixels in a fixed 4x4 pattern. You see through it and it sorts
correctly with everything, because nothing is actually blended. A dithered part draws no ink line
of its own, so give glass a frame. Things behind it keep their own lines. Use `flat: 1` with it,
shade on a screen door looks like dirt.

Coverage steps are coarse (16 levels). 0.5 is the cleanest, it is a pure checkerboard.

## Sway

`sway: 1` moves the top of the part about 0.7 m in the wind, the base not at all. Weight reaches
full at 6 m above the base (`SWAY_HEIGHT`). For a plant made of several parts pass the same
`swayBase` (usually the ground height) to each so the crown moves with the trunk and does not
slide off it. Sway is done in the vertex shader, it costs nothing per frame.

## builder.label(opts)

Hand lettering from the shared atlas (Architects Daughter). No extra draw call, no canvas per
sign. `await kit.ready` once before the first label or you get blank glyphs.

```ts
b.label({ text: 'LONG SUNDAY', size: 0.6, pos: [0, 5.2, 0.52], plate: P.stone, id: archId });
```

* `size` is the height of a capital letter in metres. `pos` is the middle of the block, the text
  faces +z before `rot`.
* With `plate` you get a coloured card behind the letters and smooth letter edges.
* Without `plate` the letters are cut out and sit on whatever is behind. Cut out letters have hard
  pixel edges. Fine for big painted words, poor for small print.
* The best looking lettering on a wall: pass `plate` equal to the wall colour and `id` equal to
  the wall id. The card disappears and you keep the smooth letters. Match `flat` to the wall too.
* `maxWidth` wraps. `align` is left, center or right. `anchor` says which part of the block sits
  on `pos`, so `align: 'left', anchor: 'center'` is a ragged right paragraph centred on a sign.
* `lineHeight` (1.7), `pad` (0.55), `lift` (0.02 m off the surface), `jitter` (0.5, how much the
  letters bob and tilt).
* `b.measure({ text, size, maxWidth })` returns `{ width, height, lines }` so you can cut the
  board to fit the words.

A 0.6 m capital reads cleanly from 3 m and is still readable at 30 m. Small print fades into a
grey line with distance, which is what you want.

Any character the font has will work. The atlas is one 1024 square that fills as new characters
turn up, room for well over a hundred. If it ever fills you get a console warning and a "?".

## builder.shadow(geometry, opts)

A flat shadow on the ground. Pass the same geometry and the same `pos`, `rot`, `scale` as the
`add`, plus `color` and `sun`. The shape is slid along the sun onto `y` (default 0) and lifted 2 cm.

```ts
b.shadow(g, { color: SHADE, sun: sunDir, pos, rot });
```

It is baked. It does not follow the sun and it does not fall on anything but flat ground. Pick a
shadow colour by mixing the ground colour toward `palette.shadow` by about 0.3. There are no
shadow maps and there will not be.

## kit.instances(geometry, count, opts)

For many copies of one thing. One draw call for all of them.

```ts
const stools = kit.instances(stoolGeo, 100);
stools.setMatrixAt(i, m);
stools.setColorAt(i, color);           // optional tint
stools.instanceMatrix.needsUpdate = true;
scene.add(stools);
```

* Every instance gets its own outline automatically.
* Plain geometry is treated as one white part. `opts.color`, `flat`, `hatch`, `dither`, `sway`
  apply to the whole shape.
* For a many coloured instance, make it in a builder and call `b.geometry()` in place of
  `b.build()`, then pass that to `instances`.
* `setColorAt` multiplies the baked colour. White leaves it alone. Bake the parts you want to
  tint in white.
* three works out the culling sphere of an InstancedMesh once. If you move instances a long way
  later, call `mesh.computeBoundingSphere()`.

## geo

Small helpers that return plain geometry sized in metres.

* Standing solids sit on y = 0: `box`, `bevelBox`, `cylinder`, `cone`, `prism`, `hex`, `dome`,
  `capsule`, `arch`.
* Round things are centred on the origin: `sphere`, `ico`, `torus`, `rock`, `blobs`.
* `plane(w, h)` is an upright card facing +z. `disc` and `ring` lie flat facing up.
* `rock(seed, r, detail, lump, facet)` is the faceted boulder. `blobs(seed, count, radius)` is the
  cloud or bush shape.
* `extrude(outline, depth, { holes })`, `lathe(profile, seg)`, `tube(points, radius, { sag })`,
  `hull(points)` for everything else. `join(parts)` merges.
* `seeded(n)` is the random source. Always use it, never `Math.random`, so the world is the same
  on every load.

## What costs a draw call

* One per `build()`.
* One per `instances()`.
* One for the ink pass, always.

Nothing else. Labels, colours, gradients, dither, sway, shadows and hatching are free. Triangles
are what you pay for, and the ink pass costs the same whatever is on screen.

## How to animate

* Move, rotate or scale the built mesh. A door is its own small builder on its own mesh.
* For crowds, write matrices into an InstancedMesh and set `instanceMatrix.needsUpdate`. Reuse
  one scratch Matrix4. No allocation per frame.
* Wind is `sway`. Do not animate vertices yourself.
* Day and night is `ink.setSky`, `ink.setSun`, `ink.setFog`. Pass numbers, not strings or new
  Colors.
* Hatching is anchored to the object, so a rotating thing carries its hatch round with it.

## Do not

* Do not use any other material. No MeshBasicMaterial, no sprites, no lines, no points. They skip
  the id buffer and the ink pass will draw nonsense round them.
* Do not add three.js lights or turn on shadow maps. They do nothing here.
* Do not set `scene.background` or `scene.fog`. Sky and haze are painted by the ink pass.
* Do not use transparency. Use `dither`.
* Do not make geometry thinner than about 2 cm if it matters. Under a pixel it flickers. Wires
  should be `geo.tube` with a radius of 0.03 or more.
* Do not put text in a texture of your own. Use `label`.
* Do not build a mesh per small prop. Batch in a builder, or instance.
* Do not call `builder()`, `add` or `build` inside the frame loop.

## Tuning the look

The numbers that decide the page are in `LOOK` at the top of `src/engine/ink.ts`: line width,
wobble, the two light band thresholds, hatch spacing and strength, haze, how faint far lines get,
grain. Change them there and check all four views of the test page before keeping anything.
