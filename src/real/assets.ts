// Fetching and opening the real look's files. Everything under real/ comes through asset(): the
// locked build hands the bytes over itself (window.__lsAsset), every other build fetches them.
import * as THREE from 'three';

let requests = 0;
/** How many files have been asked for. For the tests: zero until the visitor first switches. */
export const requestCount = (): number => requests;

/** One file from real/, as bytes. `path` is relative to real/, the way the manifest writes it. */
export async function asset(path: string): Promise<ArrayBuffer> {
  const full = 'real/' + path;
  requests++;
  if (typeof window.__lsAsset === 'function') return window.__lsAsset(full);
  const res = await fetch(full);
  if (!res.ok) throw new Error(`${full} answered ${res.status}`);
  return res.arrayBuffer();
}

export async function assetJson<T>(path: string): Promise<T> {
  const bytes = await asset(path);
  // A dev server answers a missing file with the index page. That must fail here, loudly.
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Chunk files are gzipped by the pack step. Some hosts open a .gz on the way out, so look first. */
export async function gunzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', avif: 'image/avif' };

type Picture = ImageBitmap | HTMLImageElement;

async function decode(bytes: ArrayBuffer, path: string): Promise<Picture> {
  const blob = new Blob([bytes], { type: MIME[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream' });
  if (typeof createImageBitmap === 'function') {
    try {
      // As stored: no flip, no premultiplied alpha (the leaf cut-outs need theirs straight), no colour fiddling.
      return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
    } catch {
      // An older Safari does not take the options. The image element below does the same job.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface TextureOpts {
  srgb?: boolean;
  repeat?: boolean;
  nearest?: boolean;
  anisotropy?: number;
  /** Which uv set it reads. Lightmaps read the second. */
  channel?: number;
}

/** One image file as a texture. Every image in real/ follows glTF: uv (0, 0) is the top left texel. */
export async function loadTexture(path: string, opts: TextureOpts = {}): Promise<THREE.Texture> {
  const picture = await decode(await asset(path), path);
  const t = new THREE.Texture(picture as unknown as HTMLImageElement);
  t.name = path;
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.nearest) {
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else t.anisotropy = opts.anisotropy ?? 1;
  if (opts.channel) t.channel = opts.channel;
  t.needsUpdate = true;
  return t;
}

/** Frees a texture on the card and the decoded picture behind it. */
export function dropTexture(t: THREE.Texture | null | undefined): void {
  if (!t) return;
  const img = t.image as { close?: () => void } | null;
  t.dispose();
  if (img && typeof img.close === 'function') img.close();
}

/** Bytes a texture takes on the card, mipmaps included. */
export function textureBytes(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | null;
  const px = (img?.width ?? 0) * (img?.height ?? 0);
  return Math.round(px * 4 * (t.generateMipmaps ? 4 / 3 : 1));
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** A positive number as a 16 bit float, the kind every WebGL 2 card can filter. */
function toHalf(v: number): number {
  f32[0] = v > 65504 ? 65504 : v > 0 ? v : 0;
  const x = u32[0];
  const e = (x >>> 23) & 0xff;
  if (e < 103) return 0;
  if (e < 113) return ((x & 0x7fffff) | 0x800000) >>> (126 - e);
  return ((e - 112) << 10) | ((x & 0x7fffff) >>> 13);
}

/** A Radiance .hdr picture as linear rgb floats, top row first. The loader in three.js reads the same
 *  format, but it hangs off the file loading classes, and those would ride along in the first bundle. */
function readRadiance(bytes: Uint8Array, name: string): { width: number; height: number; rgb: Float32Array } {
  const bad = (why: string): Error => new Error(`${name} is not a Radiance picture I can read (${why})`);
  let pos = 0;
  const line = (): string => {
    let out = '';
    while (pos < bytes.length && bytes[pos] !== 10) out += String.fromCharCode(bytes[pos++]);
    pos++;
    return out;
  };
  if (!/^#\?(RADIANCE|RGBE)/.test(line())) throw bad('no header');
  let format = '';
  for (let guard = 0; guard < 64; guard++) {
    const l = line();
    if (l === '') break;
    const m = /^FORMAT=(\S+)/.exec(l);
    if (m) format = m[1];
  }
  if (format !== '32-bit_rle_rgbe') throw bad('format');
  const size = /^-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/.exec(line());
  if (!size) throw bad('size');
  const height = Number(size[1]);
  const width = Number(size[2]);
  if (width < 1 || height < 1 || width * height > 1 << 24) throw bad('size');
  const rgb = new Float32Array(width * height * 3);
  const put = (o: number, r: number, g: number, b: number, e: number): void => {
    const k = e === 0 ? 0 : Math.pow(2, e - 128) / 255;
    rgb[o] = r * k;
    rgb[o + 1] = g * k;
    rgb[o + 2] = b * k;
  };
  const packed = width >= 8 && width <= 0x7fff && bytes[pos] === 2 && bytes[pos + 1] === 2 && (bytes[pos + 2] & 0x80) === 0;
  if (!packed) {
    if (pos + width * height * 4 > bytes.length) throw bad('short');
    for (let i = 0; i < width * height; i++, pos += 4) put(i * 3, bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    return { width, height, rgb };
  }
  // Each row: a four byte mark, then the reds, the greens, the blues and the exponents, each run length coded.
  const row = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (pos + 4 > bytes.length || bytes[pos] !== 2 || bytes[pos + 1] !== 2 || ((bytes[pos + 2] << 8) | bytes[pos + 3]) !== width) throw bad('row ' + y);
    pos += 4;
    let at = 0;
    while (at < row.length) {
      if (pos >= bytes.length) throw bad('short');
      let count = bytes[pos++];
      const run = count > 128;
      if (run) count -= 128;
      if (count === 0 || at + count > row.length) throw bad('row ' + y);
      if (run) row.fill(bytes[pos++], at, at + count);
      else {
        row.set(bytes.subarray(pos, pos + count), at);
        pos += count;
      }
      at += count;
    }
    for (let x = 0; x < width; x++) put((y * width + x) * 3, row[x], row[x + width], row[x + 2 * width], row[x + 3 * width]);
  }
  return { width, height, rgb };
}

/** The brightest the sky may be within ten degrees of the sun, once the sun's disc is out. About what the glow round it reaches. */
const SUN_CAP = 6.5;

export interface SkyData {
  texture: THREE.DataTexture;
  /** What the sky alone puts on a surface facing up and on one facing down, sun left out. Linear rgb, unscaled. */
  up: THREE.Vector3;
  down: THREE.Vector3;
  /** The sky just above the horizon, toward the sun and away from it. For the haze. */
  toward: THREE.Vector3;
  away: THREE.Vector3;
}

/** The baked sky: an equirectangular Radiance file. Row 0 is straight up, +x is the middle of the image.
 *  Besides the texture, a few sums over it: the haze and the light on moving things come from the
 *  same sky the bake was lit by. */
export async function loadSky(path: string, sun: THREE.Vector3): Promise<SkyData> {
  const { width: w, height: h, rgb } = readRadiance(new Uint8Array(await asset(path)), path);
  // The file has a soft sun drawn in. Surfaces mirror this picture, and a mirrored sun would shine on
  // a wall in deep shade just as it does on one in the open. So the disc comes out here, and the
  // materials put the sun's glint back themselves, only where the baked light says the sun reaches.
  for (let y = 0; y < h; y++) {
    const el = (0.5 - (y + 0.5) / h) * Math.PI;
    const sy = Math.sin(el);
    const cy = Math.cos(el);
    if (Math.abs(el - Math.asin(sun.y)) > 0.2) continue;
    for (let x = 0; x < w; x++) {
      const az = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
      if (Math.cos(az) * cy * sun.x + sy * sun.y + Math.sin(az) * cy * sun.z < 0.985) continue;
      const i = (y * w + x) * 3;
      const k = Math.min(1, SUN_CAP / Math.max(rgb[i], rgb[i + 1], rgb[i + 2], 1e-6));
      rgb[i] *= k;
      rgb[i + 1] *= k;
      rgb[i + 2] *= k;
    }
  }
  const data = new Uint16Array(w * h * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    data[o] = toHalf(rgb[i]);
    data[o + 1] = toHalf(rgb[i + 1]);
    data[o + 2] = toHalf(rgb[i + 2]);
    data[o + 3] = 0x3c00; // one
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = path;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;

  const up = new THREE.Vector3();
  const down = new THREE.Vector3();
  const toward = new THREE.Vector3();
  const away = new THREE.Vector3();
  let nToward = 0;
  let nAway = 0;
  const sunAz = Math.atan2(sun.z, sun.x);
  const step = Math.max(1, Math.floor(w / 256));
  for (let y = 0; y < h; y += step) {
    const el = (0.5 - (y + 0.5) / h) * Math.PI; // elevation, row 0 at the top
    const sy = Math.sin(el);
    const cy = Math.cos(el);
    const solid = cy * (Math.PI / h) * ((2 * Math.PI) / w) * step * step;
    for (let x = 0; x < w; x += step) {
      const az = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
      const i = (y * w + x) * 3;
      let r = rgb[i];
      let g = rgb[i + 1];
      let b = rgb[i + 2];
      // The sun has its own lamp. Close to it, cap what the sky may add.
      const cosSun = Math.cos(az) * cy * sun.x + sy * sun.y + Math.sin(az) * cy * sun.z;
      if (cosSun > 0.94) {
        const k = Math.min(1, 8 / Math.max(r, g, b, 1e-6));
        r *= k;
        g *= k;
        b *= k;
      }
      if (sy > 0) up.set(up.x + r * sy * solid, up.y + g * sy * solid, up.z + b * sy * solid);
      else down.set(down.x - r * sy * solid, down.y - g * sy * solid, down.z - b * sy * solid);
      if (el > 0.01 && el < 0.14) {
        let d = Math.abs(az - sunAz);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < 0.7 && cosSun < 0.97) {
          toward.set(toward.x + r, toward.y + g, toward.z + b);
          nToward++;
        } else if (d > 2.1) {
          away.set(away.x + r, away.y + g, away.z + b);
          nAway++;
        }
      }
    }
  }
  if (nToward > 0) toward.multiplyScalar(1 / nToward);
  if (nAway > 0) away.multiplyScalar(1 / nAway);
  return { texture, up, down, toward, away };
}
