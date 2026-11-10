// The pieces of one entry that the caption and the index both draw.
import type { Entry } from '../types';
import { STATUS_LABEL } from '../content/content';
import { ICON, el, icon, spoken } from './dom';
import { WORDS } from './words';

/** Who it was for and when. Null when the entry has neither. */
export function entryMeta(entry: Entry): HTMLElement | null {
  const parts: string[] = [];
  if (entry.org) parts.push(entry.org);
  if (entry.dates) parts.push(entry.dates);
  return parts.length ? el('p', 'ui-entry__meta', parts.join(', ')) : null;
}

/** The status, pressed on like a rubber stamp. Null when the entry has none. */
export function entryStamp(entry: Entry): HTMLElement | null {
  return entry.status ? el('span', 'ui-stamp', STATUS_LABEL[entry.status]) : null;
}

export function link(label: string, url: string): HTMLAnchorElement {
  const a = el('a', 'ui-link', label);
  a.href = url;
  if (/^https?:/.test(url)) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(icon(ICON.out), spoken(WORDS.newTab));
  }
  return a;
}

export function entryBullets(entry: Entry): HTMLElement | null {
  if (!entry.bullets || entry.bullets.length === 0) return null;
  const list = el('ul', 'ui-entry__facts');
  for (const fact of entry.bullets) list.appendChild(el('li', undefined, fact));
  return list;
}

export function entryLinks(entry: Entry): HTMLElement | null {
  if (!entry.links || entry.links.length === 0) return null;
  const list = el('ul', 'ui-entry__links');
  for (const l of entry.links) {
    const item = el('li');
    item.appendChild(link(l.label, l.url));
    list.appendChild(item);
  }
  return list;
}
