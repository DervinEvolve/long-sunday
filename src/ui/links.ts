// The address bar. #d=<district> stands the visitor in a place and #e=<entry> opens a caption, so any
// spot in the world can be sent to someone as a link. While walking, the address follows along without
// adding to the Back history.
import './links.css';
import type { DistrictId, Entry } from '../types';
import { ENTRY_BY_ID } from '../content/content';
import { SITE_BY_ID } from '../world/layout';
import type { Overlays } from './overlay';

export interface LinkTarget {
  district: DistrictId | null;
  entry: Entry | null;
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
  /** The same overlay manager for the caption to use, with its closing noted in the address. */
  watch(overlays: Overlays): Overlays;
  /** Someone pasted a new address into the open page. */
  onChange(fn: () => void): void;
}

export function createLinks(): Links {
  let place: DistrictId | null = null;
  let entry: string | null = null;
  // A plain address stays plain until the visitor leaves the place they began in or opens something.
  let walking = false;
  let touched = location.hash.length > 1;

  function write(): void {
    const want = entry ? `#e=${entry}` : place ? `#d=${place}` : '';
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
      return {
        entry: e && Object.hasOwn(ENTRY_BY_ID, e) ? ENTRY_BY_ID[e] : null,
        district: d && Object.hasOwn(SITE_BY_ID, d) ? (d as DistrictId) : null,
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
