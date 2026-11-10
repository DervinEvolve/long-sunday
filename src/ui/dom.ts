// Small helpers for building the interface by hand. No templates, no markup strings.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Line drawings on a 24 by 24 grid, as path data. */
export const ICON = {
  index: 'M5 6.5h.01M5 12h.01M5 17.5h.01M9.5 6.5H19M9.5 12H19M9.5 17.5H19',
  out: 'M9.5 6H18v8.5M18 6L6.5 17.5',
} as const;

export function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

export function key(label: string): HTMLElement {
  return el('kbd', 'ui-key', label);
}

/** The Esc key beside a close button. Left off where there is no keyboard. */
export function escKey(): HTMLElement {
  const k = key('Esc');
  k.classList.add('ui-only-keys');
  k.setAttribute('aria-hidden', 'true');
  return k;
}

/** Text that is read aloud and not drawn. */
export function spoken(text: string): HTMLElement {
  return el('span', 'ui-sr', text);
}

let ids = 0;
export function uid(stem: string): string {
  return `ui-${stem}-${++ids}`;
}
