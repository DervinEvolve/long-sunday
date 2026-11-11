# Long Sunday: the plan

Dimanche is French for Sunday. This is a walk through my working life, built as a small open world that runs in a browser tab. I want someone who clicks the link on my resume to be standing in it within a few seconds, moving smoothly, and to leave knowing what I have done in talent acquisition and what I have built as a technologist.

The look comes from the comics of Moebius: even ink lines, flat gouache colour, violet shadows drawn as hatching, and skies that take up most of the frame.

The place is a future Queens that floats. Brick walk-ups with rooftop gardens, an elevated train running on Roman aqueduct arches, marble colonnades standing in the middle of city blocks, and green on everything.

## 1. What a visitor gets

1. A title card over the live world. Two choices: **Walk in**, or **Read the index**.
2. The index is the thirty second route for a recruiter. Every entry in the world as a plain, accessible list. It is also what a visitor gets when the browser cannot draw the world. For anyone who prefers less motion, a setting stills the decoration in the walk.
3. Walking in puts you at the Trailhead as a teenager with his rope twists tied back in a ponytail and an oversized orange jacket. An avenue runs uphill to the north. Every job I have held sits on that avenue in date order. Side streets lead to experiments and to life outside work.
4. Two lines are inlaid in the avenue like two lines on a subway map: coral for people work, teal for technology. They run side by side and become one line at the top, at the Observatory.
5. Each district has objects you can walk up to. Press E, or tap, and a caption panel opens with what I did there, in my words, with links.
6. The sky changes colour as you walk between districts. Things float that should not. It should feel like walking around inside someone's head.

## 2. The world

A floating island of city about 470 metres across, green on top, bedrock and old foundations underneath. The numbers below live in `src/world/layout.ts`.

| District | What it holds | Years | Thread |
|---|---|---|---|
| The Trailhead | Where I start: New York, college, languages, the camera | 2017 | life |
| The Switchboard | TEKsystems, recruiter then account manager | 2017 to 2019 | people |
| The Commons | Meta in Cambridge, interview prep, Black@Boston | 2019 to 2021 | people |
| Cloud Terraces | Google Cloud, cleared hiring, L7 and L8, committees | 2021 to 2023 | people |
| The Mask Garden | Diaspora DAO | 2023 to 2024 | both |
| The Observatory | Microsoft AI | 2024 to now | both |
| The Studio | Backrun, Hon, Memory Visualizer, the 2023 notebook | 2023 to 2026, side road | tech |
| The Greenhouse | Observable Lab, Research Lab, TradingOS | 2026, side road | tech |
| Sky Harbor | Krill, Ophanim, Empathy Archives | 2024 to 2026, side road | tech |
| The Boneyard | What failed or never got finished, and what grew from it | Along the way, side road | tech |
| Postcards | Travel and community | 2017 to now, side road | life |

## 3. District briefs

Every object named here is something a visitor can stand next to. Entry ids in brackets match `src/content/content.ts`. Each district also letters its own name somewhere a visitor sees on arrival.

**Trailhead.** A street corner at the bottom of the avenue. A marble triumphal arch lettered LONG SUNDAY that frames the avenue north. A street sign pole whose blades point to the other districts. A row of brick walk-ups with stoops and street trees behind. A small college bell tower flying two flags for the two degrees [elms]. A tripod camera under a cloth beside a line of hanging prints [camera]. A subway stairwell with a green globe lamp for New York [about]. Three greeting stones cut with Hello, Bonjou, Bonjour [languages].

**Switchboard.** A block of leaning utility poles whose wires all run to one giant plugboard wall on the side of a brick telephone exchange [tek-recruiter]. Lights travel along the wires. A desk on the pavement with two phones and a giant rolodex wheel taller than the visitor [tek-am]. Client names appear only as lettering on rolodex cards. Ivy is taking the exchange.

**Commons.** A campus green. A sunken Greek theatre of marble steps with whiteboard monoliths and about 160 stools [interview-prep]. A tall beacon tower with a slow turning light [black-at-boston]. A long workbench under a string of lanterns between two trees [hackathon]. Four rising stepping stones lettered L3 to L6 beside a sourcing desk [meta-sourcer].

**Cloud Terraces.** Stepped white marble terraces with colonnades and hanging gardens, and domes on thin stalks above a floor of drifting cloud. Seven pods, each lettered with one team name [google-recruiter]. A sealed round vault door with a wheel lock set in a retaining wall [sovereign-vault]. The top two steps of an enormous ladder, lettered L7 and L8, rising out of the cloud [l7-l8]. A round stone table with a rubric tablet and a ring of seats [committees].

**Mask Garden.** A community garden on a city lot, walled on two sides by brick. Tall mask monoliths among the planting beds, all original abstract geometric designs, in tiers of size [mask-pass]. A founder's stone at the entrance [diaspora-origin]. Six workbenches in a ring [diaspora-team]. A stage facing rows of seats [consensus-demo] with a four chair panel table to one side [consensus-panel]. A billboard film frame with price tags hanging off objects in the picture [tokenized-video]. Three free standing door frames, each showing a differently tinted world through it [ar-lenses]. A fork where one path withers and the other leads to a small lab shed [pivot].

**Observatory.** The highest ground. A domed rotunda on a ring of fluted columns with a brass telescope through the roof [msai-role]. Constellations hung low enough to walk under, drawn as dots and lines like an org chart of the sky [talent-map]. An orrery with seven orbs lettered pre-training, post-training, multimodal, speech, text, inference, data [model-teams]. A mechanical bird circling a perch [scout]. A small white pavilion with a single lamp, no medical symbols [mayo]. A drifting swarm of paper lanterns [agent-swarms]. A stack of giant pages and task tablets [pm-hiring]. The coral and teal lines join at the rotunda door.

**Studio.** A corner block of artist lofts with the roll-up door open onto a yard. A giant watercolour sheet on an easel with a bloom spreading across it and three brushes standing in a jar, one per painter [backrun]. A wall of comic panels with a microphone on a stand in front [hon]. Photo cards orbiting a cloud of small discs [memory-visualizer]. A shelf of labelled jars [ai-notebook]. A brass spyglass on a tripod [talentsniper]. A card three metres tall with a portal cut out of it [collectible-card].

**Greenhouse.** A glass and brass house in a garden lot, holding one large plant that has outgrown the roof and five small work stations around it [observable-lab]. Rows of seedling trays with numbered tags, one tall plant and several withered ones [research-lab]. A desk with seven chairs facing a wall of charts and a sign that reads CANNOT ROUTE ORDERS [tradingos].

**Sky Harbor.** An elevated train platform that carries on past the edge as a pier into open sky. A sky whale circled by a swarm of krill [krill], with a canal lock of milestone gates on the pier. Wheels within wheels, rimmed with eyes, turning above a great listening horn [ophanim]. A desk with a lamp and a microphone under the wheels [ophanim-desktop]. A listening booth with a history book and a three needle tone dial [empathy-archives].

**Boneyard.** A sunken vacant lot. Toppled marble columns and bleached rib arches. A fallen giant phone with a face scan grid on its screen [tribe]. Two empty standing picture frames [empty-pages]. A half buried ankh key [ankh]. Two blank tablets [contracts]. Green seedlings growing out of the ruins [seedlings]. The mood is fond.

**Postcards.** A pocket park. A ring of nine standing postcards, each three metres tall, with a flat colour scene: Jamaica, El Salvador, Cape Town, Lisbon, Cape Verde, Puerto Rico, Vienna, Morocco, Tokyo [one entry each]. A moored hot air balloon that opens the map for fast travel. A campfire with log seats [community].

## 4. The look

- **Setting.** A future Queens with Greek and Roman stone in it, grown over. Three materials carry it: green, marble and brick. Grass, street trees, ivy and rooftop gardens. Fluted columns, colonnades, arches and pediments, some whole and some fallen. Brick walk-ups with fire escapes and water towers, an elevated train on aqueduct arches, street lamps, stoops, crosswalks. Glass towers with planted terraces on the horizon. The streets are wide and quiet and nothing is in a hurry.
- **Line.** Constant width indigo ink around every object and every change of plane. The line is drawn in screen space after the scene, so it stays the same weight near and far.
- **Fill.** Flat colour with two or three bands of light. No gloss, no texture maps, no realistic shadow.
- **Shadow.** Violet, as hatching that gets denser where the form turns away from the sun.
- **Sky.** A three stop gradient that takes up most of the frame, with drawn clouds and distant floating islands.
- **Distance.** Things fade toward the haze colour. Far objects lose contrast before they lose outline.
- **Lettering.** Hand lettered, drawn into the world on signs and plates.
- **Scale.** The visitor is 1.75 metres tall. Each district has one landmark between 10 and 30 metres that reads from the road, a few objects at human scale, and small things underfoot.
- **Palette.** `src/world/palette.ts` plus three accent colours per district. A district is about sixty percent ground and sky, thirty percent its main accent, ten percent a sharp contrast.
- **Strangeness.** Each district has one thing that could not exist: something floating, something far too big, or one object repeated past reason.
- No company logos anywhere. Names appear as lettering only.

## 5. The character

A teenager, Black, with rope twists gathered into a ponytail that swings as he walks. The ponytail is kept on the short side of medium: the tips stop at the nape, above the collar, and never reach the shoulders. If in doubt, shorter. An oversized orange techwear jacket with a high collar, goggles pushed up on the forehead, dark cargo trousers with straps, chunky white trainers with teal soles. Built from simple rigid shapes so the ink line reads cleanly. Idle, walk and run cycles. The design is original.

## 6. Controls

- Keyboard: WASD or arrows to move, Shift to run, E to look closer, M for the map, Esc to close.
- Mouse: drag to look. No pointer lock.
- Touch: left thumb joystick, drag anywhere else to look, a button for look closer, a button for the map.
- Gamepad if one is connected.

## 7. Performance budget

| Thing | Budget |
|---|---|
| Draw calls in view | under 150 |
| Triangles in view | under 400,000 |
| One district | at most 12 draw calls and 40,000 triangles |
| Terrain | at most 70,000 triangles, in chunks |
| First interaction | title card visible before the world finishes building |
| Download | one JavaScript bundle, no model files, no texture files |

The renderer drops its resolution when frames get slow and raises it again when there is headroom. Three quality tiers. Districts that are far away are not drawn. Rendering pauses when the tab is hidden.

## 8. Engine contract

One shared material draws everything. Meshes are built by a kit that merges many coloured parts into a single draw call.

| File | Owns |
|---|---|
| `src/types.ts` | Shared types. The contract between engine, districts and UI. |
| `src/engine/ink.ts` | Renderer, the two pass ink pipeline, the shared material |
| `src/engine/kit.ts` | The builder, instancing helper and lettering atlas. Documented in `docs/KIT.md` |
| `src/engine/quality.ts` | Quality tiers and adaptive resolution |
| `src/engine/input.ts` | Keyboard, mouse, touch, gamepad |
| `src/engine/terrain.ts` | `heightAt(x, z)`, the island, the avenue and side streets, year markers |
| `src/engine/sky.ts` | Sky palette blending, clouds, the far skyline, floating things |
| `src/engine/scatter.ts` | The city between districts: trees, columns, walk-ups, the elevated line |
| `src/engine/character.ts` | The visitor's figure and its animation |
| `src/engine/controller.ts` | Movement, collision, the follow camera |
| `src/engine/world.ts` | Loads districts, culls them, tracks points of interest |
| `src/main.ts` | Boot, the frame loop, the test hooks |
| `src/districts/<id>.ts` | One district each, exporting a `DistrictModule` |
| `src/ui/*` | Title card, HUD, caption panel, map, index, settings |

Render pipeline: one geometry pass writes colour and a normal plus object id buffer with a depth texture. One full screen pass finds edges in depth, normal and id, draws the ink line with a slight wobble, adds hatching and paper grain, paints the sky gradient where nothing was drawn, and fades distance into haze.

Test hooks on `window.__world`: `ready`, `teleport(districtId or {x, z}, yaw)`, `stats()`, `setQuality(tier)`, `openEntry(id)`. URL switches: `?debug=1`, `?d=<districtId>`, `?still=1`, `?q=low|medium|high`.

## 9. How it gets built

1. **Engine.** The renderer, kit, terrain, character and controller come first, then get wired together.
2. **Districts and interface.** One district at a time, built from the briefs above and checked against its own screenshots.
3. **Review.** Screenshots of every district, budget checks against section 7, a careful read of the code, and a fact check of every caption against my resume and notes.

## 10. Things I still need to decide

- The name. Long Sunday is my working title.
- Where this is hosted. It builds to a static folder, so GitHub Pages works.
- A handful of questions about single captions. I keep those with the sources for each caption, in my own notes.
