#!/usr/bin/env node
// Short loops of the world for the README, made one frame at a time.
//
// This machine draws in software, so filming in real time gives a slideshow. Instead the page's
// clock is taken over before the page loads: requestAnimationFrame callbacks are held, and
// performance.now() reads a clock of my own once filming starts. Each frame I set the camera or
// the keys, advance that clock by exactly one frame's time, run the held callbacks once (so the
// boot loop in src/main.ts calls world.frame(dt) with that dt), and take the picture. CSS
// transitions in the interface are held and stepped on the same clock. Then ffmpeg joins the
// frames into a GIF with a two pass palette.
//
// The pages open at 800 by 450 at twice the pixel density, so the world draws 1600 by 900 on the
// high tier, and the GIF is scaled down from that. The paper grain is held still while filming
// (see holdGrain below). The drawing is full of fine texture, which GIF packs badly: at 800 px and
// 15 frames a second a loop came out at 16 to 26 MB. So the loops are 720 px wide at 12 frames a
// second and 6 to 8 seconds long, and the palette shrinks until the file is under 6 MB.
//
// The switch loop loads the built look first, with the page's own clock, which takes several
// minutes in software.
//
//   node scripts/film.mjs --port 5504                 every loop into docs/media/
//   node scripts/film.mjs --port 5504 --only walk,island
//   node scripts/film.mjs --port 5504 --only walk --frames 6 --keep   a quick test, frames kept
//
// Flags:
//   --port n      dev server port (5173). The dev server has to be up.
//   --only a,b    which loops (walk, island, skyharbor, observatory, maskgarden, interface, switch)
//   --out dir     where the GIFs go (docs/media)
//   --work dir    where the frames go (.shots/film)
//   --fps n       frames a second (12)
//   --width n     GIF width (720)
//   --frames n    stop after this many frames, for a quick look
//   --keep        keep the frame folders
//   --peek        only the first, middle and last camera of each loop, to check the framing
//   --calm        film with reduced motion on
//
// Needs Playwright installed globally with its Chromium, and ffmpeg on the path.
import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(root, 'x.js'))('playwright');
  }
}

export function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith('--') && !/^--?\d/.test(next))) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The clock, installed before any script of the page runs.
// ---------------------------------------------------------------------------------------------
function clockShim() {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const film = {
    manual: false,
    now: 0,
    held: new Map(),
    nextId: 1e6,
    anims: new WeakMap(),
    grab: null,
  };
  window.__film = film;
  // The paper grain boils: its seed moves eight times a second. In a GIF that is a full new frame
  // of noise every other frame, which triples the file. Reduced motion holds the seed too, but it
  // also slows the whale, the orrery and the rest to a creep. So I hold only the seed, at the value
  // reduced motion uses, by catching that one uniform on its way to the graphics card.
  film.holdGrain = false;
  const proto = WebGL2RenderingContext.prototype;
  const realLoc = proto.getUniformLocation;
  const realU1f = proto.uniform1f;
  const seeds = new WeakSet();
  proto.getUniformLocation = function (prog, name) {
    const loc = realLoc.call(this, prog, name);
    if (loc && name === 'uSeed') seeds.add(loc);
    return loc;
  };
  proto.uniform1f = function (loc, v) {
    return realU1f.call(this, loc, film.holdGrain && loc && seeds.has(loc) ? 1 : v);
  };
  performance.now = () => (film.manual ? film.now : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!film.manual) return realRaf(cb);
    const id = film.nextId++;
    film.held.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (film.held.has(id)) film.held.delete(id);
    else realCancel(id);
  };
  /** Take the clock. It starts where the page clock is now, so it always runs behind the real one
   *  and event time stamps from my key presses still count as fresh. */
  film.take = () => {
    film.holdGrain = true;
    if (film.manual) return;
    film.now = realNow();
    film.manual = true;
  };
  /** Hold every CSS animation and transition and put it where my clock says it should be. */
  film.steer = () => {
    for (const a of document.getAnimations()) {
      let born = film.anims.get(a);
      if (born === undefined) {
        born = film.now - (a.currentTime ?? 0);
        film.anims.set(a, born);
      }
      const t = film.now - born;
      const end = a.effect ? a.effect.getComputedTiming().endTime : 0;
      if (Number.isFinite(end) && t >= end) a.finish();
      else {
        a.pause();
        a.currentTime = t;
      }
    }
  };
  /** One frame: advance the clock by dt seconds and run what was waiting for a frame. */
  film.step = (dt) => {
    film.now += dt * 1000;
    const run = Array.from(film.held.values());
    film.held.clear();
    for (const cb of run) cb(film.now);
    film.steer();
  };
}

/** Read the canvas inside the frame that drew it: much quicker here than a Playwright screenshot,
 *  which waits on the compositor. Installed on the world once it exists. */
function grabHook() {
  const w = window.__world;
  const film = window.__film;
  if (film.hooked) return;
  film.hooked = true;
  const draw = w.frame.bind(w);
  const gl = document.getElementById('world').getContext('webgl2');
  w.frame = (dt) => {
    draw(dt);
    if (!film.grab) return;
    const done = film.grab;
    film.grab = null;
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    const pack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack);
    done({ W, H, px });
  };
}

export async function openWorld(browser, { port, width = 800, height = 450, dpr = 2, ui = false, touch = false, params = {}, all = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.addInitScript(clockShim);
  // Other people save files while I film. Without the dev client's socket the page never reloads under me.
  await page.addInitScript(() => {
    window.WebSocket = class {
      constructor() {
        this.readyState = 0;
      }
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    };
  });
  page.on('pageerror', (e) => console.error('[page error]', String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|KHR_parallel/.test(m.text())) console.error('[page error]', m.text().slice(0, 300));
  });
  const q = new URLSearchParams({ q: 'high', ...params });
  if (!ui) q.set('ui', '0');
  await page.goto(`http://localhost:${port}/?${q}`);
  await page.waitForFunction((n) => !!window.__world && window.__world.ready && window.__world.built().length >= n, all ? 11 : 1, { timeout: 600000, polling: 250 });
  await page.evaluate(grabHook);
  return { ctx, page };
}

/** Switch to the built look and wait until it fills the screen and every chunk is in. */
export async function toBuilt(page, { all = true } = {}) {
  await page.evaluate(() => {
    const w = window.__world;
    window.__lookOn = false;
    w.on('look', (e) => {
      if (e.look === 'real' && e.state === 'on') window.__lookOn = true;
    });
    return w.setLook('real');
  });
  await page.waitForFunction(() => window.__world.look() === 'real' && window.__lookOn, null, { timeout: 900000, polling: 500 });
  if (all)
    await page.waitForFunction(
      () => {
        const i = window.__world.realInfo();
        return i && i.loading.length === 0 && i.loaded.length + i.failed.length >= 14;
      },
      null,
      { timeout: 900000, polling: 1000 },
    );
}

export const take = (page) => page.evaluate(() => window.__film.take());

/** Advance n frames of dt seconds each. */
export const step = (page, dt, n = 1) =>
  page.evaluate(
    ([dt, n]) => {
      for (let i = 0; i < n; i++) window.__film.step(dt);
    },
    [dt, n],
  );

/** Advance one frame and return its pixels as a PNG buffer (the drawing buffer, so at the device pixel ratio). */
export async function grab(page, dt) {
  const b64 = await page.evaluate(
    (dt) =>
      new Promise((done) => {
        window.__film.grab = ({ W, H, px }) => {
          const flip = new Uint8ClampedArray(W * H * 4);
          for (let y = 0; y < H; y++) flip.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          for (let i = 3; i < flip.length; i += 4) flip[i] = 255;
          const c = new OffscreenCanvas(W, H);
          c.getContext('2d').putImageData(new ImageData(flip, W, H), 0, 0);
          c.convertToBlob({ type: 'image/png' })
            .then((b) => b.arrayBuffer())
            .then((a) => {
              let s = '';
              const u = new Uint8Array(a);
              for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
              done(btoa(s));
            });
        };
        window.__film.step(dt);
        // A paused world can skip a frame, so ask once more if the first did not draw.
        if (window.__film.grab) window.__film.step(0);
      }),
    dt,
  );
  return Buffer.from(b64, 'base64');
}

/** A picture of the whole page, interface included. Straight through the DevTools protocol, which
 *  skips Playwright's own waiting and is a little quicker here. */
export async function snapPage(ctx, page) {
  if (!page.__cdp) page.__cdp = await ctx.newCDPSession(page);
  const { data } = await page.__cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  return Buffer.from(data, 'base64');
}

export function ease(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Camera paths. A loop's camera eases in and out over its whole length, so it starts and ends calm.
// ---------------------------------------------------------------------------------------------

/** Point on a closed-form arc round a centre: angle in degrees in the ground plane (0 is east, 90 south). */
function arcPoint(c, r, deg, y) {
  const a = (deg * Math.PI) / 180;
  return [c[0] + Math.cos(a) * r, y, c[2] + Math.sin(a) * r];
}

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** A smooth curve through several points (Catmull-Rom), t from 0 to 1. */
function curve(points, t) {
  const n = points.length - 1;
  const s = Math.min(n - 1e-9, Math.max(0, t * n));
  const i = Math.floor(s);
  const u = s - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n, i + 2)];
  return p1.map((_, k) => {
    const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
    return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  });
}

const freeCam = (page, eye, look, fov) =>
  page.evaluate(
    ([eye, look, fov]) => {
      const w = window.__world;
      w.setFreeCamera(eye, look);
      if (fov) {
        const c = w.camera();
        c.fov = fov;
        c.updateProjectionMatrix();
      }
    },
    [eye, look, fov ?? 0],
  );

const keyDown = (page, code) => page.keyboard.down(code);
const keyUp = (page, code) => page.keyboard.up(code);

// ---------------------------------------------------------------------------------------------
// The loops
// ---------------------------------------------------------------------------------------------
// Each loop: `seconds` long, the address it opens, an optional `before` (run with the page's own
// clock, for things that need real time like loading files), `start` (once the clock is mine,
// before the warm-up frames) and `each(page, i, n)` before every frame. `ui` loops are taken with
// Playwright screenshots so the interface is in them; the rest are read off the canvas.
export const LOOPS = {
  // He walks through the arch and up the avenue. The follow camera does the rest.
  walk: {
    seconds: 7,
    params: { d: 'trailhead' },
    start: (page) => page.evaluate(() => window.__world.teleport('trailhead')),
    each: async (page, i, n) => {
      if (i === 6) await keyDown(page, 'KeyW');
      if (i === n - 16) await keyUp(page, 'KeyW');
    },
  },

  // A slow arc round the whole island, high up.
  island: {
    seconds: 6,
    params: { d: 'trailhead' },
    each: (page, i, n) => {
      const t = ease(i / (n - 1));
      const eye = arcPoint([0, 0, 20], 430, lerp(20, 64, t), 210);
      return freeCam(page, eye, [0, -25, 15]);
    },
  },

  // From the platform: the whale and its krill, the camera panning slowly along with them.
  skyharbor: {
    seconds: 7,
    params: { d: 'skyharbor' },
    start: (page) => page.evaluate(() => window.__world.teleport({ x: 160.5, z: -130.5 }, -0.6)),
    each: (page, i, n) => {
      const t = ease(i / (n - 1));
      const eye = mix3([148.5, 28.5, -120.5], [151.5, 28, -124], t);
      const look = mix3([174, 37.5, -158], [189, 38.5, -160], t);
      return freeCam(page, eye, look, 50);
    },
  },

  // The rotunda at night, the orrery turning in front and the lanterns rising behind.
  observatory: {
    seconds: 6,
    params: { d: 'observatory' },
    start: (page) => page.evaluate(() => window.__world.teleport({ x: 6, z: -116 }, 0.25)),
    each: (page, i, n) => {
      const t = ease(i / (n - 1));
      const eye = arcPoint([-2, 0, -140], 30, lerp(105, 80, t), 36.5);
      return freeCam(page, eye, [-4, 38.5, -141]);
    },
  },

  // A slow push in through the gate of the Mask Garden at sunset.
  maskgarden: {
    seconds: 6,
    params: { d: 'maskgarden' },
    start: (page) => page.evaluate(() => window.__world.teleport({ x: 57.5, z: -42 }, -0.85)),
    each: (page, i, n) => {
      const t = ease(i / (n - 1));
      const eye = curve([[34.5, 15.2, -21.5], [41, 14.6, -27.6], [46.6, 14.35, -32.6]], t);
      const look = curve([[66, 21, -50], [66, 21, -50], [65.5, 20.8, -50]], t);
      return freeCam(page, eye, look, 55);
    },
  },

  // The interface: he walks in through the gate of the Mask Garden to the founder's stone, the
  // prompt comes up, E opens the caption, Escape closes it.
  interface: {
    seconds: 8,
    ui: true,
    params: { d: 'maskgarden' },
    before: async (page) => {
      await page.getByRole('button', { name: 'Walk in' }).click();
      await page.waitForTimeout(800);
    },
    start: (page) =>
      page.evaluate(() => {
        const w = window.__world;
        const spot = w.spots().find((s) => s.entry === 'diaspora-origin');
        const x = 41.8, z = -31.5;
        w.teleport({ x, z }, Math.atan2(-(spot.x - x), -(spot.z - z)));
      }),
    // He walks until the prompt is up, stands a second, opens the caption, reads, closes it.
    each: async (page, i, n) => {
      const f = (s) => Math.round((s * n) / 8);
      const st = (page.__walk ??= { at: -1 });
      if (i === f(0.4)) await keyDown(page, 'KeyW');
      if (i > f(0.4) && st.at < 0 && (await page.evaluate(() => !!window.__world.poi()))) {
        st.at = i;
        await keyUp(page, 'KeyW');
      }
      if (st.at >= 0 && i === st.at + f(1.1)) await page.keyboard.press('KeyE');
      if (i === f(6.9)) await page.keyboard.press('Escape');
    },
  },

  // Drawn to built and back, the camera still and the switch in the corner pressed each way.
  switch: {
    seconds: 7,
    ui: true,
    params: { d: 'trailhead' },
    before: async (page) => {
      await page.getByRole('button', { name: /walk in/i }).click();
      // Load the built look once with the page's own clock, then come back to the drawing. Its
      // files stay held for a while (45 seconds on high, on my clock, which only runs per frame),
      // so the switch while filming is the change-over itself and not the download.
      await toBuilt(page);
      await page.evaluate(() => window.__world.setLook('ink'));
      await page.waitForFunction(() => window.__world.look() === 'ink' && window.__world.realInfo().mix === 0, null, { timeout: 120000 });
      await page.waitForTimeout(500);
    },
    // The hero camera, low on the crossing, looking up at the arch with him under it.
    start: (page) =>
      page.evaluate(() => {
        const w = window.__world;
        // A step north of the spawn, just out of reach of the stairs, so no prompt sits over the picture.
        w.teleport({ x: 12, z: 197.2 }, 0);
        w.setFreeCamera([12.6, 2.7, 207.5], [11.6, 9.8, 180]);
        const c = w.camera();
        c.fov = 55;
        c.updateProjectionMatrix();
      }),
    each: async (page, i, n) => {
      const f = (s) => Math.round((s * n) / 7);
      if (i === f(1.2) || i === f(4.4)) {
        const box = await page.locator('.ui-look').first().boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
    },
  },
};

async function runLoop(browser, name, def, opt) {
  const fps = opt.fps;
  const dt = 1 / fps;
  const dir = path.resolve(opt.work, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const { ctx, page } = await openWorld(browser, { port: opt.port, ui: !!def.ui, params: def.params });
  if (def.before) await def.before(page);
  await take(page);
  // The last frame the page asked for on its own clock may still land; let it, then settle.
  await page.waitForTimeout(300);
  await step(page, dt, 1);
  if (def.start) await def.start(page);
  if (def.calm || opt.calm) await page.evaluate(() => window.__world.setReducedMotion(true));
  const n = Math.min(Math.round(def.seconds * fps), opt.frames ?? Infinity);
  if (opt.peek && !def.ui) {
    // Framing only: the first, middle and last camera, a few frames each.
    for (const i of [0, Math.floor(n / 2), n - 1]) {
      for (let w = 0; w < 4; w++) {
        await def.each(page, i, n);
        await step(page, dt, 1);
      }
      fs.writeFileSync(path.join(dir, `peek-${i}.png`), await grab(page, dt));
      console.log(name, i, JSON.stringify(await page.evaluate(() => { const c = window.__world.camera(); return [c.position.toArray().map((v) => +v.toFixed(1)), c.fov, +c.aspect.toFixed(2)]; })));
    }
    await ctx.close();
    console.log(`${name}: peek frames in ${dir}`);
    return;
  }
  // Warm-up frames with the first camera, so the follow camera and the ink grain have settled.
  for (let w = 0; w < 12; w++) {
    if (def.each && !def.ui) await def.each(page, 0, n);
    await step(page, dt, 1);
  }
  for (let i = 0; i < n; i++) {
    if (def.each) await def.each(page, i, n);
    const file = path.join(dir, `f${String(i).padStart(4, '0')}.png`);
    if (def.ui) {
      await step(page, dt, 1);
      fs.writeFileSync(file, await snapPage(ctx, page));
    } else fs.writeFileSync(file, await grab(page, dt));
    if (i % 20 === 0) process.stdout.write(`${name} ${i}/${n}\r`);
  }
  await ctx.close();
  const gif = path.resolve(opt.out, `${name}.gif`);
  const colors = makeGif(dir, gif, { fps, width: def.width ?? opt.width });
  const mb = fs.statSync(gif).size / 1e6;
  console.log(`${name}: ${n} frames, ${colors} colours, ${mb.toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s  ${gif}`);
  if (!opt.keep) fs.rmSync(dir, { recursive: true, force: true });
}

/** Two passes: one palette for the whole loop, then the frames mapped onto it with a light ordered
 *  dither. The drawing has a lot of fine texture, so the palette shrinks until the file fits. */
export function makeGif(dir, out, { fps = 12, width = 720, limit = 6e6, ceiling = 8e6 } = {}) {
  const palette = path.join(dir, 'palette.png');
  const scale = `scale=${width}:-2:flags=lanczos`;
  const encode = (colors) => {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-vf', `${scale},palettegen=max_colors=${colors}:stats_mode=full`, '-frames:v', '1', palette]);
    execFileSync('ffmpeg', [
      '-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-i', palette,
      '-lavfi', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop', '0', out,
    ]);
    return fs.statSync(out).size;
  };
  // The largest palette under the limit. Below 64 colours the skies band, so if 64 is still over the
  // limit I keep the largest palette under the ceiling instead, and only then go lower.
  const tries = [192, 128, 96, 64];
  const sizes = new Map();
  for (const c of tries) {
    sizes.set(c, encode(c));
    if (sizes.get(c) <= limit) return c;
  }
  for (const c of tries) if (sizes.get(c) <= ceiling) return encode(c), c;
  for (const c of [48, 32]) if (encode(c) <= ceiling) return c;
  return 32;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = args(process.argv.slice(2));
  const opt = {
    port: Number(o.port ?? 5173),
    out: String(o.out ?? 'docs/media'),
    work: String(o.work ?? '.shots/film'),
    fps: Number(o.fps ?? 12),
    width: Number(o.width ?? 720),
    frames: o.frames ? Number(o.frames) : undefined,
    keep: !!o.keep,
    peek: !!o.peek,
    calm: !!o.calm,
  };
  const names = o.only ? String(o.only).split(',') : Object.keys(LOOPS);
  for (const n of names) if (!LOOPS[n]) throw new Error(`No loop called ${n}. There are: ${Object.keys(LOOPS).join(', ')}`);
  fs.mkdirSync(opt.out, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: GL });
  try {
    for (const n of names) await runLoop(browser, n, LOOPS[n], opt);
  } finally {
    await browser.close();
  }
}
