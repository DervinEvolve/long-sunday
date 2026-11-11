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
