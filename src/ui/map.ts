// The map: a chart of the island drawn in the same ink and paper as everything else, for getting
// from one end of the story to the other without walking. The rim and the streets come from the
// same functions the ground is built from, so the chart cannot drift from the world.
//
// The chart is for the eye and the pointer. The list beside it holds the same places as plain
// buttons, and that is what the keyboard and a screen reader use. A place with focus in the list
// lights up on the chart.
import './map.css';
import type { ColorLike, DistrictId, DistrictSite, WorldApi } from '../types';
import { MERGE_LENGTH, PLAZA, ROAD_END, THREAD_COLORS, rimRadius, roadLength, roadPoint, type RoadPoint } from '../engine/terrain';
import { ROADS, SITES, SITE_BY_ID, SPINE_ORDER, WORLD_RADIUS } from '../world/layout';
import type { Overlays } from './overlay';
import { el, escKey, uid } from './dom';
import { WORDS } from './words';
import { MORE } from './wordsMore';

export interface MapOptions {
  world: WorldApi;
  overlays: Overlays;
  /** Stand the visitor in this district. The shell closes the map on the way. */
  go: (id: DistrictId) => void;
}

export interface MapPanel {
  open(): void;
  isOpen(): boolean;
}

/** The folded sheet, the same drawing the touch button carries. */
export const MAP_ICON = 'M3 6.6l6-2.4 6 2.4 6-2.4v13.2l-6 2.4-6-2.4-6 2.4zM9 4.2v13.2M15 6.6v13.2';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Half the side of the chart in metres: the island, its drop and a margin of sky. */
const VIEW = WORLD_RADIUS + 28;
/** Metres between samples along a street. */
const STEP = 3;
/** How far each of the avenue's two lines sits from the middle, in chart metres. Wider than life so they read. */
const APART = 2.3;

type Side = 'n' | 'e' | 's' | 'w';
// Which side of its plaza each name is lettered on, and how far it slides along that side (in ems,
// east or south), so the names stay clear of the streets and of each other down to a small phone.
const NAME_AT: Record<DistrictId, [Side, number]> = {
  trailhead: ['w', 0.9],
  switchboard: ['w', 1],
  commons: ['s', -0.3],
  terraces: ['n', 0],
  maskgarden: ['e', 0.7],
  observatory: ['n', 0],
  studio: ['n', 0],
  greenhouse: ['n', 0],
  skyharbor: ['n', -1],
  boneyard: ['n', 0],
  postcards: ['n', 1.3],
};

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const name in attrs) node.setAttribute(name, String(attrs[name]));
  return node;
}

const n1 = (v: number): string => v.toFixed(1);
const pct = (v: number): string => `${(((v + VIEW) / (2 * VIEW)) * 100).toFixed(2)}%`;

function hex(c: ColorLike): string {
  return typeof c === 'number' ? `#${c.toString(16).padStart(6, '0')}` : c;
}

function luminance(c: string): number {
  const v = parseInt(c.slice(1), 16);
  const f = (byte: number): number => {
    const s = byte / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((v >> 16) & 255) + 0.7152 * f((v >> 8) & 255) + 0.0722 * f(v & 255);
}

/** The district's colour on the chart: its first accent that would not vanish into the paper. */
function accentOf(site: DistrictSite): string {
  const all = site.accents.map(hex);
  return all.find((c) => luminance(c) < 0.7) ?? all[0];
}

function rimPath(): string {
  let d = '';
  for (let deg = 0; deg < 360; deg += 3) {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a);
    const z = Math.sin(a);
    const r = rimRadius(x, z);
    d += `${deg === 0 ? 'M' : 'L'}${n1(x * r)} ${n1(z * r)}`;
  }
  return `${d}Z`;
}

const rp: RoadPoint = { x: 0, z: 0, h: 0, tx: 0, tz: 1 };

/** A street's centre line from `from` to `to` metres along it, pushed `side(s)` metres to the walker's left. */
function streetPath(road: number, from: number, to: number, side: (s: number) => number): string {
  let d = '';
  for (let s = from; ; s += STEP) {
    const at = Math.min(s, to);
    roadPoint(road, at, rp);
    const off = side(at);
    d += `${d ? 'L' : 'M'}${n1(rp.x + rp.tz * off)} ${n1(rp.z - rp.tx * off)}`;
    if (at >= to) break;
  }
  return d;
}

function drawChart(): SVGSVGElement {
  const chart = svg('svg', { viewBox: `${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`, class: 'ui-map__svg', focusable: 'false' });
  const rim = rimPath();
  chart.append(
    svg('path', { d: rim, class: 'ui-map__drop', transform: 'translate(7 10)' }),
    svg('path', { d: rim, class: 'ui-map__land' }),
  );

  const casings = svg('g', { class: 'ui-map__casing' });
  const threads = svg('g', { class: 'ui-map__threads' });

  ROADS.forEach((road, i) => {
    const length = roadLength(i);
    const middle = streetPath(i, 0, length, () => 0);
    casings.appendChild(svg('path', { d: middle, class: `ui-map__casing--${road.kind}` }));

    // Every road in the layout ends on a district centre, and takes its colour from that district.
    const last = road.points[road.points.length - 1];
    const end = SITES.find((s) => s.center.x === last.x && s.center.z === last.z)!;
    if (road.kind !== 'spine') {
      threads.appendChild(svg('path', { d: middle, stroke: hex(THREAD_COLORS[end.thread]) }));
      return;
    }
    // The avenue carries two lines, people work on the left going uphill and technology on the
    // right. Short of the top they close up and carry on as one.
    const lineEnd = length - end.radius * ROAD_END;
    const join = lineEnd - MERGE_LENGTH * 0.5;
    const apart = (s: number): number => {
      const t = Math.min(1, Math.max(0, (s - (lineEnd - MERGE_LENGTH)) / (MERGE_LENGTH * 0.5)));
      return APART * (1 - t * t * (3 - 2 * t));
    };
    threads.append(
      svg('path', { d: streetPath(i, 0, join, apart), stroke: hex(THREAD_COLORS.people) }),
      svg('path', { d: streetPath(i, 0, join, (s) => -apart(s)), stroke: hex(THREAD_COLORS.tech) }),
      svg('path', { d: streetPath(i, join, length, () => 0), stroke: hex(THREAD_COLORS.both) }),
    );
  });

  // North, lettered small in the corner of the sky.
  const north = svg('g', { class: 'ui-map__north', transform: `translate(${-VIEW + 30} ${-VIEW + 26})` });
  const letter = svg('text', { x: 0, y: 40, 'text-anchor': 'middle' });
  letter.textContent = 'N';
  north.append(svg('path', { d: 'M0 22V0M-6 8L0 0L6 8' }), letter);

  chart.append(casings, threads, north);
  return chart;
}

interface Place {
  site: DistrictSite;
  pin: HTMLButtonElement;
  row: HTMLButtonElement;
  state: HTMLElement;
}

export function createMap(opts: MapOptions): MapPanel {
  let panel: HTMLElement | null = null;
  let you: HTMLElement | null = null;
  let scrollers: HTMLElement[] = [];
  const places: Place[] = [];

  function dot(site: DistrictSite | null): HTMLElement {
    const d = el('span', 'ui-map__dot');
    d.setAttribute('aria-hidden', 'true');
    if (site) d.style.setProperty('--place', accentOf(site));
    return d;
  }

  function dart(): SVGSVGElement {
    const s = svg('svg', { viewBox: '-12 -12 24 24', class: 'ui-map__dart', 'aria-hidden': 'true', focusable: 'false' });
    // Drawn twice: a wide paper line underneath keeps it clear of whatever it lands on.
    const d = 'M0-9.5L7.5 8L0 4.2L-7.5 8Z';
    s.append(svg('path', { d }), svg('path', { d }));
    return s;
  }

  function place(site: DistrictSite, chart: HTMLElement): HTMLElement {
    // On the chart: for the pointer and the finger only. The row below is the same place for everyone else.
    const [side, slide] = NAME_AT[site.id];
    const pin = el('button', `ui-map__place ui-map__place--${side}`);
    pin.type = 'button';
    pin.tabIndex = -1;
    pin.style.left = pct(site.center.x);
    pin.style.top = pct(site.center.z);
    // The plaza, to scale: its width as a share of the chart's.
    pin.style.setProperty('--plaza', `${n1(((site.radius * PLAZA) / VIEW) * 100)}cqw`);
    pin.style.setProperty('--slide', `${slide}em`);
    pin.append(dot(site), el('span', 'ui-map__name', site.name));
    pin.addEventListener('click', () => opts.go(site.id));
    chart.appendChild(pin);

    const item = el('li');
    const row = el('button', 'ui-map__row');
    row.type = 'button';
    const names = el('span', 'ui-map__row-names');
    const state = el('span', 'ui-map__row-state');
    names.append(el('span', 'ui-map__row-name', site.name), el('span', 'ui-map__row-years', site.years), state);
    row.append(dot(site), names);
    row.addEventListener('click', () => opts.go(site.id));
    const light = (on: boolean) => () => pin.classList.toggle('is-lit', on);
    row.addEventListener('focus', light(true));
    row.addEventListener('blur', light(false));
    row.addEventListener('pointerenter', light(true));
    row.addEventListener('pointerleave', light(false));
    item.appendChild(row);

    places.push({ site, pin, row, state });
    return item;
  }

  function build(): HTMLElement {
    const titleId = uid('map');
    const root = el('div', 'ui-map');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', titleId);

    const bar = el('div', 'ui-map__bar');
    const title = el('h2', 'ui-map__title', MORE.mapTitle);
    title.id = titleId;
    const close = el('button', 'ui-btn ui-btn--small');
    close.type = 'button';
    close.append(WORDS.close, escKey());
    close.addEventListener('click', () => opts.overlays.close());
    bar.append(title, close);

    const body = el('div', 'ui-map__body');
    const chart = el('div', 'ui-map__chart');
    chart.setAttribute('aria-hidden', 'true');
    chart.appendChild(drawChart());

    const side = el('div', 'ui-map__side');
    side.appendChild(el('p', 'ui-map__lede', MORE.mapLede));

    const key = el('ul', 'ui-map__key');
    key.setAttribute('aria-label', MORE.key);
    const keyItem = (sample: Element, words: string): HTMLElement => {
      const li = el('li');
      li.append(sample, words);
      return li;
    };
    const thread = (color: string): HTMLElement => {
      const line = el('span', 'ui-map__thread');
      line.setAttribute('aria-hidden', 'true');
      line.style.setProperty('--thread', color);
      return line;
    };
    const seen = dot(null);
    seen.classList.add('is-seen');
    key.append(
      keyItem(dart(), MORE.you),
      keyItem(seen, MORE.seen),
      keyItem(thread(hex(THREAD_COLORS.people)), MORE.people),
      keyItem(thread(hex(THREAD_COLORS.tech)), MORE.tech),
    );

    const group = (heading: string, ids: DistrictId[]): void => {
      const headId = uid('places');
      const h = el('h3', 'ui-map__group', heading);
      h.id = headId;
      const list = el('ul', 'ui-map__list');
      list.setAttribute('aria-labelledby', headId);
      for (const id of ids) list.appendChild(place(SITE_BY_ID[id], chart));
      side.append(h, list);
    };
    const spine = new Set<DistrictId>(SPINE_ORDER);
    group(WORDS.road, SPINE_ORDER);
    group(
      WORDS.side,
      SITES.filter((s) => !spine.has(s.id)).map((s) => s.id),
    );

    you = el('span', 'ui-map__you');
    you.appendChild(dart());
    chart.appendChild(you);

    body.append(chart, key, side);
    root.append(bar, body);
    scrollers = [body, side];
    return root;
  }

  // Where the visitor is and where they have been. Read once on opening: the world stands still
  // while the map is up.
  function refresh(): void {
    const at = opts.world.player();
    const seen = new Set(opts.world.visited());
    for (const p of places) {
      const here = p.site.id === at.district;
      const been = here || seen.has(p.site.id);
      p.pin.classList.toggle('is-seen', been);
      p.row.classList.toggle('is-seen', been);
      p.state.textContent = here ? MORE.you : been ? MORE.seen : '';
      if (here) p.row.setAttribute('aria-current', 'location');
      else p.row.removeAttribute('aria-current');
    }
    if (you) {
      you.style.left = pct(at.x);
      you.style.top = pct(at.z);
      // Yaw 0 faces north and turns toward the west. The chart has north at the top.
      you.style.transform = `translate(-50%, -50%) rotate(${n1((-at.yaw * 180) / Math.PI)}deg)`;
    }
  }

  return {
    open() {
      if (!panel) panel = build();
      refresh();
      opts.overlays.open({ el: panel });
      for (const s of scrollers) s.scrollTop = 0;
    },
    isOpen: () => panel !== null && opts.overlays.current() === panel,
  };
}
