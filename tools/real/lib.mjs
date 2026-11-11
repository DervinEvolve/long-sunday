// Shared bits for the real look's pipeline scripts.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const CACHE = path.join(HERE, 'cache');
export const EXPORT_DIR = path.join(CACHE, 'export');
export const BAKE_DIR = path.join(CACHE, 'bake');
export const OUT = path.join(ROOT, 'public', 'real');
export const PYTHON = path.join(CACHE, 'venv', 'bin', 'python');

export const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export function settings() {
  return JSON.parse(readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sha(data) {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export function shaFile(file) {
  return existsSync(file) ? sha(readFileSync(file)) : null;
}

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    // Not a dependency of this project: use the global install, as scripts/shot.mjs does.
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(root, 'x.js'))('playwright');
  }
}

/** `name*` and `*name` and plain names. */
export function matches(patterns, name) {
  for (const p of patterns) {
    if (p === name) return true;
    if (p.includes('*')) {
      const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      if (re.test(name)) return true;
    }
  }
  return false;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

/** Use the dev server on this port if one is up, otherwise start one. Returns a stop(), to be
 *  awaited: it comes back when the port is free again, so the next script does not find a server
 *  that is on its way out. */
export async function devServer(port) {
  if (await portOpen(port)) return { started: false, async stop() {} };
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(port)) {
      return {
        started: true,
        async stop() {
          try {
            process.kill(-child.pid);
          } catch {
            // already gone
          }
          for (let n = 0; n < 40 && (await portOpen(port)); n++) await new Promise((r) => setTimeout(r, 100));
        },
      };
    }
  }
  throw new Error(`the dev server did not come up on port ${port}`);
}

export function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function fmtBytes(n) {
  return n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB';
}
