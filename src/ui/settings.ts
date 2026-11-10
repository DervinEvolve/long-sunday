// Settings: how finely the world is drawn, how much the interface moves, and what the controls are.
// The two choices are kept on this device so a second visit starts the way the first one ended.
import './settings.css';
import type { QualityTier, WorldApi } from '../types';
import type { Overlays } from './overlay';
import { el, escKey, key, uid } from './dom';
import { WORDS } from './words';
import { MORE } from './wordsMore';

export interface SettingsOptions {
  world: WorldApi;
  overlays: Overlays;
  /** The interface root. It carries the class that stills the interface. */
  root: HTMLElement;
}

export interface SettingsPanel {
  open(): void;
}

/** Two sliders. */
export const SETTINGS_ICON = 'M4 7h8M18 7h2M12 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0M4 17h2M12 17h8M6 17a3 3 0 1 0 6 0a3 3 0 1 0-6 0';

type Tier = QualityTier | 'auto';
const TIERS: readonly Tier[] = ['auto', 'low', 'medium', 'high'];
const STORE = 'long-sunday.settings';

interface Saved {
  quality: Tier;
  /** Null until the visitor chooses. Until then the device setting decides. */
  calm: boolean | null;
}

const isTier = (v: unknown): v is Tier => TIERS.includes(v as Tier);

function load(): Saved {
  const saved: Saved = { quality: 'auto', calm: null };
  try {
    const raw = localStorage.getItem(STORE);
    const got: unknown = raw ? JSON.parse(raw) : null;
    if (got && typeof got === 'object') {
      const { quality, calm } = got as Record<string, unknown>;
      if (isTier(quality)) saved.quality = quality;
      if (typeof calm === 'boolean') saved.calm = calm;
    }
  } catch {
    // Storage is off or holds something else. The defaults are fine.
  }
  return saved;
}

function save(saved: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    // Not kept, then. The choice still holds until the tab closes.
  }
}

export function createSettings(opts: SettingsOptions): SettingsPanel {
  const saved = load();
  // A ?q= in the address pins the tier for this visit and wins over what was kept.
  const asked = new URLSearchParams(location.search).get('q');
  const pinned = isTier(asked) && asked !== 'auto' ? asked : null;
  const quality: Tier = pinned ?? saved.quality;
  if (!pinned && quality !== 'auto') opts.world.setQuality(quality);

  const device = window.matchMedia('(prefers-reduced-motion: reduce)');
  let calmBox: HTMLInputElement | null = null;
  function applyCalm(): void {
    const calm = saved.calm ?? device.matches;
    opts.root.classList.toggle('ui--calm', calm);
    opts.root.classList.toggle('ui--lively', !calm);
    if (calmBox) calmBox.checked = calm;
  }
  applyCalm();
  device.addEventListener('change', applyCalm);

  let panel: HTMLElement | null = null;

  function qualitySet(): HTMLElement {
    const set = el('fieldset', 'ui-settings__set');
    const noteId = uid('quality');
    set.setAttribute('aria-describedby', noteId);
    set.appendChild(el('legend', 'ui-settings__label', MORE.quality));
    const row = el('div', 'ui-seg');
    const name = uid('tier');
    for (const tier of TIERS) {
      const item = el('label', 'ui-seg__item');
      const input = el('input', 'ui-sr');
      input.type = 'radio';
      input.name = name;
      input.value = tier;
      input.checked = tier === quality;
      input.addEventListener('change', () => {
        saved.quality = tier;
        save(saved);
        opts.world.setQuality(tier);
      });
      item.append(input, el('span', 'ui-seg__face', MORE[tier]));
      row.appendChild(item);
    }
    const note = el('p', 'ui-settings__note', MORE.qualityNote);
    note.id = noteId;
    set.append(row, note);
    return set;
  }

  function calmCheck(): HTMLElement {
    const nameId = uid('calm');
    const noteId = uid('calm');
    const row = el('label', 'ui-check');
    const box = el('input', 'ui-check__box');
    box.type = 'checkbox';
    // The whole row takes the press, but only the first line is the name.
    box.setAttribute('aria-labelledby', nameId);
    box.setAttribute('aria-describedby', noteId);
    box.addEventListener('change', () => {
      saved.calm = box.checked;
      save(saved);
      applyCalm();
    });
    calmBox = box;
    const words = el('span', 'ui-check__words');
    const note = el('span', 'ui-settings__note', MORE.calmNote);
    note.id = noteId;
    const name = el('span', 'ui-settings__label', MORE.calm);
    name.id = nameId;
    words.append(name, note);
    row.append(box, words);
    return row;
  }

  function controls(): HTMLElement {
    const headId = uid('controls');
    const section = el('section', 'ui-settings__set');
    section.setAttribute('aria-labelledby', headId);
    const head = el('h3', 'ui-settings__label', MORE.controls);
    head.id = headId;
    section.appendChild(head);

    const list = (className: string, rows: [(string | Node)[], string][]): HTMLElement => {
      const dl = el('dl', `ui-controls ${className}`);
      for (const [how, what] of rows) {
        const row = el('div', 'ui-controls__row');
        const dt = el('dt');
        dt.append(...how);
        row.append(dt, el('dd', undefined, what));
        dl.appendChild(row);
      }
      return dl;
    };
    section.append(
      list('ui-only-keys', [
        [[key('W'), key('A'), key('S'), key('D'), ` ${MORE.or}`], MORE.walk],
        [[key('Shift')], MORE.run],
        [[MORE.drag], MORE.look],
        [[key('E')], MORE.closer],
        [[key('M')], MORE.map],
        [[key('Esc')], WORDS.close],
      ]),
      list('ui-only-touch', [
        [[MORE.thumb], MORE.walk],
        [[MORE.drag], MORE.look],
        [[MORE.eye], MORE.closer],
        [[MORE.mapButton], MORE.map],
      ]),
    );
    return section;
  }

  function build(): HTMLElement {
    const titleId = uid('settings');
    const root = el('div', 'ui-settings ui-panel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', titleId);

    const head = el('div', 'ui-settings__head');
    const title = el('h2', 'ui-settings__title', MORE.settings);
    title.id = titleId;
    const close = el('button', 'ui-btn ui-btn--small ui-settings__close');
    close.type = 'button';
    close.append(WORDS.close, escKey());
    close.addEventListener('click', () => opts.overlays.close());
    head.append(title, close);

    const body = el('div', 'ui-settings__body');
    body.append(qualitySet(), calmCheck(), controls());
    root.append(head, body);
    applyCalm();
    return root;
  }

  return {
    open() {
      if (!panel) panel = build();
      opts.overlays.open({ el: panel });
    },
  };
}
