# Pictures and loops

Everything here was taken from the running page in headless Chromium, high tier. Stills are 1600 by 900
unless they say otherwise. The loops are 720 px wide at 12 frames a second.

## Stills

| File | What it shows |
| --- | --- |
| `hero.png` | The LONG SUNDAY arch from the crossing at the start, low down, with him standing under it. |
| `hero-built.png` | The same camera in the built look. |
| `drawn-vs-built.png` | The hero frame twice, drawn on the left and built on the right. |
| `island.png` | The whole island from outside, with the floating towers of the far skyline behind it. |
| `district-trailhead.png` | Arriving at the Trailhead: the arch, the greeting stones, the bell tower. |
| `district-switchboard.png` | Arriving at the Switchboard: the plugboard wall, the wires, the giant rolodex. |
| `district-commons.png` | Arriving at the Commons: the gate and the beacon tower. |
| `district-terraces.png` | Arriving at Cloud Terraces: the stepped marble terraces and the domes on stalks. |
| `district-maskgarden.png` | Arriving at the Mask Garden: the big mask between the gate columns. |
| `district-observatory.png` | Arriving at the Observatory: the rotunda, the orrery, the lanterns. |
| `district-studio.png` | Arriving at the Studio: the lofts and the giant watercolour on its easel. |
| `district-greenhouse.png` | Arriving at the Greenhouse: the glass house and the plant through its roof. |
| `district-skyharbor.png` | Arriving at Sky Harbor: the platform, the whale and its krill, the wheels. |
| `district-boneyard.png` | Arriving at the Boneyard: the rib arches and the fallen columns. |
| `district-postcards.png` | Arriving at Postcards: the balloon over the arch and the ring of cards. |
| `districts.png` | All eleven arrivals and the island on one sheet, named underneath. |
| `district-switchboard-built.png` | The Switchboard arrival in the built look. |
| `district-maskgarden-built.png` | The Mask Garden arrival in the built look. |
| `district-observatory-built.png` | The Observatory arrival in the built look. |
| `district-greenhouse-built.png` | The Greenhouse arrival in the built look. |
| `district-postcards-built.png` | The Postcards arrival in the built look. |
| `districts-built.png` | Those five and the Trailhead, built, on one sheet. |
| `blender-vs-browser.png` | The Trailhead from the arrival camera: the Cycles render Blender made for the bake on the left, the browser's built look on the right. The Cycles picture has no figure in it: he moves, so he is not baked. |
| `figure.png` | Him from the front, three quarters, the side and the back, with the twists tied high. |
| `ui-title.png` | The title card over the world as the page opens. |
| `ui-caption.png` | The caption for Hon open beside its wall of comic panels in the Studio. |
| `ui-index.png` | The index, the plain list of everything. |
| `ui-map.png` | The map, for going straight to a place. |
| `phone-title.png` | The title card on a phone, 390 by 844. |
| `phone-walk.png` | Walking on a phone with the thumb stick held. |
| `detail-1.png` | Close: the ink line round him and the coral and teal lines in the road. |
| `detail-2.png` | Close: the violet hatching inside the arch's vault. |
| `detail-3.png` | Close: the lettering on the arch. |

## Loops

| File | What it shows |
| --- | --- |
| `walk.gif` | He walks through the arch and up the avenue, the follow camera behind him. |
| `island.gif` | A slow arc round the whole island. |
| `skyharbor.gif` | The whale and its krill from the platform. |
| `observatory.gif` | The rotunda at night, the orrery turning, the lanterns rising. |
| `maskgarden.gif` | A slow push in through the gate of the Mask Garden at sunset. |
| `interface.gif` | He walks up to the founder's stone, the prompt comes up, the caption opens and closes. |
| `switch.gif` | The camera holds still while the switch in the corner turns the drawing into the built look and back. |

To make the loops again, start the dev server and run the film script against it:

```
npx vite --port 5504 --strictPort
node scripts/film.mjs --port 5504                      # all seven into docs/media/
node scripts/film.mjs --port 5504 --only walk,island   # some of them
```

It needs Playwright installed globally with its Chromium, and ffmpeg. How it steps the page one frame at
a time is written at the top of `scripts/film.mjs`. The switch loop loads the built look first, which
takes a few minutes in software.
