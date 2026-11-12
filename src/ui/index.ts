// The interface shell. main.ts hands over the world and the #ui element. From here on the title card
// decides when the walk starts.
//
// The map, the settings and the address bar each live in a file of their own (map.ts, settings.ts,
// links.ts) and are wired in below. The seams they hang from:
//   getUi().overlays          open and close a panel, one at a time, the world paused behind it
//   getUi().hud               addCornerButton() for the map and settings, addCornerEl() for the look switch
//   getUi().look              the switch between the drawn and the built world (look.ts)
//   getUi().setMapHandler(fn) fn then runs on the M key, the Map button and at map points
//   getUi().openEntry(id)     the caption for one entry
//   getUi().openIndex()       the index
//   getUi().goThere(id)       start the walk if it has not started, then stand in that district
//   tokens.css                every colour, size and rule as a CSS custom property
import './tokens.css';
import './ui.css';
import type { Collider, DistrictId, Entry, WorldApi } from '../types';
import { ENTRY_BY_ID } from '../content/content';
import { SITE_BY_ID } from '../world/layout';
import { createCaption } from './caption';
import { el } from './dom';
import { createHud, type Hud } from './hud';
import { createIndex } from './indexPage';
import { createLinks } from './links';
import { createLookButton, createLookNote, createLookSwitch, drawTitleLine, type LookSwitch } from './look';
import { MAP_ICON, createMap } from './map';
import { createOverlays, type Overlays } from './overlay';
import { SETTINGS_ICON, createSettings } from './settings';
import { createTitle } from './title';
import { MORE } from './wordsMore';

export type { Overlays, OverlaySpec } from './overlay';
export type { CornerButton, Hud } from './hud';
export type { LookSwitch } from './look';

export interface UiShell {
  readonly overlays: Overlays;
  /** Null on the page with no world behind it. */
  readonly hud: Hud | null;
  /** Drawn or built. Null on the page with no world behind it. */
  readonly look: LookSwitch | null;
  /** Open the caption for this entry. False when there is no such entry. */
  openEntry(id: string): boolean;
  openIndex(): void;
  /** Start the walk if need be and stand in this district. Does nothing with no world. */
  goThere(id: DistrictId): void;
  /** Say what opens the map. Until then map points show no prompt. */
  setMapHandler(fn: (() => void) | null): void;
}

/** One point of interest as the world lists them (World.spots in src/engine/world.ts). */
interface StandSpot {
  entry: string | null;
  x: number;
  z: number;
  reach: number;
}

/** The lookups the world offers beyond WorldApi, for finding where to stand. */
interface WorldLookup {
  spots(): StandSpot[];
  /** World space. A box `rot` turns the same way as rotation.y. */
  districtColliders(id: DistrictId): readonly Collider[];
}

const STAND_BACK = 3;
const FOOT = 0.45; // his footprint and a little room

function blocks(c: Collider, x: number, z: number): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.kind === 'circle') return Math.hypot(dx, dz) < c.r + FOOT;
  const r = c.rot ?? 0;
  const lx = dx * Math.cos(r) - dz * Math.sin(r);
  const lz = dx * Math.sin(r) + dz * Math.cos(r);
  return Math.abs(lx) < c.hw + FOOT && Math.abs(lz) < c.hd + FOOT;
}

let shell: UiShell | null = null;

/** The mounted interface, or null before mountUi has run. */
export function getUi(): UiShell | null {
  return shell;
}

export function mountUi(world: WorldApi, root: HTMLElement): void {
  root.classList.add('ui');

  // The stick and the look button are drawn by the input layer, under everything of mine.
  const touch = el('div', 'ui-touch');
  root.appendChild(touch);
  world.touchRoot(touch);

  let walking = false;
  let wantWalk = false;
  let wantPlace: DistrictId | null = null;
  let standLater: Entry | null = null;

  const hud = createHud({
    onIndex: () => index.open(),
    onPrompt: (hit) => {
      if (hit.action === 'entry') {
        if (hit.entry) showEntry(hit.entry);
      } else hud.mapHandler()?.();
    },
  });
  const title = createTitle({ onWalk: walkIn, onIndex: () => index.open() });
  root.append(hud.el, title.el);

  const overlays = createOverlays(root, world);
  const links = createLinks();
  const caption = createCaption(links.watch(overlays));
  const index = createIndex(overlays, goThere);

  // Every caption opens through here, so the address bar always names what is on screen.
  function showEntry(entry: Entry): void {
    caption.open(entry);
    links.setEntry(entry.id);
  }

  function walkIn(): void {
    if (walking) return;
    if (!world.ready) {
      wantWalk = true;
      title.setWaiting();
      return;
    }
    walking = true;
    title.hide();
    // The world may have named the place before I was listening.
    const at = world.player().district;
    if (at) hud.setDistrict(SITE_BY_ID[at]);
    links.begin(at);
    hud.show();
    world.start();
    if (wantPlace) {
      world.teleport(wantPlace);
      wantPlace = null;
    }
  }

  function goThere(id: DistrictId): void {
    overlays.close();
    if (walking) {
      world.teleport(id);
      return;
    }
    wantPlace = id;
    walkIn();
  }

  function openEntry(id: string): boolean {
    const entry = ENTRY_BY_ID[id];
    if (!entry) return false;
    showEntry(entry);
    return true;
  }

  function whenReady(): void {
    title.setReady();
    const stand = standLater ? standFor(standLater) : null;
    standLater = null;
    if (stand) world.teleport(stand, stand.yaw);
    if (wantWalk) walkIn();
  }

  world.on('progress', (p) => title.setProgress(p));
  world.on('ready', whenReady);
  world.on('district', (site) => {
    hud.setDistrict(site);
    links.setDistrict(site ? site.id : null);
  });
  world.on('poi', (hit) => hud.setPoi(hit));
  world.on('moved', () => hud.moved());
  world.on('interact', (hit) => {
    if (hit.action === 'entry') {
      if (hit.entry) showEntry(hit.entry);
    } else hud.mapHandler()?.();
  });
  if (world.ready) whenReady();

  // The world only knows it is on a touch screen once a finger lands, so look again after each press.
  let isTouch = !world.isTouch;
  function readTouch(): void {
    if (world.isTouch === isTouch) return;
    isTouch = world.isTouch;
    root.classList.toggle('ui--touch', isTouch);
  }
  readTouch();
  window.addEventListener('pointerdown', () => window.setTimeout(readTouch, 0), { passive: true });

  // The ways into the map: the M key, the Map button in the top row and a map point in the world.
  const openMap = (): void => {
    if (walking && !overlays.current()) hud.mapHandler()?.();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
    // The same key puts the map away again.
    if (map.isOpen()) overlays.close();
    else openMap();
  });
  function setMapHandler(fn: (() => void) | null): void {
    hud.setMapHandler(fn);
  }

  // Drawn or built. The switch sits between the map and the settings, and a link can ask for either.
  const look = createLookSwitch({ world, root, overlays, linked: links.read().look });
  look.onChange((v) => links.setLook(v.wanted));
  if (title.lookLine) drawTitleLine(title.lookLine, look);

  const map = createMap({ world, overlays, go: goThere });
  const settings = createSettings({ world, overlays, root, look });
  hud.addCornerButton({ label: MORE.map, icon: MAP_ICON, text: MORE.map, onClick: () => map.open() });
  hud.addCornerEl(createLookButton(look));
  hud.addCornerButton({ label: MORE.settings, icon: SETTINGS_ICON, onClick: () => settings.open() });
  hud.addCornerEl(createLookNote(look));
  setMapHandler(() => map.open());

  // A link can open straight at a place (#d=) or at a caption (#e=). Before the walk has started the
  // title card stays up over that place, the same as the ?d= switch.
  function follow(): void {
    const { entry, district, look: asked } = links.read();
    // A pasted link that names a look gets it. One that does not leaves the look alone.
    if (asked && asked !== look.view().wanted) look.set(asked, false);
    const place = entry ? entry.district : district;
    if (!place) return;
    if (walking) overlays.close();
    const stand = entry ? standFor(entry) : null;
    if (stand) world.teleport(stand, stand.yaw);
    else world.teleport(place);
    // Before the world is built there is nothing to stand in front of yet: the gate for now, and
    // the spot itself once it is ready.
    standLater = entry && !stand && !world.ready ? entry : null;
    if (entry) showEntry(entry);
  }

  // A link to one caption stands the visitor in front of its thing, a few steps off on the side the
  // road comes in from, facing it, so it is in reach once the caption is closed.
  function standFor(entry: Entry): { x: number; z: number; yaw: number } | null {
    const more = world as WorldApi & Partial<WorldLookup>;
    const spot = more.spots?.().find((s) => s.entry === entry.id);
    const site = SITE_BY_ID[entry.district];
    if (!spot || !site) return null;
    const solid = more.districtColliders?.(entry.district) ?? [];
    const toward = Math.atan2(site.center.x + site.arrive.x - spot.x, site.center.z + site.arrive.z - spot.z);
    const back = Math.min(STAND_BACK, spot.reach * 0.6);
    // Straight back toward the road first, then swinging either side until the ground is clear.
    for (let i = 0; i < 12; i++) {
      const turn = Math.ceil(i / 2) * (i % 2 ? 1 : -1) * (Math.PI / 6);
      const dx = Math.sin(toward + turn) * back;
      const dz = Math.cos(toward + turn) * back;
      const x = spot.x + dx;
      const z = spot.z + dz;
      // Facing the thing: the way from the stand point back to it.
      if (!solid.some((c) => blocks(c, x, z))) return { x, z, yaw: Math.atan2(dx, dz) };
    }
    return null;
  }
  follow();
  links.onChange(follow);

  shell = { overlays, hud, look, openEntry, openIndex: () => index.open(), goThere, setMapHandler };
  if (window.__world) window.__world.openEntry = openEntry;
}

/** No WebGL: the same card on flat paper, with the index as the only way in. */
export function mountFallback(root: HTMLElement): void {
  root.classList.add('ui', 'ui--flat');
  if (window.matchMedia('(hover: none)').matches) root.classList.add('ui--touch');

  const title = createTitle({ onWalk: null, onIndex: () => index.open() });
  root.appendChild(title.el);
  const overlays = createOverlays(root, null);
  const links = createLinks();
  const caption = createCaption(links.watch(overlays));
  const index = createIndex(overlays, null);

  function openEntry(id: string): boolean {
    const entry = ENTRY_BY_ID[id];
    if (!entry) return false;
    caption.open(entry);
    links.setEntry(id);
    return true;
  }
  // No places to stand in here, but a link to a caption still opens it.
  const follow = (): void => {
    const { entry } = links.read();
    if (entry) openEntry(entry.id);
  };
  follow();
  links.onChange(follow);

  shell = {
    overlays,
    hud: null,
    look: null,
    openEntry,
    openIndex: () => index.open(),
    goThere() {},
    setMapHandler() {},
  };
}
