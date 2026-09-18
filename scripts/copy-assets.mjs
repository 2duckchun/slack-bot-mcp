// `tsc` does not emit the generated catalog, so the build copies it next to the
// compiled `slack/catalog.js` that reads it at runtime.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'generated', 'catalog.json');
const to = join(root, 'dist', 'generated', 'catalog.json');

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.error(`copied ${from} -> ${to}`);
