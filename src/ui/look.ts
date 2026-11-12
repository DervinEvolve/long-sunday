// The switch between the two looks: Drawn (the ink world) and Built (the same place made for real).
// One small state machine listens to the world and keeps every control in step: the switch in the
// top corner, the row in the settings, the line on the title card and the address bar. The L key
// presses it. A choice made here is kept for the next visit. A first visit always opens drawn.
import './look.css';
import type { Look, WorldApi } from '../types';
import type { Overlays } from './overlay';
import { el, icon, key, uid } from './dom';
import { LOOK } from './wordsLook';

/** A pen nib, point down, with its slit and breather hole. */
export const NIB_ICON = 'M12 21.5L5.8 11.6L8.6 2.8h6.8l2.8 8.8z M12 21.5v-7.6 M10.4 12a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0';
/** A low sun beside a small temple front on the ground line: the same place, built and lit. */
export const BUILT_ICON = 'M2 20.5h20 M2.5 12.5L9.5 8l7 4.5z M4.5 20.5v-8 M9.5 20.5v-8 M14.5 20.5v-8 M15.8 5.2a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0-5.6 0';

const STORE = 'long-sunday.look';
const NOTE_MS = 12000;
const KEY = 'L';

export interface LookView {
  /** The look asked for last: the one on screen, or the one on its way. */
  wanted: Look;
  /** The look that fills the screen now. */
  shown: Look;
  /** True while the built version's files are coming in. */
  loading: boolean;
  /** 0 to 1 while loading. */
  progress: number;
  /** The last request failed and the visitor has not asked again since. */
  failed: boolean;
}

export interface LookSwitch {
  /** False when this build or this device has no built version. Then nothing of it is shown. */
  available(): boolean;
  view(): LookView;
  /** Ask for a look. `keep` writes the choice down for the next visit. */
  set(look: Look, keep: boolean): void;
  /** What the button and the key do: the other look, or stop a load on its way. */
  toggle(): void;
  onChange(fn: (v: LookView) => void): void;
}

export interface LookOptions {
  world: WorldApi;
  root: HTMLElement;
  overlays: Overlays;
  /** The look a link asked for (#look=built), or null. It wins over the kept choice. */
  linked: Look | null;
}

function readKept(): Look | null {
  try {
    const v = localStorage.getItem(STORE);
    return v === 'real' || v === 'ink' ? v : null;
  } catch {
    return null;
  }
}

function keep(look: Look): void {
  try {
    localStorage.setItem(STORE, look);
  } catch {
    // Not kept, then. It still holds until the tab closes.
  }
}

export function createLookSwitch(opts: LookOptions): LookSwitch {
  const { world, root } = opts;
  const listeners: ((v: LookView) => void)[] = [];
  const view: LookView = { wanted: world.look(), shown: world.look(), loading: false, progress: 0, failed: false };
  let request = 0;
  let failedRequest = -1;
  let canShow = safeAvailable();

  function safeAvailable(): boolean {
    try {
      return world.lookAvailable();
    } catch {
      return false;
    }
  }

  // Spoken news. While a panel is open everything outside it goes quiet, so the settings row has a
  // live line of its own.
  const say = el('p', 'ui-sr');
  say.setAttribute('role', 'status');
  root.append(say);

  function speak(text: string): void {
    // The same words twice running would not be read again, so clear first.
    say.textContent = '';
    window.setTimeout(() => {
      say.textContent = text;
    }, 30);
  }

  function changed(): void {
    root.classList.toggle('ui--built', view.shown === 'real');
    for (const fn of listeners) fn(view);
  }

  function fail(): void {
    failedRequest = request;
    view.wanted = 'ink';
    view.shown = world.look();
    view.loading = false;
    view.progress = 0;
    view.failed = true;
    // Do not try again on every visit.
    if (readKept() === 'real') keep('ink');
    canShow = safeAvailable();
    speak(LOOK.failed);
    changed();
  }

  function set(look: Look, store: boolean): void {
    if (look === 'real' && !canShow) return;
    if (store) keep(look);
    const mine = ++request;
    const was = view.wanted;
    const stopping = look === 'ink' && view.loading;
    view.wanted = look;
    view.failed = false;
    if (look === 'real' && view.shown !== 'real') {
      if (!view.loading) {
        view.loading = true;
        view.progress = 0;
        speak(LOOK.sayLoading);
      }
    } else view.loading = false;
    if (stopping) speak(LOOK.sayStopped);
    if (was !== look || look === 'real') changed();
    world.setLook(look).catch(() => {
      // The world sends 'failed' as well. This covers a refusal that comes without it.
      if (mine === request && failedRequest !== mine) fail();
    });
  }

  world.on('look', (e) => {
    if (e.state === 'loading') {
      // The world only reports the load it is still on, whoever asked for it.
      view.wanted = 'real';
      view.loading = true;
      view.failed = false;
      view.progress = Math.max(view.progress, Math.min(1, e.progress ?? 0));
      changed();
    } else if (e.state === 'on') {
      const before = view.shown;
      view.shown = e.look;
      view.wanted = e.look;
      view.loading = false;
      view.progress = 0;
      if (e.look === 'real' && before !== 'real') speak(LOOK.sayBuilt);
      else if (e.look === 'ink' && before === 'real') speak(LOOK.sayDrawn);
      changed();
    } else if (failedRequest !== request) fail();
  });

  // The key. Free of the walking keys, E, M and Space. Not while a panel is open or text is typed.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyL' && !(e.code === '' && e.key.toLowerCase() === 'l')) return;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || !canShow) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (opts.overlays.current()) return;
    e.preventDefault();
    toggle();
  });

  function toggle(): void {
    if (!canShow) return;
    set(view.wanted === 'real' ? 'ink' : 'real', true);
  }

  // Where the page starts. ?look=real has already asked the world before I was listening. A link
  // asks next, then the choice kept from an earlier visit. A first visit stays in the drawing.
  if (canShow) {
    const asked = new URLSearchParams(location.search).get('look') === 'real';
    const want = asked ? 'real' : (opts.linked ?? readKept());
    if (asked && view.shown !== 'real') {
      view.wanted = 'real';
      view.loading = true;
    } else if (want === 'real') set('real', false);
  }

  return {
    available: () => canShow,
    view: () => view,
    set,
    toggle,
    onChange(fn) {
      listeners.push(fn);
      fn(view);
    },
  };
}

/** What pressing does next, in words. */
function nextWords(v: LookView): string {
  if (v.loading) return LOOK.toStop;
  if (v.failed) return LOOK.toRetry;
  return v.wanted === 'real' ? LOOK.toDrawn : LOOK.toBuilt;
}

/** The switch for the top corner: both looks side by side, the one on screen inked in. */
export function createLookButton(sw: LookSwitch): HTMLButtonElement {
  const b = el('button', 'ui-btn ui-btn--small ui-look');
  b.type = 'button';
  b.setAttribute('aria-label', LOOK.name);
  b.setAttribute('aria-keyshortcuts', KEY);
  const descId = uid('look');
  b.setAttribute('aria-describedby', descId);

  const side = (cls: string, d: string, word: string): HTMLElement => {
    const s = el('span', `ui-look__side ${cls}`);
    s.append(icon(d), el('span', 'ui-look__word', word));
    return s;
  };
  const drawn = side('ui-look__side--ink', NIB_ICON, LOOK.drawn);
  const built = side('ui-look__side--real', BUILT_ICON, LOOK.built);
  const bar = el('span', 'ui-look__bar');
  const fill = el('span', 'ui-look__fill');
  bar.appendChild(fill);
  built.appendChild(bar);
  const desc = el('span', 'ui-sr');
  desc.id = descId;
  b.append(drawn, built, desc);

  b.addEventListener('click', () => {
    // After a mouse click or a tap the keys go back to walking.
    if (!b.matches(':focus-visible')) b.blur();
    sw.toggle();
  });

  sw.onChange((v) => {
    const hide = !sw.available();
    if (hide && b === document.activeElement) b.blur();
    b.hidden = hide;
    const on = v.loading ? 'ink' : v.wanted;
    b.setAttribute('aria-pressed', String(on === 'real'));
    b.dataset.look = on;
    b.toggleAttribute('data-loading', v.loading);
    b.setAttribute('aria-busy', String(v.loading));
    fill.style.transform = `scaleX(${v.loading ? Math.max(0.05, v.progress) : 0})`;
    const words = nextWords(v);
    desc.textContent = words;
    b.title = `${words} (${KEY})`;
  });
  return b;
}

/** One calm line under the corner buttons when the built version would not load. */
export function createLookNote(sw: LookSwitch): HTMLElement {
  const note = el('p', 'ui-look-note');
  // The status line already said it.
  note.setAttribute('aria-hidden', 'true');
  note.hidden = true;
  note.textContent = LOOK.failed;
  let timer = 0;
  let was = false;
  sw.onChange((v) => {
    if (v.failed && !was) {
      clearTimeout(timer);
      note.hidden = false;
      timer = window.setTimeout(() => {
        note.hidden = true;
      }, NOTE_MS);
    } else if (!v.failed) {
      clearTimeout(timer);
      note.hidden = true;
    }
    was = v.failed;
  });
  return note;
}

/** The row in the settings: the same choice as two lettered keys. */
export function createLookSetting(sw: LookSwitch): HTMLElement {
  const set = el('fieldset', 'ui-settings__set ui-look-set');
  const noteId = uid('look');
  set.setAttribute('aria-describedby', noteId);
  set.appendChild(el('legend', 'ui-settings__label', LOOK.setting));
  const row = el('div', 'ui-seg ui-seg--two');
  const name = uid('look');
  const inputs = {} as Record<Look, HTMLInputElement>;
  for (const [look, word, d] of [
    ['ink', LOOK.drawn, NIB_ICON],
    ['real', LOOK.built, BUILT_ICON],
  ] as const) {
    const item = el('label', 'ui-seg__item');
    const input = el('input', 'ui-sr');
    input.type = 'radio';
    input.name = name;
    input.value = look;
    input.addEventListener('change', () => {
      if (input.checked) sw.set(look, true);
    });
    inputs[look] = input;
    const face = el('span', 'ui-seg__face ui-look-set__face');
    face.append(icon(d), word);
    item.append(input, face);
    row.appendChild(item);
  }
  const note = el('p', 'ui-settings__note', LOOK.settingNote);
  note.id = noteId;
  // How a load is going, read out while the panel has the page.
  const status = el('p', 'ui-settings__note ui-look-set__status');
  status.setAttribute('role', 'status');
  set.append(row, note, status);

  let said = '';
  sw.onChange((v) => {
    set.hidden = !sw.available() && !v.failed;
    inputs[v.wanted].checked = true;
    inputs.real.disabled = !sw.available();
    // Only the turns of the story, never each step of the count.
    const now = v.loading ? LOOK.loading : v.failed ? LOOK.failed : '';
    if (now !== said) {
      said = now;
      status.textContent = now;
    }
    status.hidden = !now;
    row.toggleAttribute('data-loading', v.loading);
    row.style.setProperty('--ui-look-progress', String(v.loading ? Math.max(0.05, v.progress) : 0));
  });
  return set;
}

/** The key, as a row for the list of controls. Null when there is nothing to switch. */
export function lookKeyRow(sw: LookSwitch): [(string | Node)[], string] | null {
  return sw.available() ? [[key(KEY)], LOOK.keyRow] : null;
}

export function lookTouchRow(sw: LookSwitch): [(string | Node)[], string] | null {
  return sw.available() ? [[LOOK.touchHow], LOOK.keyRow] : null;
}

/** The one line on the title card. It follows the look, and shows how far a load has got. */
export function drawTitleLine(slot: HTMLElement, sw: LookSwitch): void {
  const keys = el('span', 'ui-only-keys');
  const touch = el('span', 'ui-only-touch');
  const busy = el('span');
  slot.append(keys, touch, busy);
  let last = '';
  sw.onChange((v) => {
    slot.hidden = !sw.available() && !v.failed;
    const state = v.failed ? 'failed' : v.loading ? 'loading' : v.wanted;
    const pct = Math.round(v.progress * 100);
    const stamp = state === 'loading' ? `loading ${pct}` : state;
    if (stamp === last) return;
    last = stamp;
    const idle = state === 'ink' || state === 'real';
    keys.hidden = touch.hidden = !idle;
    busy.hidden = idle;
    if (state === 'ink') {
      keys.replaceChildren(LOOK.titleKeys, key(KEY), LOOK.titleKeysEnd);
      touch.textContent = LOOK.titleTouch;
    } else if (state === 'real') {
      keys.replaceChildren(LOOK.titleBuiltKeys, key(KEY), LOOK.titleBuiltKeysEnd);
      touch.textContent = LOOK.titleBuiltTouch;
    } else if (state === 'loading') busy.textContent = `${LOOK.loading}, ${pct}%`;
    else busy.textContent = LOOK.failed;
  });
}
