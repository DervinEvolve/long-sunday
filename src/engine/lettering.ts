// The lettering atlas. One canvas, one texture, every sign in the world.
//
// I pack by glyph, not by string. A string atlas for four hundred signs wants a 4096 square texture;
// a glyph atlas is one 1024 square, holds any number of strings, and lets each letter bob and tilt a
// little so the lettering looks drawn by hand rather than typeset.
//
// The red channel is coverage: 0 is paper, 1 is ink. The ink material sharpens the edge so letters
// stay crisp close up, and mipmaps keep them calm far away.
import * as THREE from 'three';
import '@fontsource/architects-daughter/400.css';

export const FONT_FAMILY = 'Architects Daughter';
const FALLBACK = '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive';

const SIZE = 1024;
/** Font size the glyphs are drawn at, in atlas pixels. */
const FONT_PX = 64;
/** Empty border around each glyph so mipmaps do not bleed one letter into the next. */
const PAD = 7;
/** Extra weight. Architects Daughter is a thin pen; signs want a marker. In atlas pixels. */
const STROKE = 3.2;

export interface Glyph {
  /** Atlas rectangle in uv, v up. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Quad size, in ems. */
  w: number;
  h: number;
  /** Quad's left edge from the pen position and bottom edge from the baseline, in ems. */
  ox: number;
  oy: number;
  /** How far the pen moves on, in ems. */
  adv: number;
  /** True for spaces: nothing to draw. */
  empty: boolean;
}

export interface Lettering {
  texture: THREE.Texture;
  /** Resolves when the font is in and the atlas has been drawn with it. */
  ready: Promise<void>;
  /** Height of a capital letter, in ems. */
  capHeight(): number;
  glyph(ch: string): Glyph;
  /** Redraw from scratch, after a lost context or a late font. */
  redraw(): void;
  dispose(): void;
}

const PRELOAD =
  ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  '.,:;!?\'"-+=/\\()[]&@#%*<>_~$^|{}`' +
  '’‘“”…éèêàçôïñ×·→←↑↓';

export function createLettering(): Lettering {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;

  const glyphs = new Map<string, Glyph>();
  let fontReady = false;
  let cap = 0.72;
  // Shelf packer state.
  let penX = PAD;
  let penY = PAD;
  let shelfH = 0;
  let full = false;
  let warnedEarly = false;

  const font = () => `${FONT_PX}px "${FONT_FAMILY}", ${FALLBACK}`;

  function prep(): void {
    ctx.font = font();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = STROKE;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  function clear(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SIZE, SIZE);
    glyphs.clear();
    penX = PAD;
    penY = PAD;
    shelfH = 0;
    full = false;
    prep();
    const m = ctx.measureText('H');
    cap = (m.actualBoundingBoxAscent || FONT_PX * 0.72) / FONT_PX;
  }

  function make(ch: string): Glyph {
    prep();
    const m = ctx.measureText(ch);
    const adv = m.width / FONT_PX;
    const left = Math.ceil(m.actualBoundingBoxLeft || 0);
    const right = Math.ceil(m.actualBoundingBoxRight || m.width);
    const asc = Math.ceil(m.actualBoundingBoxAscent || 0);
    const desc = Math.ceil(m.actualBoundingBoxDescent || 0);
    const inkW = left + right;
    const inkH = asc + desc;
    if (inkW <= 0 || inkH <= 0 || ch.trim() === '') {
      return { u0: 0, v0: 0, u1: 0, v1: 0, w: 0, h: 0, ox: 0, oy: 0, adv, empty: true };
    }
    const grow = Math.ceil(STROKE * 0.5) + 2;
    const cw = inkW + grow * 2;
    const chh = inkH + grow * 2;
    if (penX + cw + PAD > SIZE) {
      penX = PAD;
      penY += shelfH + PAD;
      shelfH = 0;
    }
    if (penY + chh + PAD > SIZE) {
      if (!full) console.warn('[lettering] atlas is full, new characters fall back to "?"');
      full = true;
      const q = glyphs.get('?');
      if (q) return q;
      return { u0: 0, v0: 0, u1: 0, v1: 0, w: 0, h: 0, ox: 0, oy: 0, adv, empty: true };
    }
    const x = penX;
    const y = penY;
    penX += cw + PAD;
    shelfH = Math.max(shelfH, chh);
    // Lighter composite so a redraw of the same cell never darkens it.
    const bx = x + grow + left;
    const by = y + grow + asc;
    ctx.strokeText(ch, bx, by);
    ctx.fillText(ch, bx, by);
    texture.needsUpdate = true;
    return {
      u0: x / SIZE,
      u1: (x + cw) / SIZE,
      v1: 1 - y / SIZE,
      v0: 1 - (y + chh) / SIZE,
      w: cw / FONT_PX,
      h: chh / FONT_PX,
      ox: -(left + grow) / FONT_PX,
      oy: -(desc + grow) / FONT_PX,
      adv,
      empty: false,
    };
  }

  function glyph(ch: string): Glyph {
    let g = glyphs.get(ch);
    if (!g) {
      if (!fontReady && !warnedEarly) {
        warnedEarly = true;
        console.warn('[lettering] a label was built before kit.ready resolved. Its spacing comes from a fallback font.');
      }
      g = make(ch);
      glyphs.set(ch, g);
    }
    return g;
  }

  function redraw(): void {
    const had = Array.from(glyphs.keys());
    clear();
    for (const ch of PRELOAD) glyphs.set(ch, make(ch));
    for (const ch of had) if (!glyphs.has(ch)) glyphs.set(ch, make(ch));
    texture.needsUpdate = true;
  }

  clear();

  const load: Promise<unknown> =
    typeof document !== 'undefined' && document.fonts
      ? Promise.race([
          document.fonts.load(font(), 'LONG SUNDAY abc 123'),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]).catch(() => undefined)
      : Promise.resolve();

  const ready = load.then(() => {
    fontReady = true;
    // Anything lettered before now used fallback metrics. Start clean with the real font.
    glyphs.clear();
    redraw();
  });

  return {
    texture,
    ready,
    capHeight: () => cap,
    glyph,
    redraw,
    dispose: () => texture.dispose(),
  };
}
