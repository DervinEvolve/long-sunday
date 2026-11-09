// Boot. Makes the renderer, the quality governor, the input and the world, then runs the frame loop.
// The interface (title card, captions, map) lives in src/ui and is optional: without it the world
// starts straight into walking and shows a small prompt of its own.
//
// URL switches, all optional:
//   ?d=studio        start at that district's arrival point
//   ?solo=studio     build only that district
//   ?still=1         hold the clock at zero (for screenshots)
//   ?q=low|medium|high
//   ?debug=1         stats readout, colliders drawn in red
//   ?cam=x,y,z,tx,ty,tz   a fixed camera looking from the first point at the second
//   ?yaw=deg         face this way on arrival (0 is north, 90 is west)
//   ?ui=0            skip the interface even when it exists
import type { DistrictId, PoiHit, WorldApi } from './types';
import { createInk } from './engine/ink';
import { createQuality } from './engine/quality';
import { createInput } from './engine/input';
import { createWorld, type World } from './engine/world';
import { FONT_FAMILY } from './engine/lettering';
import { SITE_BY_ID, SPAWN } from './world/layout';

interface UiModule {
  mountUi?: (world: WorldApi, root: HTMLElement) => void;
  /** Shown when the browser cannot draw the world at all. */
  mountFallback?: (root: HTMLElement) => void;
  showFallback?: (root: HTMLElement) => void;
}

/** What window.__world carries: the world, plus a hook the interface can take over. */
export type WorldHooks = World & { openEntry(id: string): void };

declare global {
  interface Window {
    __world?: WorldHooks;
  }
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const uiFiles = import.meta.glob<UiModule>('./ui/index.ts');
const loadUi = uiFiles['./ui/index.ts'] as (() => Promise<UiModule>) | undefined;

function districtParam(name: string): DistrictId | null {
  const v = params.get(name);
  return v && v in SITE_BY_ID ? (v as DistrictId) : null;
}

function numbers(v: string | null): number[] | null {
  if (!v) return null;
  const out = v.split(',').map(Number);
  return out.length >= 3 && out.every(Number.isFinite) ? out : null;
}

function plainFallback(): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;padding:24px;pointer-events:auto;' +
    `font:20px/1.5 "${FONT_FAMILY}",system-ui,sans-serif;color:#1c1a33;background:#f6ecd9;text-align:center`;
  box.textContent = 'This browser could not start the 3D world (it needs WebGL 2). Try a current Chrome, Firefox or Safari.';
  uiRoot.appendChild(box);
}

async function fallback(): Promise<void> {
  canvas.style.display = 'none';
  try {
    const ui = loadUi ? await loadUi() : null;
    const show = ui?.mountFallback ?? ui?.showFallback;
    if (show) {
      show(uiRoot);
      return;
    }
  } catch (err) {
    console.error('[boot] the interface could not show its fallback', err);
  }
  plainFallback();
}

// The stand-in for the interface: one line near the bottom when something is in reach.
function builtInPrompt(world: World): void {
  const label = document.createElement('div');
  label.style.cssText =
    'position:fixed;left:50%;bottom:max(28px,env(safe-area-inset-bottom));transform:translateX(-50%);max-width:min(560px,86vw);' +
    `padding:8px 16px 9px;font:19px/1.35 "${FONT_FAMILY}",system-ui,sans-serif;color:#1c1a33;background:#f6ecd9;` +
    'border:2.5px solid #1c1a33;border-radius:5px 9px 6px 10px;box-shadow:4px 4px 0 #6f58c2;text-align:center;opacity:0;transition:opacity .18s';
  uiRoot.appendChild(label);
  let reading = 0;
  let current: PoiHit | null = null;
  const prompt = (hit: PoiHit | null): void => {
    if (!hit) {
      label.style.opacity = '0';
      return;
    }
    const key = world.isTouch ? 'Tap' : hit.action === 'map' ? 'M' : 'E';
    label.textContent = `${key}  ·  ${hit.prompt}${hit.entry ? ': ' + hit.entry.title : ''}`;
    label.style.opacity = '1';
  };
  world.on('poi', (hit) => {
    current = hit;
    if (!reading) prompt(hit);
  });
  world.on('interact', (hit) => {
    if (!hit.entry) return;
    label.textContent = `${hit.entry.title}. ${hit.entry.blurb}`;
    label.style.opacity = '1';
    clearTimeout(reading);
    reading = window.setTimeout(() => {
      reading = 0;
      prompt(current);
    }, 6000);
  });
}

function debugReadout(world: World): () => void {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 9px;font:12px/1.4 ui-monospace,Menlo,monospace;' +
    'color:#f6ecd9;background:rgba(28,26,51,.82);border-radius:4px;white-space:pre';
  uiRoot.appendChild(box);
  let n = 0;
  return () => {
    if (n++ % 12) return;
    const s = world.stats();
    const p = world.player();
    box.textContent =
      `calls ${s.calls}   tris ${s.triangles}\n` +
      `frame ${s.frameMs.toFixed(1)} ms   ratio ${s.pixelRatio.toFixed(2)}   ${s.tier}\n` +
      `at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}   yaw ${((p.yaw * 180) / Math.PI).toFixed(0)}   ${p.district ?? 'open ground'}\n` +
      `colliders near ${world.nearColliders().length}   built ${world.built().length}`;
  };
}

function boot(): void {
  const ink = createInk(canvas, 'medium');
  if (!ink) {
    void fallback();
    return;
  }
  const still = params.get('still') === '1';
  const debug = params.get('debug') === '1';
  const quality = createQuality('auto', ink.renderer.getContext());
  const input = createInput(canvas);
  const spawn = districtParam('d');
  const solo = districtParam('solo');
  const world = createWorld({ ink, quality, input, canvas, spawn: spawn ?? solo, solo, still });

  const yawDeg = Number(params.get('yaw'));
  const yaw = params.has('yaw') && Number.isFinite(yawDeg) ? (yawDeg * Math.PI) / 180 : undefined;
  const toStart = (): void => {
    const d = spawn ?? solo;
    if (d) world.teleport(d, yaw);
    else world.teleport({ x: SPAWN.x, z: SPAWN.z }, yaw ?? SPAWN.yaw);
  };
  if (yaw !== undefined) toStart();

  const cam = numbers(params.get('cam'));
  if (cam) world.setFreeCamera(cam, cam.slice(3));
  if (debug) world.showColliders(true);
  const readout = debug ? debugReadout(world) : null;

  const hooks = world as WorldHooks;
  hooks.openEntry = () => {};
  window.__world = hooks;

  // Size: follow the canvas box, and let the quality governor pick the pixel ratio.
  let sizeTimer = 0;
  const fit = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    world.resize(w, h, quality.pixelRatio);
  };
  fit();
  new ResizeObserver(() => {
    clearTimeout(sizeTimer);
    sizeTimer = window.setTimeout(fit, 80);
  }).observe(canvas);
  quality.onChange(fit);

  // The interface, when there is one. Otherwise walk straight in.
  const bare = (): void => {
    builtInPrompt(world);
    world.start();
    toStart(); // puts the camera behind him at once, where the title framing had it in front
  };
  if (loadUi && params.get('ui') !== '0') {
    loadUi()
      .then((ui) => {
        if (!ui.mountUi) throw new Error('src/ui/index.ts has no mountUi export');
        ui.mountUi(world, uiRoot);
      })
      .catch((err) => {
        console.error('[boot] the interface did not mount, carrying on without it', err);
        bare();
      });
  } else bare();

  let last = performance.now();
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    if (document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (world.ready && !still) quality.frame(dt);
    world.frame(dt);
    if (readout) readout();
  };
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });
  requestAnimationFrame(loop);
}

boot();
