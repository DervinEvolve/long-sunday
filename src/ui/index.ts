// The interface shell. main.ts hands over the world and the #ui element. From here on the title card
// decides when the walk starts.
//
// The map, the settings and the address bar each live in a file of their own (map.ts, settings.ts,
// links.ts) and are wired in below. The seams they hang from:
//   getUi().overlays          open and close a panel, one at a time, the world paused behind it
//   getUi().hud               addCornerButton() for the map and settings
//   getUi().setMapHandler(fn) fn then runs on the M key, the touch map button and at map points
//   getUi().openEntry(id)     the caption for one entry
//   getUi().openIndex()       the index
//   getUi().goThere(id)       start the walk if it has not started, then stand in that district
//   tokens.css                every colour, size and rule as a CSS custom property
import './tokens.css';
import './ui.css';
import type { DistrictId, Entry, WorldApi } from '../types';
import { ENTRY_BY_ID } from '../content/content';
import { SITE_BY_ID } from '../world/layout';
import { createCaption } from './caption';
import { el } from './dom';
import { createHud, type Hud } from './hud';
import { createIndex } from './indexPage';
import { createLinks } from './links';
import { MAP_ICON, createMap } from './map';
import { createOverlays, type Overlays } from './overlay';
import { SETTINGS_ICON, createSettings } from './settings';
import { createTitle } from './title';
import { MORE } from './wordsMore';

export type { Overlays, OverlaySpec } from './overlay';
export type { CornerButton, Hud } from './hud';

export interface UiShell {
  readonly overlays: Overlays;
  /** Null on the page with no world behind it. */
  readonly hud: Hud | null;
  /** Open the caption for this entry. False when there is no such entry. */
  openEntry(id: string): boolean;
  openIndex(): void;
  /** Start the walk if need be and stand in this district. Does nothing with no world. */
  goThere(id: DistrictId): void;
  /** Say what opens the map. Until then the touch map button is hidden and map points show no prompt. */
  setMapHandler(fn: (() => void) | null): void;
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

  // The three ways into the map: the M key, the touch map button and a map point in the world.
  // The touch map button is drawn by the input layer (.ls-map), which only raises a flag the world
  // does not pass on, so I listen for its click here.
  const openMap = (): void => {
    if (walking && !overlays.current()) hud.mapHandler()?.();
  };
  touch.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('.ls-map')) openMap();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
    // The same key puts the map away again.
    if (map.isOpen()) overlays.close();
    else openMap();
  });
  function setMapHandler(fn: (() => void) | null): void {
    hud.setMapHandler(fn);
    root.classList.toggle('ui--map', fn !== null);
  }

  const map = createMap({ world, overlays, go: goThere });
  const settings = createSettings({ world, overlays, root });
  hud.addCornerButton({ label: MORE.map, icon: MAP_ICON, text: MORE.map, onClick: () => map.open() });
  hud.addCornerButton({ label: MORE.settings, icon: SETTINGS_ICON, onClick: () => settings.open() });
  setMapHandler(() => map.open());

  // A link can open straight at a place (#d=) or at a caption (#e=). Before the walk has started the
  // title card stays up over that place, the same as the ?d= switch.
  function follow(): void {
    const { entry, district } = links.read();
    const place = entry ? entry.district : district;
    if (!place) return;
    if (walking) overlays.close();
    world.teleport(place);
    if (entry) showEntry(entry);
  }
  follow();
  links.onChange(follow);

  shell = { overlays, hud, openEntry, openIndex: () => index.open(), goThere, setMapHandler };
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
    openEntry,
    openIndex: () => index.open(),
    goThere() {},
    setMapHandler() {},
  };
}
