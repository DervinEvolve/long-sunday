// The index: the whole story as one plain page, for someone with a minute and no wish to walk.
// Built once, the first time it is opened.
import type { DistrictId, DistrictSite, Entry } from '../types';
import { SITE, entriesFor } from '../content/content';
import { SITES, SITE_BY_ID, SPINE_ORDER } from '../world/layout';
import type { Overlays } from './overlay';
import { el, escKey, spoken, uid } from './dom';
import { entryBullets, entryLinks, entryMeta, entryStamp, link } from './entryParts';
import { WORDS } from './words';

export interface IndexPage {
  open(): void;
}

function contact(): HTMLElement {
  const list = el('ul', 'ui-contact');
  const mail = el('li');
  mail.appendChild(link(SITE.email, `mailto:${SITE.email}`));
  const hub = el('li');
  hub.appendChild(link(SITE.githubLabel, SITE.github));
  list.append(mail, hub);
  return list;
}

function entryItem(entry: Entry): HTMLElement {
  const item = el('li', 'ui-entry');
  const top = el('div', 'ui-entry__top');
  top.appendChild(el('h5', 'ui-entry__title', entry.title));
  const stamp = entryStamp(entry);
  if (stamp) top.appendChild(stamp);
  item.appendChild(top);
  const meta = entryMeta(entry);
  if (meta) item.appendChild(meta);
  item.appendChild(el('p', 'ui-entry__blurb', entry.blurb));
  const facts = entryBullets(entry);
  const links = entryLinks(entry);
  if (facts || links) {
    const more = el('details', 'ui-entry__more');
    const summary = el('summary');
    const word = el('span', undefined, WORDS.more);
    summary.append(word, spoken(`: ${entry.title}`));
    more.appendChild(summary);
    more.addEventListener('toggle', () => {
      word.textContent = more.open ? WORDS.less : WORDS.more;
    });
    if (facts) more.appendChild(facts);
    if (links) more.appendChild(links);
    item.appendChild(more);
  }
  return item;
}

/** `goThere` is left out on the page with no world behind it, and so are the buttons. */
export function createIndex(overlays: Overlays, goThere: ((id: DistrictId) => void) | null): IndexPage {
  let page: HTMLElement | null = null;

  function district(site: DistrictSite): HTMLElement {
    const section = el('section', 'ui-district');
    const headId = uid('district');
    section.setAttribute('aria-labelledby', headId);
    const head = el('div', 'ui-district__head');
    const names = el('div', 'ui-district__names');
    const name = el('h4', 'ui-district__name', site.name);
    name.id = headId;
    names.append(name, el('p', 'ui-district__years', site.years));
    head.appendChild(names);
    if (goThere) {
      const go = el('button', 'ui-btn ui-btn--small ui-district__go');
      go.type = 'button';
      go.append(WORDS.go, spoken(`: ${site.name}`));
      go.addEventListener('click', () => goThere(site.id));
      head.appendChild(go);
    }
    section.append(head, el('p', 'ui-district__tagline', site.tagline));
    const entries = entriesFor(site.id);
    if (entries.length) {
      const list = el('ul', 'ui-entries');
      for (const entry of entries) list.appendChild(entryItem(entry));
      section.appendChild(list);
    }
    return section;
  }

  function build(): HTMLElement {
    const titleId = uid('index');
    const root = el('div', 'ui-index');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', titleId);

    const bar = el('div', 'ui-index__bar');
    const close = el('button', 'ui-btn ui-btn--small');
    close.type = 'button';
    close.append(WORDS.close, escKey());
    close.addEventListener('click', () => overlays.close());
    bar.append(el('p', 'ui-index__mark', SITE.title), close);

    const sheet = el('div', 'ui-index__page');
    const intro = el('header', 'ui-index__intro');
    const title = el('h2', 'ui-index__title', WORDS.indexTitle);
    title.id = titleId;
    intro.append(
      el('p', 'ui-index__sub', SITE.subtitle),
      title,
      el('p', 'ui-index__lede', SITE.intro),
      el('p', 'ui-index__note', SITE.nameNote),
      contact(),
    );
    sheet.appendChild(intro);

    const spine = new Set<DistrictId>(SPINE_ORDER);
    sheet.appendChild(el('h3', 'ui-index__group', WORDS.road));
    for (const id of SPINE_ORDER) sheet.appendChild(district(SITE_BY_ID[id]));
    sheet.appendChild(el('h3', 'ui-index__group', WORDS.side));
    for (const site of SITES) if (!spine.has(site.id)) sheet.appendChild(district(site));

    const foot = el('footer', 'ui-index__foot');
    foot.append(el('h3', 'ui-index__group', WORDS.reach), contact());
    sheet.appendChild(foot);

    root.append(bar, sheet);
    return root;
  }

  return {
    open() {
      if (!page) page = build();
      overlays.open({ el: page });
    },
  };
}
