// What stays on screen while walking: the name of the place on arrival, a prompt when something is
// in reach, a hint until the first step, and the corner buttons. Nothing here runs per frame. Every
// change comes from a world event.
import type { DistrictSite, PoiHit } from '../types';
import { ICON, el, icon, key } from './dom';
import { WORDS } from './words';

export interface CornerButton {
  /** What the button does, for anyone who cannot see the icon. Also the tooltip. */
  label: string;
  /** Path data on a 24 by 24 grid. */
  icon: string;
  /** Lettering beside the icon. Leave it out for a square icon button. */
  text?: string;
  onClick: () => void;
}

export interface HudOptions {
  onIndex: () => void;
  /** The visitor pressed or tapped the prompt. */
  onPrompt: (hit: PoiHit) => void;
}

export interface Hud {
  readonly el: HTMLElement;
  /** Bring the HUD in. Called once, when the walk starts. */
  show(): void;
  setDistrict(site: DistrictSite | null): void;
  setPoi(hit: PoiHit | null): void;
  /** The visitor has taken a first step. */
  moved(): void;
  /** Add a button to the top corner. The map and the settings go here. */
  addCornerButton(spec: CornerButton): HTMLButtonElement;
  /** Until a handler is set, map points show no prompt. Set it through the shell, which also wires the key. */
  setMapHandler(fn: (() => void) | null): void;
  mapHandler(): (() => void) | null;
}

const PLATE_MS = 4200;
const LETTER_MS = 38;

export function createHud(opts: HudOptions): Hud {
  const root = el('div', 'ui-hud');

  // One row along the top: the place name on the left, the buttons on the right. They share the
  // row, so the name can never slide under a button however many buttons there are.
  const top = el('div', 'ui-hud__top');
  const corner = el('div', 'ui-hud__corner');
  const plate = el('div', 'ui-plate');
  plate.setAttribute('aria-hidden', 'true');
  top.append(plate, corner);
  const say = el('p', 'ui-sr');
  say.setAttribute('role', 'status');
  root.append(top, say);

  const low = el('div', 'ui-hud__low');
  const hint = el('p', 'ui-hint');
  const hintKeys = el('span', 'ui-only-keys');
  hintKeys.append(key('W'), key('A'), key('S'), key('D'), WORDS.keysHint);
  hint.append(hintKeys, el('span', 'ui-only-touch', WORDS.thumbsHint));

  const prompt = el('button', 'ui-prompt ui-panel');
  prompt.type = 'button';
  const promptKey = key('E');
  promptKey.classList.add('ui-only-keys');
  promptKey.setAttribute('aria-hidden', 'true');
  const promptWords = el('span', 'ui-prompt__words');
  const promptDo = el('span', 'ui-prompt__do');
  const promptWhat = el('span', 'ui-prompt__what');
  promptWords.append(promptDo, promptWhat);
  prompt.append(promptKey, promptWords);
  low.append(hint, prompt);
  root.appendChild(low);

  let on = false;
  let here: DistrictSite | null = null;
  let poi: PoiHit | null = null;
  let onMap: (() => void) | null = null;
  let plateTimer = 0;
  let hasMoved = false;

  function addCornerButton(spec: CornerButton): HTMLButtonElement {
    const b = el('button', spec.text ? 'ui-btn ui-btn--small' : 'ui-icon-btn');
    b.type = 'button';
    b.appendChild(icon(spec.icon));
    if (spec.text) b.append(spec.text);
    if (spec.text !== spec.label) {
      b.setAttribute('aria-label', spec.label);
      b.title = spec.label;
    }
    b.addEventListener('click', () => {
      // After a mouse click or a tap the keys go back to walking.
      if (!b.matches(':focus-visible')) b.blur();
      spec.onClick();
    });
    corner.appendChild(b);
    return b;
  }

  function showPlate(site: DistrictSite): void {
    clearTimeout(plateTimer);
    const name = el('span', 'ui-plate__name', site.name);
    name.style.animationTimingFunction = `steps(${site.name.length}, end)`;
    name.style.animationDuration = `${site.name.length * LETTER_MS}ms`;
    plate.replaceChildren(name, el('span', 'ui-plate__years', site.years));
    plate.classList.add('is-on');
    say.textContent = `${site.name}, ${site.years}`;
    plateTimer = window.setTimeout(() => plate.classList.remove('is-on'), PLATE_MS);
  }

  function drawPrompt(): void {
    const hit = poi;
    const usable = hit !== null && (hit.action === 'entry' ? hit.entry !== null : onMap !== null);
    if (!hit || !usable) {
      prompt.classList.remove('is-on');
      low.classList.remove('has-prompt');
      return;
    }
    promptDo.textContent = hit.prompt;
    promptWhat.textContent = hit.entry ? hit.entry.title : '';
    promptWhat.hidden = !hit.entry;
    prompt.classList.add('is-on');
    low.classList.add('has-prompt');
  }

  prompt.addEventListener('click', () => {
    if (!prompt.matches(':focus-visible')) prompt.blur();
    if (poi) opts.onPrompt(poi);
  });

  addCornerButton({ label: WORDS.index, icon: ICON.index, text: WORDS.indexShort, onClick: opts.onIndex });

  return {
    el: root,
    show() {
      if (on) return;
      on = true;
      root.classList.add('is-on');
      if (!hasMoved) hint.classList.add('is-on');
      if (here) showPlate(here);
    },
    setDistrict(site) {
      if (site === here) return;
      here = site;
      if (on && site) showPlate(site);
    },
    setPoi(hit) {
      poi = hit;
      drawPrompt();
    },
    moved() {
      if (hasMoved) return;
      hasMoved = true;
      hint.classList.remove('is-on');
    },
    addCornerButton,
    setMapHandler(fn) {
      onMap = fn;
      drawPrompt();
    },
    mapHandler: () => onMap,
  };
}
