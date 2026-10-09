/**
 * genLayerIndex.mjs — Escribe `public/art/layers/index.json` con las capas que EXISTEN.
 *
 * POR QUE HACE FALTA
 * ------------------
 * El art se segmenta en 3 capas (bg / subject / fg) por carta. El render tiene que
 * saber que cartas traen capas y con que bbox viene recortado el sujeto (el bbox es
 * lo que permite alinear las capas al tiltar para el parallax).
 *
 * `segment_card_layers.py` ya escribe un index.json con esa metadata, pero este
 * script es la FUENTE DE VERDAD DE FICHEROS: re-escanea el disco, tira las entradas
 * cuyo archivo falto y avisa de las capas huerfanas. Mismo espiritu que
 * genArtIndex.mjs: se piden solo los archivos reales.
 *
 *   node tools/genLayerIndex.mjs      (o `npm run art:layers`)
 */

import { readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAYERS = join(ROOT, 'public', 'art', 'layers');

if (!existsSync(LAYERS)) {
  console.error('No existe public/art/layers/. Corre: python tools/segment_card_layers.py');
  process.exit(1);
}

const LAYER_NAMES = ['bg', 'subject', 'fg'];
const FILE_RE = /^(.+)__(bg|subject|fg)\.(png|webp)$/;

// Metadata previa del tool de Python (bbox, size, coverage). Se conserva si existe.
const prevPath = join(LAYERS, 'index.json');
let prev = {};
if (existsSync(prevPath)) {
  try {
    prev = JSON.parse(readFileSync(prevPath, 'utf8')).layers ?? {};
  } catch {
    prev = {};
  }
}

const files = readdirSync(LAYERS).filter((n) => FILE_RE.test(n)).sort();

/** stem -> { size, subject:{bbox}, coverage, files:{layer:name} } */
const layers = {};
const orphans = [];

for (const name of files) {
  const m = name.match(FILE_RE);
  const stem = m[1];
  const layer = m[2];
  const prevEntry = prev[stem];
  if (!prevEntry) orphans.push(name);

  const entry = (layers[stem] ??= {
    size: prevEntry?.size ?? [512, 744],
    subject: prevEntry?.subject ?? { bbox: [0, 0, 0, 0] },
    ...(prevEntry?.coverage ? { coverage: prevEntry.coverage } : {}),
    files: {},
  });
  entry.files[layer] = name;
}

// Solo publicamos cartas que tengan AL MENOS el sujeto: sin el no hay nada que
// mover en parallax y el render cae a la ruta de una sola textura.
let dropped = 0;
for (const stem of Object.keys(layers)) {
  if (!layers[stem].files.subject) {
    delete layers[stem];
    dropped += 1;
  }
}

// Orden alfabetico estable: el JSON se versiona y no queremos diffs ruidosos.
const sorted = {};
for (const stem of Object.keys(layers).sort()) sorted[stem] = layers[stem];

writeFileSync(prevPath, `${JSON.stringify({ version: 1, layers: sorted }, null, 2)}\n`, 'utf8');

const stems = Object.keys(sorted);
const withFg = stems.filter((s) => sorted[s].files.fg).length;
console.log(
  `art/layers/index.json: ${stems.length} cartas con capas ` +
    `(${files.length} archivos, ${withFg} con primer plano)`,
);
if (dropped) console.log(`  ${dropped} entradas sin sujeto: descartadas`);
if (orphans.length) {
  console.log(`  ${orphans.length} archivos sin metadata del segmentador: usan bbox por defecto`);
}
