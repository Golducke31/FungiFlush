/**
 * genPackIndex.mjs — Genera `public/packs/index.json`.
 *
 * Los packs remotos (expansiones, temporadas) se descubren por este indice:
 * el juego hace fetch de `packs/index.json` y despues de cada `pack.json`.
 * Agregar un DLC = soltar la carpeta + correr este script. Sin tocar codigo.
 *
 *   node tools/genPackIndex.mjs
 */

import { readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..');
const PACKS_DIR = join(ROOT, 'public', 'packs');

function main() {
  if (!existsSync(PACKS_DIR)) {
    mkdirSync(PACKS_DIR, { recursive: true });
  }

  const ids = readdirSync(PACKS_DIR)
    .filter((name) => !name.endsWith('.json'))
    .filter((name) => statSync(join(PACKS_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(PACKS_DIR, name, 'pack.json')))
    .sort();

  const index = { packs: ids };
  const out = join(PACKS_DIR, 'index.json');
  writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`[packs] indice escrito en ${out}: ${ids.length} pack(s) -> ${ids.join(', ') || '(ninguno)'}`);
}

main();
