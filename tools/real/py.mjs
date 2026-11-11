#!/usr/bin/env node
// Runs one of the pipeline's Python scripts with the Blender module's own interpreter.
//   node tools/real/py.mjs bake.py --only trailhead
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { HERE, PYTHON } from './lib.mjs';

if (!existsSync(PYTHON)) {
  console.error(
    'The real look needs Blender as a Python module, in a virtual environment of its own.\n' +
      'Set it up once (about 1 GB, kept out of git):\n\n' +
      '  python3.11 -m venv tools/real/cache/venv\n' +
      '  tools/real/cache/venv/bin/pip install bpy==4.2.23 pillow\n',
  );
  process.exit(1);
}
const [script, ...rest] = process.argv.slice(2);
const r = spawnSync(PYTHON, [path.join(HERE, script), ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
