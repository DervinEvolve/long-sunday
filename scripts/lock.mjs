#!/usr/bin/env node
// Puts the single file build behind a password.
//
//   LONG_SUNDAY_PASSWORD='several random words' npm run build:locked
//
// Reads dist-single/index.html, gzips it, seals it with a key made from the password, and writes
// dist-locked/index.html: the unlock page from src/lock/ with the sealed application inside it.
// Files under public/real/ are sealed with the same key into dist-locked/real/.
//
//   --check    only look at the password, so a build without one stops before Vite runs
//
// The password is read from the environment and goes nowhere else. It is never printed or written.
import { webcrypto } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-locked');
const PLAIN = path.join(ROOT, 'dist-single', 'index.html');
const LOCK = path.join(ROOT, 'src', 'lock');
const FONT = 'node_modules/@fontsource/architects-daughter/files/architects-daughter-latin-400-normal.woff2';

const MIN_LENGTH = 12;
const ITERATIONS = 600_000;
// Already squeezed. Gzip would only cost the visitor time.
const PACKED = new Set(['.glb', '.webp', '.ktx2', '.avif', '.jpg', '.jpeg', '.png']);
// The one place side files come from. dist/real is left alone on purpose: this build never writes
// dist/, so whatever sits there is from an older build and may hold files I have since deleted.
const ASSETS = path.join(ROOT, 'public', 'real');

function fail(message) {
  rmSync(OUT, { recursive: true, force: true });
  console.error(`lock: ${message}`);
  process.exit(1);
}

// Anything unexpected ends the same way: nothing left in dist-locked.
process.on('uncaughtException', (error) => fail(error.message));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

// A stale locked copy must never outlive a failed build.
rmSync(OUT, { recursive: true, force: true });

const password = (process.env.LONG_SUNDAY_PASSWORD ?? '').normalize('NFC').trim();
if ([...password].length < MIN_LENGTH) {
  fail(`LONG_SUNDAY_PASSWORD is not set or is shorter than ${MIN_LENGTH} characters. Nothing was written.`);
}
if (process.argv.includes('--check')) process.exit(0);

if (!existsSync(PLAIN)) fail('dist-single/index.html is missing. Use "npm run build:locked", which builds it first.');

// The same steps the unlock page takes: PBKDF2 to a 256 bit key, then AES-GCM.
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const material = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, 256);
const key = await subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Seals bytes under a fresh nonce. Returns the nonce and the sealed bytes, tag included. */
async function seal(bytes) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  return { iv, sealed: new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)) };
}

// --- The page ---------------------------------------------------------------------------------

const plain = readFileSync(PLAIN);
const app = await seal(gzipSync(plain, { level: 9 }));
const box = { v: 1, salt: base64(salt), iv: base64(app.iv), iter: ITERATIONS, ct: base64(app.sealed) };

/** Swaps the one place a marker stands for something else. Split and join, so nothing in the text is read as a pattern. */
function swap(text, marker, to) {
  const parts = text.split(marker);
  if (parts.length !== 2) fail(`src/lock: expected "${marker}" exactly once.`);
  return parts.join(to);
}

const css = swap(
  readFileSync(path.join(LOCK, 'lock.css'), 'utf8'),
  `url('../../${FONT}')`,
  `url(data:font/woff2;base64,${readFileSync(path.join(ROOT, FONT)).toString('base64')})`,
);
const js = readFileSync(path.join(LOCK, 'lock.js'), 'utf8');
if (css.includes('</style') || js.includes('</script')) fail('src/lock: a closing tag inside lock.css or lock.js would cut the page short.');

let shell = readFileSync(path.join(LOCK, 'lock.html'), 'utf8');
shell = swap(shell, '<link rel="stylesheet" href="./lock.css" />', `<style>\n${css}</style>`);
shell = swap(shell, '<script src="./lock.js"></script>', `<script>\n${js}</script>`);
const page = swap(shell, '<script type="application/json" id="ls-box">{}</script>', `<script type="application/json" id="ls-box">${JSON.stringify(box)}</script>`);

// Before anything is written: the box in the finished page opens to the same bytes, and neither the
// password nor any run of the application's script is readable in it.
{
  const found = /<script type="application\/json" id="ls-box">(.*?)<\/script>/s.exec(page);
  const back = JSON.parse(found[1]);
  const opened = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(back.iv, 'base64') }, key, Buffer.from(back.ct, 'base64'));
  if (!gunzipSync(Buffer.from(opened)).equals(plain)) fail('the sealed page did not open to the same bytes.');
  if (page.includes(password)) fail('the password is readable in the page. Pick one that is not a phrase from the unlock page.');

  const text = plain.toString('utf8');
  const from = text.indexOf('<script type="module"');
  const to = text.indexOf('</script>', from);
  if (from < 0) fail('dist-single/index.html has no module script. Is it the single file build?');
  for (let i = 0; i < 256; i++) {
    const at = from + Math.floor(((to - from - 32) * i) / 256);
    const run = text.slice(at, at + 32);
    if (!shell.includes(run) && page.includes(run)) fail('part of the application is readable in the locked page.');
  }
  if (page.includes('<canvas') || page.includes('type="module"')) fail('the locked page holds application markup in the clear.');
}

// --- The side files ---------------------------------------------------------------------------
// Each file becomes: 12 bytes of nonce, then the sealed bytes. Inside the seal the first byte is 1
// when the rest is gzipped and 0 when it is as it was.

const assets = [];
if (existsSync(ASSETS)) {
  for (const entry of readdirSync(ASSETS, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    assets.push(path.relative(ASSETS, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  }
}

const written = [];
for (const rel of assets.sort((a, b) => a.localeCompare(b))) {
  const bytes = readFileSync(path.join(ASSETS, rel));
  const packed = PACKED.has(path.extname(rel).toLowerCase());
  const body = packed ? bytes : gzipSync(bytes, { level: 9 });
  const { iv, sealed } = await seal(Buffer.concat([Buffer.from([packed ? 0 : 1]), body]));
  const out = path.join(OUT, 'real', rel);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.concat([iv, sealed]));
  written.push(`  real/${rel}  ${kb(bytes.length)} to ${kb(iv.length + sealed.length)}  (${packed ? 'as it is' : 'gzipped'})`);
}

// The page goes last, so a copy that has its page has everything.
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'index.html'), page);

const size = Buffer.byteLength(page);
console.log(`lock: dist-locked/index.html  ${kb(size)}  (the single file is ${kb(plain.length)}, so ${Math.round((100 * size) / plain.length)}%)`);
if (written.length) console.log(`lock: ${written.length} side files\n${written.join('\n')}`);
console.log(`lock: PBKDF2-HMAC-SHA-256 with ${ITERATIONS.toLocaleString('en-US')} rounds, AES-256-GCM. New salt and nonces every build.`);
