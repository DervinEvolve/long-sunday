<h1 align="center">Long Sunday</h1>

A walk through my working life, built as a small open world that runs in a browser tab. Nine years of technical recruiting sit along one road in date order. The side roads lead to the things I built along the way, the ones that shipped and the ones that did not.

Dimanche is French for Sunday.

I do these experiments for fun.

Live: LINK GOES HERE ONCE IT IS HOSTED

## Walk it

- Keyboard: WASD or the arrow keys to walk, Shift to run, E to look closer, M for the map, Esc to close.
- Mouse: drag to look.
- Phone: left thumb to walk, drag anywhere else to look, tap a marker to look closer.

Short on time? Choose **Read the index** on the title card. It lists everything in the world on one page.

Some of the projects in the world are in private repositories. I describe them there, but they have no links.

## Run it

```bash
npm install
npm run dev
```

```bash
npm run build
```

The build is a static folder. `npm run build:single` makes one self-contained HTML file.

## How it is put together

The plan, the district briefs and the performance budget are in [docs/PLAN.md](docs/PLAN.md). Every caption in the world lives in [src/content/content.ts](src/content/content.ts).

## Tools

I actively use Codex, Claude, DeepSeek through Hermes, and Kimi to experiment and develop Long Sunday. They help me try implementations, debug problems, inspect ideas, and review changes.

It is written in TypeScript with three.js 0.180 and built with Vite. There are no model or texture files: everything is drawn in code. The lettering font is Architects Daughter.
