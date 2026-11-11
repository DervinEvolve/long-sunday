# The real look

Long Sunday has two looks of the same place. The ink look is the drawing. The real look is the
same world as if it had been built from the same blueprints and photographed late in the day.
One button swaps them where the visitor stands.

Blender is my offline studio for the real look. A script takes the world's geometry out of the
running page, Blender sorts every surface into a real material, adds the detail a drawing leaves
out, and path traces the light once into lightmaps. The browser only shows the result: glTF chunks,
a lightmap on the second uv set, a small shared library of tiling textures on the first, and a sky
for reflections. Standard three.js materials. No real time global light.

The whole world rebuilds from one command, so when a district changes I run it again and only the
chunks that changed are baked again.

Everything the browser fetches lives in `public/real/` (Vite copies it to `dist/real/`). The ink
look never touches those files, so it is no slower and no bigger for their being there.

This file is for two readers: me, when I rerun the pipeline, and whoever writes the browser side.
The browser side needs only the sections "What is in public/real", "The manifest" and "Drawing it".

## Run it

```
npm run real:all        # export, textures, bake, pack
```

The four steps, each on its own:

| Step | Command | What it does | Time here |
| --- | --- | --- | --- |
| Export | `npm run real:export` | Opens the dev page in headless Chromium, notes what moves, writes one glTF per chunk | 1.5 to 2.5 minutes |
| Textures | `npm run real:textures` | Downloads the twelve CC0 texture sets once, sizes them, writes `CREDITS.md` | Under a second. The first run downloads about 140 MB |
| Bake | `npm run real:bake` | Sorts materials, adds detail, unwraps, bakes light with Cycles | About 30 minutes for everything (see the table at the end). A few seconds when nothing changed |
| Pack | `npm run real:pack` | Compresses geometry and images, writes `manifest.json` | 17 seconds for everything, 2 when little changed |

Times are from this machine: four cores with no graphics card, three threads for Cycles, and other
people's work running on it the whole time. A Cycles picture at 1280 by 720 and 64 samples takes
2.5 to 4 minutes.

Each step keeps what it made and only redoes what changed:

- Export always runs in full. It is quick, and its output is hashed per chunk.
- A chunk is built again when its exported file, `materials.json`, its build settings or the build
  code changed. Building is quick: ten seconds for the whole world.
- A chunk is baked again when what the build made of it changed, or its bake settings, the light, or
  how a material takes light (`materials` and `plain` in `materials.json`).
- Pack rewrites a file only when its source changed, and prints what goes over the wire against
  the budgets (shared textures and sky 6 MB, base set 10 MB, one district 4 MB, everything 60 MB).
- `npm run real:bake -- --only studio,ground` bakes just those. `--force` ignores the cache.
  `--build-only` stops before the light. `--sky-only` only writes the sky.

The cache hash of a chunk covers that chunk alone. Light crosses chunk borders, so after a big change
to one district its neighbours are a little stale until they are baked again (`--force --only ...`).

Two exports of an unchanged world give the same bytes, chunk for chunk. I checked. So running
`real:all` twice bakes nothing the second time.

A change in one place should only bake that place. Two things in the ink world count across the
whole build and could spoil that. Outline ids come from one counter, so the export renumbers them per
mesh (a remade figure once sent thirteen chunks back to the bake before I did that). The lettering
atlas is shared: when a new label moves glyphs in the atlas, the chunks whose letters moved are
built and baked again. That one is real work, their uv did change.

Touch a rule in `materials.json` and the whole world is built again, but only the chunks whose
surfaces really changed are baked again, because the bake is keyed on what the build made. When I
added the rule for lawn discs, the eleven districts baked again and the ground, the city and the sky
did not. A change under `materials` or `plain` bakes everything. So do the sun, the sky and
`bakeVersion` in `settings.json`, which I raise by hand when I change how the Blender scene lights
things.

Other things I run:

```
npm run real:render -- --views all --samples 96     # Cycles pictures: the reference
npm run real:proof                                  # ink, Cycles and browser side by side
node tools/real/shot.mjs --view trailhead --out x.png   # one picture of the bare viewer
```

The bare viewer is `tools/real/viewer.html`, served by the dev server:
`http://localhost:5531/tools/real/viewer.html?view=trailhead&orbit=1&info=1`. It uses three.js, the
packed files and the manifest, and nothing from the ink engine. Its switches are listed at the top
of `tools/real/viewer.js`.

### Set up once

The system Blender here (4.0.2) has no OpenImageDenoise and its Python has no numpy, so the
pipeline uses Blender as a Python module in a virtual environment of its own:

```
python3.11 -m venv tools/real/cache/venv
tools/real/cache/venv/bin/pip install bpy==4.2.23 pillow
```

About 1 GB. `tools/real/cache/` is ignored by git and holds everything that can be made again:
the environment, the exported chunks, the build and bake results, the downloaded textures.
Playwright comes from the global install, as it does for `scripts/shot.mjs`. `meshoptimizer` is a
dev dependency.

### The files of the pipeline

| File | What it is |
| --- | --- |
| `src/real/exportScene.ts` | The export hook. Loaded by `src/main.ts` only on the dev server with `?export=1`. No build carries it. |
| `tools/real/export.mjs` | Step 1 |
| `tools/real/textures.py`, `textures.json` | The texture library and the list it is made from |
| `tools/real/bake.py` | Step 2 |
| `tools/real/blender/build.py` | Materials, leaves, uv sets. Plain numpy |
| `tools/real/blender/detail.py` | Bevels and weighted normals, through Blender's bevel modifier |
| `tools/real/blender/scene.py` | The Blender scene: materials, sky, sun, bake, denoise |
| `tools/real/blender/emit.py` | Writes chunk glTF, lightmaps and the sky |
| `tools/real/pack.mjs`, `images.py` | Step 3 |
| `tools/real/materials.json` | Which drawn surface becomes which real material. Tune by hand |
| `tools/real/settings.json` | Quality per chunk, sun and sky, cameras, port, threads |
| `tools/real/render.py`, `proof.mjs`, `shot.mjs`, `viewer.html`, `viewer.js` | Pictures |

## What the export does

The page is opened twice.

First with the clock running. The script stands in every district for a moment and compares each
mesh's place and its instances a second and a half apart. Whatever changed is something that moves.

Then with `?export=1&q=high&still=1&ui=0`. The hook walks the scene and writes, per chunk, every
mesh that does not move, in world space, with the ink attributes carried across: the authored
colour and `flat`, the outline id, hatch, dither and sway, the lettering colour and mode, the
lettering uv, and a part number per `add()` of the builder. Instanced meshes are written copy by
copy. It also saves the lettering atlas as it stands after the whole world is built, and the follow
camera at every arrival point.

The chunks: one per district (eleven), `ground` (the terrain group: land, cliff, underside, streets,
year markers), `city` (the scatter group: buildings, trees, columns, hedges, the aqueduct and street
furniture) and `sky` (the two skylines, the armillary, the floating column and pediment).

Positions are the ink world's own: x east, y up, z south, metres. In the packed files they sit on a
lattice of 1/512 m (1/256 m for a mesh wider than 128 m), so each coordinate is within a millimetre
of the ink one, two for the widest meshes. I measured it at the Trailhead: of the surfaces that get
no bevel, 99 to 100% of the vertices lie within 2 mm of an ink vertex. Bevelled stone and brass pull
their edges in by the width of the bevel, 1 to 3 cm, on purpose. Leaf cards are new geometry.

### What stays live

Things that move are left out of the baked chunks and listed in the manifest, per chunk, under
`live`. The browser keeps drawing those itself: the figure, the markers over points of interest,
the train, the clouds and the birds, the bell and the hanging prints at the Trailhead, the whale and
the krill, the wheels, the beacon light, flames, lanterns, anything a district's `update()` moves.
The list is made by watching, so a new moving thing in a district is picked up by the next export.
`settings.json` can force a path either way (`live`, `bake`, `drop`).

Two sky pieces turn or bob in the ink look and stand still in the real one: the armillary and the
floating pediment. They are forced into the `sky` chunk and listed under `stilled`.

The drawn sun and moon disc (`sky/sun-moon`) has no place in the real look. The baked sky has its
own sun. It is listed under `drop`.

Sway is a vertex shader effect in the ink look. Baked things do not sway. Trees stand still.

### Lettering

Lettering stays lettering. Every glyph quad of the ink look goes into the real chunk as it is, in a
primitive of its own with the material `lettering`. Its uv is the ink atlas uv, its `COLOR_0` is the
ink colour, and the exported atlas (`textures/lettering.webp`, white where there is ink) is its
alpha. So the words are the same words in the same hand, they are lit by the same lightmap as the
wall they sit on, and nothing has to be redrawn. The plate behind a label is ordinary geometry and
gets an ordinary material. Lettering on things that move (the rolodex cards, the tags) stays with
those live objects.

### Drawn shadows

The ink look fakes ground shadows with `builder.shadow()`: a solid squashed flat onto the ground.
The real look has real shadows, so those are dropped. They are recognised by shape (level, and about
half of their triangles wind the wrong way round), which a painted mark never is.

## What Blender adds

All of it is driven by `tools/real/materials.json` and `tools/real/settings.json`.

- **Materials.** Every part is measured (colour, the carried attributes, size, height, which way it
  faces) and the rules sort it. See "The material table".
- **Soft edges.** Stone and metal pieces above 0.7 m are welded and bevelled (2.5 to 3 cm on stone,
  1 cm on brass), biggest first, inside the triangle budget. Their normals are weighted by face
  area, so flat faces stay flat and edges catch light.
- **Relief.** Big pale walls take the coursed block texture with its normal map, at true scale.
  Smaller stone takes the dressed slab texture.
- **Leaves.** A crown or hedge that was a smooth lump becomes a dark core, shrunk a little, with
  cut-out leaf cards standing on it. The cards are sprays of leaves made from single CC0 leaves.
  In Cycles a card lets half its light through, so the one light value it gets stands for both of
  its sides. A card buried deep in a crown bakes to black and looks like a hole, so cards have a
  floor (`blockFloor`, 0.14 of open sky).
- **Painted walls and trunks.** A big painted box of a building (the pink blocks of the city, the
  cream house at the Trailhead) is clad in pale stone slabs tinted with its drawn colour. Tree
  trunks take bark whatever colour they were drawn in. In the drawing some are violet.
- **Windows.** Window panes become dark glass: nearly black, smooth, and all they show is the sky
  sliding over them. As drawn they are pale blue, and pale blue panes look like a toy.
- **Grass.** A tiling lawn texture, with patchy lighter and darker areas from low noise in the vertex
  colour, and the drawn colour showing through a little. The lawn discs drawn in the districts take
  it too.
- **First uv set.** World aligned and at true scale: each surface is flattened along the axis it
  faces most, in metres, divided by the material's metres per repeat. Brick courses line up across
  parts.
- **Second uv set.** My own unwrap. Faces that face the same way and hang together in one part make a
  chart. Charts are turned square to their outline, cut up when huge or mostly empty, and shelf
  packed with a one texel border, on even texels so the half size set stays clean. Leaf cards,
  glyphs and parts under 30 cm get one bare block of two by two texels: one light value each.
  The ground and the city get more texels near the districts, and most at the Trailhead.
- **Light.** Cycles, CPU, three threads. A Nishita sky, folded over below the horizon because the
  island floats, set so that level ground gets 1.0 from the sky alone. A sun lamp in the direction
  of the ink world's drawn sun, 5.5 times that on a surface facing it, warm. Direct and bounced
  light, with the whole world in the scene while each chunk bakes.
- **Denoise.** Cycles does not denoise a bake, so each lightmap goes through OpenImageDenoise in a
  compositor of its own, with a guide image that gives every chart a colour, so light does not
  smear from one chart into its neighbour. Then the borders are filled from their charts.

### The sun

The ink world has two suns. `SUN` in `src/engine/world.ts` shades the drawing: (-0.52, 0.70, 0.50),
about 44 degrees up. `SUN_AT` in `src/engine/sky.ts` is where the sun disc is drawn:
(-0.62, 0.36, 0.70), about 21 degrees up. Both point south west (x is east, z is south, so the sun
stands over -x, +z), five degrees apart on the compass. The real look uses the drawn one: low,
south west, late in the day. The export reads it back from the disc mesh, so if I move the drawn
sun the bake follows. The manifest carries the direction.

## What is in public/real

```
manifest.json
CREDITS.md
chunks/<id>.glb.gz              geometry, quantised, meshopt compressed, then gzipped
lightmaps/<id>.<page>.webp      full size
lightmaps/half/<id>.<page>.webp half size, for weak devices
textures/<set>_color.webp, _normal.webp, _orm.webp      the shared library
textures/half/...               the same at half size
textures/lettering.webp         the lettering atlas (lossless), and half/
textures/swatch.png             roughness and metal of the plain surfaces
env/sky.hdr                     the sky, equirectangular, Radiance RGBE
```

All paths in the manifest are relative to `public/real/`.

## The manifest

`manifest.json`, field by field.

| Field | Meaning |
| --- | --- |
| `version` | 1. I raise it when a field changes meaning. |
| `generated` | When the pack step ran. |
| `space` | A reminder: metres, x east, y up, z south, the ink world's own space. |
| `sun.direction` | Unit vector toward the sun, in world space. |
| `sun.elevationDeg` | Its height above the horizon. |
| `sun.color` | The sun's colour, linear rgb with a luminance of 1. |
| `sun.irradiance`, `sun.skyIrradiance` | What the sun puts on a surface facing it and what the sky puts on level ground, in the units the lightmaps are in. For a live light on a moving thing. |
| `look.toneMapping` | `"AgX"`. What the bake was judged under. |
| `look.exposure` | `toneMappingExposure` to start from. |
| `look.lightMapIntensity` | Set this as `lightMapIntensity` on every material. A lightmap texel times this is irradiance. |
| `environment.file`, `.bytes` | The sky. Equirectangular Radiance `.hdr`, 512 by 256, with a soft sun drawn in. Row 0 is straight up; +x is the middle of the image, as three.js expects. |
| `lettering.file`, `.half`, `.bytes`, `.halfBytes` | The lettering atlas. Use it as `alphaMap`. |
| `textures.<set>` | One entry per library set: `source`, `id`, `licence`, and `color`, `normal`, `orm`, each with `file`, `bytes`, `half`, `halfBytes`. `orm` is occlusion, roughness, metal in red, green, blue. The leaf set has only `color`, with alpha. |
| `materials.<name>` | How to build each material. See below. |
| `chunks[]` | Every chunk. See below. |
| `live` | Ink objects that belong to no chunk and stay live: the figure's meshes and the markers. |
| `drop` | Ink objects to hide in the real look with nothing in their place. |
| `cameras.<district>` | The follow camera at each arrival point: `position`, `quaternion`, `fov`, `aspect`. For matching pictures. |

### `materials.<name>`

The name is the glTF material name on a primitive, and also `extras.material` on its node.

| Field | Meaning |
| --- | --- |
| `kind` | `opaque`, `plain`, `cards`, `glass` or `lettering`. |
| `texture` | For `opaque` and `cards`: the library set to use. |
| `metresPerRepeat` | How big one repeat of the texture is in the world. Already in the uv. For information. |
| `normalScale` | Strength of the normal map. |
| `roughness`, `metalness` | For materials without an `orm` map. |
| `reflect` | `envMapIntensity`. Low on rough outdoor surfaces. |
| `alphaTest` | For `cards`. |
| `opacity` | For `glass`. |
| `alphaMap` | For `lettering`: the atlas. |
| `swatch`, `cells` | For `plain`: the swatch image and the names of its columns. |
| `side` | Always `double`. The ink material is double sided and some geometry relies on it. |
| `vertexColors` | Always true. `COLOR_0` is a linear tint: the paint colour on plain surfaces, a mild tint on textured ones, the ink colour on lettering. |

### `chunks[]`

| Field | Meaning |
| --- | --- |
| `id` | A district id, or `ground`, `city`, `sky`. |
| `kind` | `district` or `base`. The base set is what to load first. |
| `file`, `bytes` | The glTF, gzipped. `bytes` is what goes over the wire. |
| `encoding`, `rawBytes` | `"gzip"`, and the size of the `.glb` inside. See "Inside a chunk file". |
| `triangles`, `drawCalls` | What it costs on screen. One draw call per primitive. |
| `bounds.box` | `[minX, minY, minZ, maxX, maxY, maxZ]` in world space. |
| `bounds.sphere` | `[x, y, z, radius]`. For streaming by distance. |
| `lightmaps[]` | One per page: `file`, `bytes`, `size` (pixels a side), `half`, `halfBytes`. |
| `quality` | How it was baked: `level`, `lightmap`, `samples`, `pageSamples` (one per lightmap page), `bounces`, `bakeSeconds`. |
| `materials` | The material names it uses. |
| `primitives[]` | `name`, `material`, `lightmap` (index into `lightmaps`), `triangles`, `box`. |
| `replaces` | Ink objects this chunk stands in for. Hide these when the chunk is shown. |
| `live` | Ink objects of this chunk that keep being drawn by the ink side. |
| `stilled` | Among `replaces`: things that move in the ink look and stand still here. |
| `drop` | Ink objects of this chunk to hide with nothing in their place. |

An ink object is named by its top level group and its own name: `trailhead/trailhead-bell`,
`scatter/trees-0`, `terrain/streets`. A mesh added straight to the scene has just its name
(`poi-markers`). Where two meshes under one group share a name, the later ones get `#1`, `#2`
(`figure/figure-thigh#1`), in the order `traverse` meets them.

### Inside a chunk file

- The file is a gzipped `.glb`. Meshopt takes the structure out of the geometry and leaves the last
  squeeze to whatever carries the file, and the locked build seals files so no host can compress them
  on the way. So I gzip them myself. It takes 30% off. Open one like this, then hand the bytes to
  `GLTFLoader.parseAsync(bytes, '')`:

  ```ts
  let bytes = await (window.__lsAsset?.(path) ?? fetch(path).then((r) => r.arrayBuffer()));
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b)
    bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  ```

  The check on the first two bytes is there because some servers open a `.gz` file on the way out.
  `DecompressionStream` is in every current browser (Chrome 80, Firefox 113, Safari 16.4).
- `extensionsRequired`: `KHR_mesh_quantization`, `EXT_meshopt_compression`. `GLTFLoader` needs
  `setMeshoptDecoder(MeshoptDecoder)`, which three ships in `examples/jsm/libs`.
- One node per primitive, named `<chunk>.<page>.<material>`, with `extras.page` and
  `extras.material`. The node has a scale and a translation that undo the quantisation: add the glTF
  scene to the world as it is and positions are world positions. Do not flatten the nodes away
  without applying their matrices.
- `POSITION` 16 bit, `NORMAL` 8 bit, `TEXCOORD_0` float (tiling, true scale; on `plain` it points
  at a swatch column, on `cards` at a leaf spray, on `lettering` at a glyph), `TEXCOORD_1` 16 bit
  (the lightmap), `COLOR_0` 8 bit rgba (the tint, linear).
- Materials in the file are names only. Textures are never embedded. Build the materials from the
  manifest and assign by name.

## Drawing it

What my bare viewer does, which is the whole recipe:

1. Renderer: sRGB output, AgX tone mapping, `toneMappingExposure = look.exposure`.
2. Load `env/sky.hdr` with `HDRLoader`, `mapping = EquirectangularReflectionMapping`. Use it as the
   background and set it as `envMap` on every material. Leave `scene.environment` alone: three
   ignores a material's `envMapIntensity` for the scene's environment, and then every surface
   mirrors the sky at full strength. Ink goes grey and shade goes bright.
3. Every image follows glTF: uv (0, 0) is the top left texel. So `flipY = false` on every texture
   loaded by hand: library textures, lightmaps, the atlas, the swatch.
4. Colour space: `SRGBColorSpace` on colour maps and on lightmaps. None on normal, orm, atlas, swatch.
5. Library textures repeat (`RepeatWrapping`). Lightmaps, atlas and swatch clamp. The swatch wants
   `NearestFilter` and no mipmaps.
6. Per primitive: a `MeshStandardMaterial` built from `materials[name]`, with
   `lightMap = that page's texture`, `lightMap.channel = 1`, `lightMapIntensity = look.lightMapIntensity`,
   `vertexColors = true`, `side = DoubleSide`, `envMap = the sky`, `envMapIntensity = reflect`.
   - `opaque`: `map`, `normalMap`, and the `orm` map as both `roughnessMap` and `metalnessMap` with
     `roughness = metalness = 1`. Set `normalScale` to `(s, -s)`: uv runs top down, so the green
     channel flips, the same thing `GLTFLoader` does for its own materials.
   - `plain`: no colour map. The swatch as `roughnessMap` and `metalnessMap`, `roughness = metalness = 1`.
     One material serves paint, cloth, steel, brass, window glass and lamps.
   - `cards`: as `opaque` with only `map`, plus `alphaTest`.
   - `glass`: `transparent`, `opacity`, `depthWrite = false`, the given roughness and metalness.
   - `lettering`: `alphaMap = atlas`, `transparent`, `depthWrite = false`, a polygon offset toward
     the camera, drawn after everything else.
7. The lightmap already holds the sky's light. The environment map is there for reflections only, so
   cut its diffuse part out of the standard material, or everything is lit by the sky twice. One
   line in `onBeforeCompile`: replace `#include <lights_fragment_maps>` with that chunk minus
   `iblIrradiance += getIBLIrradiance( geometryNormal );`. No lights in the scene.
8. For a weak device use every `half` file. Geometry is the same.

Fetch nothing under `real/` until the visitor first switches. Then: manifest, sky, the base chunks
with their lightmaps, the library, and districts by distance using `bounds.sphere`. In the locked
build go through `window.__lsAsset` as `docs/DEV.md` describes.

### How the light is stored

A lightmap is 8 bit sRGB encoded WebP of `irradiance / lightMapIntensity`. Reading it with
`SRGBColorSpace` and multiplying by `lightMapIntensity` gives irradiance in the bake's units, where
the sky alone puts 1.0 on open level ground and the sun puts 5.5 on a surface facing it. The
ceiling is 10. The sRGB curve spends most of the 8 bits on the dark end and a little noise goes in
under the rounding, so deep shade does not band and full sun does not clip. Lamps are written at
the ceiling, which is why they glow. Metal and glass bake to black, as they should: all they show is
reflection.

A live thing drawn in the real look (the figure) has no lightmap. Light it with a directional light
along `sun.direction` in `sun.color` and a hemisphere or ambient light for the sky, scaled by
`sun.irradiance` and `sun.skyIrradiance`. It will not be in shadow when it stands in shade. That is
the price of baking.

## The material table

`tools/real/materials.json` has three parts.

`rules` run top to bottom and the first that fits wins. A rule tests one piece: one `add()` of the ink
builder, split where it does not hang together. On the terrain (`perFace`) it tests one triangle.
The tests are listed at the top of the file. The last rule catches everything.

`materials` says what each name is:

<!-- material -->
| Name | What it is | Texture | Metres per repeat | Drawn colour shows | Notes |
| --- | --- | --- | --- | --- | --- |
| `shadow` | drop |  |  |  | left out of the real look |
| `lettering` | lettering |  |  | fully |  |
| `marble` | opaque | marble | 2.4 | 0.55 (luma) | bevel 2.5 cm; folds into paving |
| `ashlar` | opaque | ashlar | 3.0 | 0.5 (luma) | bevel 3.0 cm; folds into marble |
| `cladding` | opaque | marble | 3.6 | 0.9 (rgb) | folds into paint |
| `paving` | opaque | paving | 2.5 | 0.5 (luma) | folds into concrete |
| `concrete` | opaque | concrete | 3.0 | 0.6 (luma) | folds into paving |
| `asphalt` | opaque | asphalt | 3.0 | 0.4 (luma) | folds into paving |
| `brick` | opaque | brick | 1.6 | 0.7 (rgb) | folds into paint |
| `rock` | opaque | rock | 6.0 | 0.55 (rgb) | folds into soil |
| `soil` | opaque | soil | 2.5 | 0.5 (rgb) | folds into grass |
| `grass` | opaque | grass | 3.5 | 0.55 (rgb) | folds into soil |
| `bark` | opaque | bark | 1.2 | 0.4 (luma) | folds into wood |
| `wood` | opaque | wood | 1.5 | 0.6 (rgb) | folds into paint |
| `leaves` | foliage |  |  |  | core plus about 1.7 leaf cards per m2 |
| `hedge` | foliage |  |  |  | core plus about 3.0 leaf cards per m2 |
| `leafcards` | cards | leaves |  | 0.35 (luma) |  |
| `leafcore` | plain |  |  | fully | roughness 1.0, metal 0.0 |
| `paint` | plain |  |  | fully | roughness 0.55, metal 0.0 |
| `cloth` | plain |  |  | fully | roughness 0.95, metal 0.0 |
| `steel` | plain |  |  | fully | roughness 0.38, metal 1.0 |
| `brass` | plain |  |  | fully | roughness 0.32, metal 1.0; bevel 1.0 cm |
| `patina` | plain |  |  | fully | roughness 0.8, metal 0.0 |
| `window` | plain |  |  | fully | roughness 0.05, metal 0.0 |
| `water` | plain |  |  | fully | roughness 0.04, metal 0.6 |
| `lamp` | lamp |  |  | fully | roughness 0.4, metal 0.0; written into the lightmap at the ceiling, so it glows |
| `glass` | glass |  |  | fully |  |
<!-- /material -->

`plain` materials have no texture. Their colour is the drawn colour, pulled down a little because
poster colours are brighter than paint, and they all draw with one browser material.

When a chunk would need more materials than `materialsMax` (12 for a district, so at most 12 draw
calls), the least used is folded into its `fallback`.

To tune: edit the file, `npm run real:bake -- --build-only` to see the counts per rule in
`tools/real/cache/build/<chunk>.json`, look at `viewer.html?show=class`, then bake.

## Settings

`tools/real/settings.json`:

- `quality`, `levels`, `chunks`: each chunk takes the defaults, then its level (`rough`, `good`,
  `hero`), then its own overrides: `lightmap` (pixels a side), `samples`, `bounces`, `pages`
  (a grid of lightmap pages over the footprint), `pageSamples`, `triangles` (the ceiling for added
  detail), `materialsMax`.
- `sun`: `ratio` (sun to sky), `color`, `angleDeg` (how soft the shadow edge is), `envDiscDeg`.
- `sky`: Nishita densities, `tint`, `below` (how bright the folded sky is under the horizon).
- `lightmapScale`: the ceiling of the lightmaps.
- `blockFloor`: the least light a leaf card, a glyph or a tiny part gets.
- `bakeVersion`: raise it to bake everything again after a change to the Blender scene code.
- `pack`: WebP quality for lightmaps (`lightmapQuality`, and `chunkLightmapQuality` per chunk: the
  base set is at 84 to fit its budget) and for the texture library.
- `focus`: how much more lightmap the ground and city get near districts.
- `look`: tone mapping and exposure, used by the Cycles pictures and passed to the manifest.
- `views`: named cameras for the pictures.
- `live`, `bake`, `drop`: force an ink object one way.
- `threads`: 3. This machine has four cores and other people on it.

## Where it stands

<!-- status -->
| Chunk | Triangles | Draw calls | Geometry | Lightmaps | Half size | Baked as | Bake time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ground | 77,190 | 31 | 1.34 MB | 4 x 2048 px, 1.33 MB | 0.60 MB | 12/32 samples, 3 bounces | 533 s |
| sky | 19,272 | 5 | 0.28 MB | 1 x 1024 px, 0.22 MB | 0.09 MB | 16 samples, 2 bounces | 15 s |
| city | 223,245 | 32 | 3.82 MB | 4 x 2048 px, 2.10 MB | 0.88 MB | 8/24 samples, 3 bounces | 311 s |
| trailhead | 35,281 | 12 | 0.56 MB | 1 x 2048 px, 0.44 MB | 0.18 MB | 48 samples, 4 bounces | 400 s |
| switchboard | 25,237 | 12 | 0.26 MB | 1 x 1024 px, 0.18 MB | 0.07 MB | 48 samples, 3 bounces | 46 s |
| postcards | 21,611 | 10 | 0.29 MB | 1 x 1024 px, 0.16 MB | 0.07 MB | 48 samples, 3 bounces | 37 s |
| commons | 30,160 | 12 | 0.36 MB | 1 x 1024 px, 0.21 MB | 0.08 MB | 48 samples, 3 bounces | 52 s |
| studio | 34,037 | 11 | 0.42 MB | 1 x 1024 px, 0.23 MB | 0.09 MB | 48 samples, 3 bounces | 45 s |
| terraces | 40,410 | 10 | 0.61 MB | 1 x 1024 px, 0.25 MB | 0.09 MB | 48 samples, 3 bounces | 52 s |
| greenhouse | 45,106 | 12 | 0.64 MB | 1 x 1024 px, 0.13 MB | 0.06 MB | 48 samples, 3 bounces | 53 s |
| maskgarden | 39,993 | 12 | 0.56 MB | 1 x 1024 px, 0.24 MB | 0.10 MB | 48 samples, 3 bounces | 46 s |
| boneyard | 49,506 | 8 | 0.70 MB | 1 x 1024 px, 0.18 MB | 0.07 MB | 48 samples, 3 bounces | 57 s |
| observatory | 29,650 | 11 | 0.43 MB | 1 x 1024 px, 0.19 MB | 0.08 MB | 48 samples, 3 bounces | 54 s |
| skyharbor | 28,575 | 11 | 0.41 MB | 1 x 1024 px, 0.18 MB | 0.07 MB | 48 samples, 3 bounces | 45 s |
| all | 699,273 | 189 | 10.66 MB | 6.05 MB | 2.53 MB | | |
<!-- /status -->

Megabytes are a million bytes. Geometry is the gzipped file.

- The Trailhead is the one I pushed: a 2048 lightmap at 17 texels a metre, 48 samples, 4 bounces.
- The ground and the city have four pages of 2048 each. The page that holds the Trailhead got 32 and
  24 samples, the other three 12 and 8. The denoiser carries the rest.
- The other ten districts are at `good`: 1024, 48 samples, 3 bounces, 6 to 12 texels a metre. About a
  minute each.
- The far sky pieces are at `rough`. Nobody gets near them.

To push another district the way the Trailhead was pushed, give it `"quality": "hero"` under
`chunks` in `settings.json` and bake. That is 5 to 7 minutes here.

Against the budgets, as the pack step prints them: shared textures and sky 3.1 MB of 6, the base set
(ground, city, sky) about 9 of 10, the biggest district with its lightmap 1.0 of 4, everything in
`public/real/` about 23 of 60. No district is over 12 draw calls or 50,000 triangles. The base set is
320,000 triangles and 68 draw calls: the ground and the city are one chunk each in 4 lightmap pages,
at most 12 draw calls a page, and are always there. Every chunk at once is 699,000 triangles and
189 draw calls.

The pictures are in `.shots/real/`: `sheet-trailhead-spawn.png`, `-stones` and `-high` put the
drawing, the Cycles picture and the bare viewer side by side.

## Limits

What still gives it away, most telling first:

- **The shapes are the drawing's shapes.** Lamp posts, shrubs and props are low polygon forms, and
  crowns are faceted lumps under their leaves. Bevels and textures help stone a lot and help props
  very little.
- **Painted things are one flat colour.** Doors, signs, awnings, the hydrant, the lamp posts: no
  texture, no dirt, no wear. The big painted walls were the worst of it, so those now take stone
  cladding in their own colour. Smaller painted walls are still flat.
- **Twelve tiling textures.** A long wall repeats. Nothing is stained where water would run, nothing
  is darker where it meets the ground.
- **Reflections show the sky and nothing else.** A window in a narrow street mirrors open sky. In
  the Cycles pictures the same window mirrors the house across the road.
- **The sky is clear and empty.** The clouds are ink objects that move, so they are listed as live.
  Drawing them over the real sky, or hiding them there, is a choice for the browser side.
- **Nothing moves in the baked world.** Trees do not sway. The armillary and the floating pediment
  stand still.
- **Live things have no baked light.** The figure, the train and the whale get one sun and one sky
  light. They do not darken in shade and they cast no shadow.
- **Soft shadows.** The ground averages 4 texels a metre and the city 4 to 8, with more near the
  districts and most at the Trailhead. Shadows of trees and buildings read well. The shadow of a
  wire or a railing does not survive. Districts have 6 to 12 texels a metre, the Trailhead 17.
- **One light value per leaf card, per glyph and per part under 30 cm.** Fine at walking distance.
  Close up, a card is evenly lit across.
- **Relief is in the normal map only.** The baked light does not know about the joints between
  blocks, so the joints do not shade.

What the pipeline does not do:

- It bakes one sun. Another time of day is another full bake (about 30 minutes here) and another
  set of lightmaps.
- A chunk's hash covers that chunk. After a big change to one district, the shadows it throws on
  the ground and on its neighbours are stale until I bake those again with `--force --only`.
- `materials.json` sorts by colour and shape. A new prop in a colour the rules do not know lands in
  `paint`. Look at `viewer.html?show=class` after adding things.
- Every chunk at once is just under 700,000 triangles, which is the whole budget for a frame. From
  the Trailhead looking north with everything loaded I counted 680,000. Stream the districts by
  distance and a frame is the base set (320,000) plus what is near.
- Full size lightmaps are 9 pages of 2048 and 11 of 1024. With mipmaps that is about 260 MB of
  video memory if every chunk is loaded. The half set is a quarter of that. Phones should get the
  half set.
- I have only run this under software GL in headless Chromium. Draw calls, triangles and pictures
  are checked. Frame rate on a real graphics card or a phone is not.
- The pictures were checked in Chromium only. Safari and Firefox decode the same formats (WebP,
  Radiance HDR through three's loader, gzip through `DecompressionStream`) but I have not looked.
- The system Blender (4.0.2) cannot run the bake: no denoiser and no numpy. The pipeline needs the
  `bpy` wheel, a 1 GB download, set up once.

## In the browser

How the engine shows these files. `docs/DEV.md`, "The second look", has the calls, the tiers and the
test hooks. This is the how.

### The files

| File | What it does |
| --- | --- |
| `src/engine/world.ts` | Owns which look is on. `setLook`, the 0.6 second change-over, the grace time before the files are freed, the lost context. Loads everything below with one dynamic import. |
| `src/real/api.ts` | Types only: what the world and the real look ask of each other, and the manifest fields the browser reads. |
| `src/real/index.ts` | The real look itself: loading, streaming, memory, which ink mesh is hidden or stood in for, the sun and its shadow map, the light on the figure, costs for the culling, the frame. |
| `src/real/assets.ts` | Fetching through `window.__lsAsset` or `fetch`, gunzip, images to textures, the Radiance reader for the sky. |
| `src/real/glb.ts` | Reads a chunk file. It knows exactly the kind of glTF the pack step writes and nothing more. |
| `src/real/materials.ts` | The baked materials from the manifest, and the stand-in material for ink geometry. |
| `src/real/post.ts` | The sky behind everything, bloom, and the output pass: exposure, AgX, sRGB, and the join with the ink page during a change-over. |
| `src/engine/ink.ts` | Unchanged in what it draws. It can now draw its page into a target, and hands out its depth texture, for the change-over. |
| `src/engine/quality.ts` | Keeps a tier and a resolution per look. |

### One scene, two looks

There is one scene and one renderer. The baked chunks hang under one group that is in the scene only
while the real look is on. When a chunk is in, the ink meshes it stands in for (`replaces` in the
manifest, found by the same naming the export used) move to a layer the camera does not see. Ink
meshes listed under `drop` go the same way. Everything else the ink look draws stays visible and has
its material swapped for the stand-in. Leaving the real look puts every mesh back on its layer with
its ink material, takes the group out, and the ink look draws the scene exactly as before.

A real frame is: the scene into a half float target with a depth buffer and 4 samples (the canvas
itself has neither, the ink look needs neither), bloom on high, then one pass to the screen.

### What differs from the bare viewer's recipe

- **No `GLTFLoader`, no `HDRLoader`.** Both pull classes into the first bundle because they share
  three.js with it. `glb.ts` and the Radiance reader in `assets.ts` are small and cost the ink look
  nothing.
- **Tone mapping in my own pass.** The renderer stays as the ink look set it up (no tone mapping,
  no colour management on output). The output pass applies `look.exposure`, the AgX curve as three.js
  ships it, and sRGB. So one renderer serves both looks and can draw both in one frame.
- **Reflections from a blurred copy of the sky** (`PMREMGenerator`, made once at load), set as
  `envMap` on each material with the manifest's `reflect`. Rough stone gets a soft sky, water and
  window glass a sharp one.
- **The sun is taken out of the mirrored sky.** The file has the sun drawn in, and a mirrored sun
  shines on a wall in deep shade as it does on one in the open. With it in, shade came out 1.3 to
  2.4 times as bright as in the Cycles pictures. So `assets.ts` caps the sky within ten degrees of
  the sun, and the baked materials put the sun's glint back as a highlight of their own, only where
  the lightmap holds more light than the sky alone could give that face. Metal bakes to black, so it
  cannot say where it is in shade, and keeps its glint everywhere.
- **The mirrored sky is held back where the baked light says a face is closed in.** A face that
  gets less than the open sky's share mirrors that much less sky. And a mirrored direction that runs
  level or downward shows the surroundings (a fifth of the light that falls there) in place of the
  low sky, because at street level the town hides the horizon.
- **Joints shade.** The red channel of each `orm` picture is occlusion. It comes off the baked light
  in shade (0.6 of it) and much less in sun.
- **The sky is drawn by a shader** from `env/sky.hdr`, with the sun's disc drawn sharp at
  `sun.direction`. The file is 512 pixels round and its own sun is a soft blob.
- **Haze.** Distance fades into the colour of the baked sky at the horizon, warmer toward the sun,
  over the same range as the ink haze, and less of it (0.62 at most where the drawing goes to 0.9).
- **Water** ripples: a small moving normal on the `water` swatch column. **Lamps** get a little
  radiance on top of what the lightmap gives them. **Leaf cards** shiver a few centimetres with the
  same sway switch the drawing uses, so they stop with reduced motion and with `?still=1`.

### What moves

The figure, markers, the train, the whale, flags, clouds and anything else under `live` are ink
geometry drawn with a standard material that reads `aColor`, `aData` and `aInk`: the drawn colour as
albedo (pulled down by the same 0.8 the pipeline uses for paint), the sway, the lettering from the
ink atlas, and a glow where the drawing paints a part flat. That is why markers stay bright in shade.

They are lit by a sun lamp along `sun.direction` with `sun.irradiance`, and a sky light scaled to
`sun.skyIrradiance` and coloured from sums over the sky file. Baked surfaces take nothing from either
lamp. They only read the sun's shadow map, so the figure throws a shadow on baked ground: under it
the lightmap is brought down to what the sky alone would give. The shadow map is small (9 m either
side of the visitor) and only moving things are drawn into it.

A lamp shines through walls, and the baked shadows are in the lightmaps where a lamp cannot see
them. So when the ground or a district arrives I draw it once from straight above with every surface
writing out its baked light, and keep that picture in memory (1024 texels a side for the island, 256
for a district). How much sun reaches the figure is then a lookup: his feet ask where he stands, his
head asks the ground a few metres down-sun. He darkens when he walks into the shade of a building.

### Loading, streaming, memory

First switch: manifest, sky, then the base chunks and the nearest district in parallel with the
textures their materials name. Shaders are compiled before the first real frame. After that one
district loads at a time, nearest first, checked three times a second. Each chunk's size on the card
is counted (geometry plus lightmaps with mipmaps) against the tier's ceiling. When the next district
would not fit, districts further away than it are let go, furthest first. The base set is never let
go. A let-go district is drawn from its ink geometry again until it comes back.

A file that fails is tried again after 20 and 40 seconds, then left alone. Its district keeps its
stand-in. If the manifest is missing, `lookAvailable()` turns false for the rest of the visit.

When the WebGL context is lost and comes back, the real look's files are freed and loaded again (the
browser has them cached), and the visitor ends up in the look he was in.

### What I measured

<!-- runtime -->
Headless Chromium with software GL, 1280 by 720, everything loaded. Frame rate means nothing there,
so these are counts and pictures.

| Standing at | Draw calls, high | Triangles, high | Draw calls, low | Triangles, low |
| --- | --- | --- | --- | --- |
| Trailhead | 218 | 664,642 | 140 | 432,014 |
| Switchboard | 166 | 560,951 | 126 | 432,055 |
| Commons | 164 | 533,900 | 127 | 439,032 |
| Cloud Terraces | 124 | 475,245 | 98 | 419,462 |
| Mask Garden | 119 | 366,819 | 78 | 289,664 |
| Observatory | 93 | 249,042 | 71 | 218,106 |
| Studio | 98 | 258,564 | 81 | 233,544 |
| Greenhouse | 95 | 316,266 | 80 | 296,424 |
| Sky Harbor | 80 | 197,215 | 59 | 161,891 |
| Boneyard | 75 | 260,722 | 57 | 240,290 |
| Postcards | 104 | 278,331 | 86 | 253,247 |
| Overview from the south east | 237 | 695,726 | | |

The ceiling is 250 draw calls and 700,000 triangles on high, 480,000 triangles on low. The drawing,
from the same arrival points on high, is 47 to 78 draw calls and 157,000 to 369,000 triangles.

- A phone sized window (390 by 844, touch, medium): 69 to 164 draw calls, 163,000 to 516,000
  triangles, half size files, 99 MB of baked chunks held.
- On high with all fourteen chunks in: 287 MB of geometry and lightmaps by my count, under the
  340 MB ceiling. On low: 99 MB under 100.
- The 0.6 seconds of a change-over draw both looks: 318 draw calls and 1,113,000 triangles at the
  Trailhead. That is over the ceiling for those frames and I accept it. A dissolve needs both pictures.
- First switch here: 28 to 36 seconds until the picture changes, two minutes until every district
  is in. Nearly all of that is the software renderer compiling shaders and taking textures.
- Twenty switches there and back in place, with a full unload after every fifth: 89 geometries and
  5 textures on the card before, 89 and 5 after, as three.js counts them. A page that has never
  switched holds 4 textures and 3 shader programs. Once the real look has come and gone it holds 4
  textures and 4 programs: the ink page's own program, compiled a second time for drawing into a
  target during a change-over. The fifth texture in the count above is a ground light picture still
  being read back. Software GL takes up to 50 seconds over that. Geometry ends where the drawing
  itself would put it: the real look draws further, so more of the ink world's own meshes have been
  sent to the card.
- No request for anything under `real/`, and none for the real look's code, before the first
  switch: 62 requests, 0 of them. 60 after it.
- The first bundle grew by 2.9 kB gzipped (233.2 to 236.1 kB as Vite counts it, 343,204 to
  346,166 bytes for everything the first load fetches). The real look's own code is a separate
  24.7 kB gzipped file, fetched on the first switch. Four ink pictures of the built page taken
  before and after the change are the same files, byte for byte.
- `npm run build` copies `public/real` to `dist/real` (23 MB). The built page switches at the
  Trailhead in 23 seconds under software GL. The single file build says `lookAvailable()` false,
  refuses the switch with its sentence and asks for nothing under `real/`.

Against the Cycles pictures from the same three cameras (`.shots/real/rr-sheet-*.png`): the sky is
equal to a percent, sunlit ground within 5%, sunlit stone and brick about 10% brighter, shade 12 to
35% brighter. With the sun left in the mirrored sky, as the bare viewer has it, shade was 1.3 to 2.4
times as bright. What is left is in the lightmaps themselves: with every reflection switched off the
shade is still 20 to 35% over.
<!-- /runtime -->

### What still gives it away, on the browser side

- **Things that move are the drawing's shapes with a real surface.** The figure reads as a vinyl
  toy standing in a photograph. So do the train, the whale and the flags.
- **Clouds** are the drawn clouds, softened at the edge and lit by the sun. They pass far away and
  give themselves away near the top of the frame.
- **Moving things get one sun and one sky light.** The figure does go dark in the shade of a
  building, from the map of the ground's light. A lantern or a marker does not light the wall next
  to it.
- **Metal and water cannot tell shade from sun.** They bake to black, so their glint and their
  mirrored sky are the same everywhere.
- **A mirror shows the sky or a guess.** Windows facing level show a dim flat tone where the Cycles
  picture shows the house across the road.
- **The bake is older than the drawing in one place.** The shrine to Hush behind the Studio
  colonnade went into the drawing after the bake. Its star moves, and a mesh the manifest never
  names is drawn like a moving thing, so the star is there. The shrine itself is part of
  `studio/studio-static`, which the baked Studio chunk stands in for, so in the real look the star
  floats over bare paving and the shrine's colliders stand in empty air
  (`.shots/real/rr-hush-ink.png`, `rr-hush-real.png`). The browser has no way to tell a stale bake
  from a current one. Request 12 fixes it.

### What I would ask of the pipeline

1. Shade bakes brighter than the Cycles picture of the same spot shows it: 20 to 35% with no
   reflections drawn at all. Worth comparing a lightmap texel against a render pass (diffuse direct
   plus indirect) at the stones camera, and checking clamps, the denoise and `blockFloor`.
2. Ship the sky without the sun drawn in, or say in the manifest how wide the drawn sun is. I cap
   everything within ten degrees of `sun.direction`.
3. Give metal, glass and water a lightmap value too (the light that falls there, whatever the
   surface does with it), or a sun-or-shade bit in the alpha channel. Then brass in shade stops
   glinting.
4. One small cube map per district, rendered in Cycles from head height, would give windows and
   water something true to mirror. 128 pixels a face is enough.
5. A top-down map of sun and shade per walkable chunk, 256 pixels a side, would replace the one I
   draw and read back when a chunk arrives.
6. Scale the occlusion channel of each `orm` picture so that open surface is white. Bark averages
   0.59 and soil 0.69 now, so I can only use part of it.
7. Round things are faceted up close: lamp globes, the balls by the greeting stones, column
   drums. Subdividing whatever the rules call round would help more than any shader.
8. The overhead wires at the Switchboard are as thick as the ink line that drew them. In the built
   version they want to be a centimetre or two.
9. Some window panes still come out pale (the lavender ones on the brick block east of the
   Trailhead arch). The window rule misses them.
10. Leaf cards deep inside a crown come out darker than in Cycles, where a card lets light through.
11. A sky with clouds in it, baked, would let me hide the drawn ones.
12. Bake the Studio again: the manifest was written at 13:30 and the Hush shrine landed at 17:42.
    And give the browser a way to see this: for each path in `replaces`, the triangle count the
    export saw and the tier it ran at, or one hash of the export per chunk that the page can
    compute too. With that the page keeps a stale district on its stand-in instead of hiding new
    things. A check in the build that fails when the export no longer matches the bake would catch
    it sooner still.
