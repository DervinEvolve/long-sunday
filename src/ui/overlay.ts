// One overlay at a time. Opening one pauses the world, takes the keyboard, and hands both back on
// close. The caption, the index, and later the map and the settings all go through here.
import type { WorldApi } from '../types';
import { el } from './dom';

export interface OverlaySpec {
  /** The panel itself. Give it role="dialog" and a label. It joins the page on open and leaves on close. */
  el: HTMLElement;
  /** Runs once it has closed, however that happened. */
  onClose?: () => void;
}

export interface Overlays {
  /** Show this panel. Whatever was open closes first. */
  open(spec: OverlaySpec): void;
  /** Close whatever is open. Safe to call when nothing is. */
  close(): void;
  /** The panel that is open now, or null. */
  current(): HTMLElement | null;
}

// A little longer than --ls-dur-out, so the fade has finished before the panel leaves the page.
const LEAVE_MS = 170;
const CAN_FOCUS = 'a[href],button:not([disabled]),summary,input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** `world` is null on the page that has no 3D world behind it. */
export function createOverlays(root: HTMLElement, world: WorldApi | null): Overlays {
  const backdrop = el('div', 'ui-backdrop');
  backdrop.hidden = true;
  const host = el('div', 'ui-overlays');
  root.append(backdrop, host);

  let now: OverlaySpec | null = null;
  let back: HTMLElement | null = null;
  let leaving: HTMLElement | null = null;
  let leaveTimer = 0;

  function others(inert: boolean): void {
    for (const child of root.children) {
      if (child !== host && child !== backdrop) child.toggleAttribute('inert', inert);
    }
  }

  function finishLeaving(): void {
    clearTimeout(leaveTimer);
    if (leaving) leaving.remove();
    leaving = null;
    if (!now) backdrop.hidden = true;
  }

  function open(spec: OverlaySpec): void {
    finishLeaving();
    if (now) {
      const old = now;
      now = null;
      old.el.classList.remove('is-open');
      old.el.remove();
      old.onClose?.();
    } else {
      // Focus goes back to where it was only if the keyboard put it there. After a click or a tap
      // the keys should go straight back to walking.
      const a = document.activeElement;
      back = a instanceof HTMLElement && a !== document.body && a.matches(':focus-visible') ? a : null;
      world?.setPaused(true);
      others(true);
      root.classList.add('ui--overlay');
    }
    now = spec;
    backdrop.hidden = false;
    if (!spec.el.hasAttribute('tabindex')) spec.el.tabIndex = -1;
    host.appendChild(spec.el);
    void spec.el.offsetWidth; // the fade starts from the closed style
    spec.el.classList.add('is-open');
    // Focus lands on the panel, never on a button inside it: the key that opened it may still be
    // held down, and a held Enter or Space would press that button.
    spec.el.focus({ preventScroll: true });
  }

  function close(): void {
    if (!now) return;
    const spec = now;
    now = null;
    spec.el.classList.remove('is-open');
    root.classList.remove('ui--overlay');
    others(false);
    world?.setPaused(false);
    const target = back;
    back = null;
    if (target && target.isConnected && target.getClientRects().length > 0) target.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && spec.el.contains(document.activeElement)) document.activeElement.blur();
    finishLeaving();
    leaving = spec.el;
    leaveTimer = window.setTimeout(finishLeaving, LEAVE_MS);
    spec.onClose?.();
  }

  // Tab stays inside the panel.
  function wrap(e: KeyboardEvent, panel: HTMLElement): void {
    const stops: HTMLElement[] = [];
    for (const node of panel.querySelectorAll<HTMLElement>(CAN_FOCUS)) {
      if (node.getClientRects().length > 0) stops.push(node);
    }
    if (stops.length === 0) {
      e.preventDefault();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      first.focus();
    }
  }

  backdrop.addEventListener('click', close);
  window.addEventListener(
    'keydown',
    (e) => {
      if (!now) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') wrap(e, now.el);
    },
    true,
  );

  return { open, close, current: () => (now ? now.el : null) };
}
