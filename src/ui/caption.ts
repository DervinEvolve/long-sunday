// The caption box: one entry, read up close. Off to the side on a wide screen so the thing it
// describes stays in view, a sheet along the bottom on a phone.
import type { Entry } from '../types';
import { SITE_BY_ID } from '../world/layout';
import type { Overlays } from './overlay';
import { el, escKey, uid } from './dom';
import { entryBullets, entryLinks, entryMeta, entryStamp } from './entryParts';
import { WORDS } from './words';

export interface Caption {
  open(entry: Entry): void;
}

export function createCaption(overlays: Overlays): Caption {
  const titleId = uid('caption');
  const panel = el('div', 'ui-caption ui-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', titleId);

  const head = el('div', 'ui-caption__head');
  const where = el('p', 'ui-caption__where');
  const close = el('button', 'ui-btn ui-btn--small ui-caption__close');
  close.type = 'button';
  close.append(WORDS.close, escKey());
  close.addEventListener('click', () => overlays.close());
  head.append(where, close);

  const body = el('div', 'ui-caption__body');
  panel.append(head, body);

  function open(entry: Entry): void {
    where.textContent = SITE_BY_ID[entry.district].name;
    body.replaceChildren();
    const top = el('div', 'ui-caption__top');
    const title = el('h2', 'ui-caption__title', entry.title);
    title.id = titleId;
    top.appendChild(title);
    const stamp = entryStamp(entry);
    if (stamp) top.appendChild(stamp);
    body.appendChild(top);
    const meta = entryMeta(entry);
    if (meta) body.appendChild(meta);
    body.appendChild(el('p', 'ui-caption__blurb', entry.blurb));
    const facts = entryBullets(entry);
    if (facts) body.appendChild(facts);
    const links = entryLinks(entry);
    if (links) body.appendChild(links);
    body.scrollTop = 0;
    overlays.open({ el: panel });
  }

  return { open };
}
