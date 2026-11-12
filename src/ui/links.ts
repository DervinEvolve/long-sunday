// The address bar. #d=<district> stands the visitor in a place and #e=<entry> opens a caption, so any
// spot in the world can be sent to someone as a link. #look=built asks for the built version of the
// world, and goes with either of the others (#d=studio&look=built). While walking, the address follows
// along without adding to the Back history.
import './links.css';
import type { DistrictId, Entry, Look } from '../types';
import { ENTRY_BY_ID } from '../content/content';
import { SITE_BY_ID } from '../world/layout';
import type { Overlays } from './overlay';

export interface LinkTarget {
  district: DistrictId | null;
  entry: Entry | null;
  /** Null when the address says nothing about the look. */
  look: Look | null;
}

export interface Links {
  /** What the address asks for right now. Ids I do not know come back as null. */
  read(): LinkTarget;
  /** The walk has started, in this district. From here on the address follows the visitor. */
  begin(at: DistrictId | null): void;
  /** The visitor stands somewhere new. Null out on open ground, which keeps the last place. */
  setDistrict(id: DistrictId | null): void;
  /** A caption opened, or with null the caption closed. */
  setEntry(id: string | null): void;
  /** The look asked for changed. The built one is written into the address, the drawing is not. */
  setLook(look: Look): void;
  /** The same overlay manager for the caption to use, with its closing noted in the address. */
  watch(overlays: Overlays): Overlays;
  /** Someone pasted a new address into the open page. */
  onChange(fn: () => void): void;
}

export function createLinks(): Links {
  let place: DistrictId | null = null;
  let entry: string | null = null;
  let look: Look = 'ink';
  // A plain address stays plain until the visitor leaves the place they began in or opens something.
  let walking = false;
  let touched = location.hash.length > 1;

  function write(): void {
    const where = entry ? `e=${entry}` : place && touched ? `d=${place}` : '';
    const how = look === 'real' ? 'look=built' : '';
    const want = where || how ? `#${[where, how].filter(Boolean).join('&')}` : '';
    if (want === location.hash) return;
    try {
      history.replaceState(history.state, '', want || location.pathname + location.search);
    } catch {
      // A sandboxed frame can refuse. The link is a convenience, the walk goes on without it.
    }
  }

  function setEntry(id: string | null): void {
    if (id === entry) return;
    entry = id;
    if (id) touched = true;
    if (touched) write();
  }

  return {
    read() {
      const q = new URLSearchParams(location.hash.slice(1));
      const e = q.get('e');
      const d = q.get('d');
      const l = q.get('look');
      return {
        entry: e && Object.hasOwn(ENTRY_BY_ID, e) ? ENTRY_BY_ID[e] : null,
        district: d && Object.hasOwn(SITE_BY_ID, d) ? (d as DistrictId) : null,
        look: l === 'built' || l === 'real' ? 'real' : l === 'drawn' || l === 'ink' ? 'ink' : null,
      };
    },
    begin(at) {
      walking = true;
      if (at) place = at;
    },
    setDistrict(id) {
      if (!id || id === place) return;
      place = id;
      if (!touched && !walking) return;
      touched = true;
      write();
    },
    setEntry,
    setLook(next) {
      if (next === look) return;
      look = next;
      // Built goes into the address at once, so the link on screen is the one to send. Back in the
      // drawing it comes out again, and a plain address stays plain.
      // An address that already asks for built is left as it is, so a link opened here keeps its place.
      const says = /(^#|&)look=/.test(location.hash);
      if (next === 'real' ? !/(^#|&)look=(built|real)(&|$)/.test(location.hash) : says) write();
    },
    watch(overlays) {
      return {
        open(spec) {
          overlays.open({
            el: spec.el,
            onClose() {
              spec.onClose?.();
              setEntry(null);
            },
          });
        },
        close: () => overlays.close(),
        current: () => overlays.current(),
      };
    },
    onChange(fn) {
      window.addEventListener('hashchange', fn);
    },
  };
}
