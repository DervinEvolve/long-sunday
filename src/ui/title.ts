// The title card. It sits in a corner over the world while the world is still being drawn, says
// whose place this is, and offers the two ways in.
import { SITE } from '../content/content';
import { el, key, uid } from './dom';
import { WORDS } from './words';

export interface TitleOptions {
  /** Left out on the page with no world behind it. Then only the index is offered. */
  onWalk: (() => void) | null;
  onIndex: () => void;
}

export interface TitleCard {
  readonly el: HTMLElement;
  /** An empty line at the foot of the card for the two looks. Null on the page with no world. */
  readonly lookLine: HTMLElement | null;
  /** 0 to 1, how much of the world is drawn. */
  setProgress(p: number): void;
  setReady(): void;
  /** Walk in was pressed before the world was ready. */
  setWaiting(): void;
  hide(): void;
}

const LEAVE_MS = 170;

export function createTitle(opts: TitleOptions): TitleCard {
  const nameId = uid('title');
  const root = el('section', 'ui-title');
  root.setAttribute('aria-labelledby', nameId);
  const card = el('div', 'ui-title__card ui-panel');
  root.appendChild(card);

  const name = el('h1', 'ui-title__name', SITE.title);
  name.id = nameId;
  card.append(el('p', 'ui-title__owner', WORDS.owner), name, el('p', 'ui-title__what', WORDS.what));

  let label: HTMLElement | null = null;
  let track: HTMLElement | null = null;
  let fill: HTMLElement | null = null;
  let walk: HTMLButtonElement | null = null;
  let lookLine: HTMLElement | null = null;

  if (opts.onWalk) {
    const progress = el('div', 'ui-title__progress');
    label = el('p', 'ui-title__label', WORDS.drawing);
    label.setAttribute('aria-live', 'polite');
    track = el('div', 'ui-title__track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', WORDS.drawing);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');
    fill = el('div', 'ui-title__fill');
    track.appendChild(fill);
    progress.append(label, track);
    card.appendChild(progress);
  } else {
    card.appendChild(el('p', 'ui-title__note', WORDS.noWebgl));
  }

  const actions = el('div', 'ui-title__actions');
  if (opts.onWalk) {
    const onWalk = opts.onWalk;
    walk = el('button', 'ui-btn ui-btn--primary', WORDS.walk);
    walk.type = 'button';
    walk.addEventListener('click', onWalk);
    actions.appendChild(walk);
  }
  const index = el('button', opts.onWalk ? 'ui-btn' : 'ui-btn ui-btn--primary', WORDS.index);
  index.type = 'button';
  index.addEventListener('click', opts.onIndex);
  actions.appendChild(index);
  card.appendChild(actions);

  if (opts.onWalk) {
    const keys = el('p', 'ui-title__help ui-only-keys');
    keys.append(key('W'), key('A'), key('S'), key('D'), WORDS.keysTitle, key('E'), WORDS.keysTitleEnd);
    card.append(keys, el('p', 'ui-title__help ui-only-touch', WORDS.thumbsTitle));
    lookLine = el('p', 'ui-title__help ui-title__look');
    lookLine.hidden = true;
    card.appendChild(lookLine);
  }

  let shown = -1;
  let ready = false;

  return {
    el: root,
    lookLine,
    setProgress(p) {
      if (!track || !fill || ready) return;
      const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
      if (pct === shown) return;
      shown = pct;
      fill.style.transform = `scaleX(${pct / 100})`;
      track.setAttribute('aria-valuenow', String(pct));
    },
    setReady() {
      if (ready) return;
      ready = true;
      if (fill) fill.style.transform = 'scaleX(1)';
      if (track) track.setAttribute('aria-valuenow', '100');
      if (label) label.textContent = WORDS.ready;
      if (walk) walk.removeAttribute('aria-disabled');
    },
    setWaiting() {
      if (ready) return;
      if (label) label.textContent = WORDS.soon;
      if (walk) walk.setAttribute('aria-disabled', 'true');
    },
    hide() {
      if (root.hidden) return;
      // A button left holding focus would swallow the walking keys.
      const a = document.activeElement;
      if (a instanceof HTMLElement && root.contains(a)) a.blur();
      root.classList.add('is-gone');
      window.setTimeout(() => {
        root.hidden = true;
      }, LEAVE_MS);
    },
  };
}
