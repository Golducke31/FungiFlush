/**
 * genArtIndex.mjs — Escribe `public/art/index.json` con los archivos que EXISTEN.
 *
 * POR QUE HACE FALTA
 * ------------------
 * El esquema de arte tiene 51 claves posibles (40 de elemento x rareza + 11 del
 * catalogo viejo + dorso y tapete), pero solo existen las que se hayan generado.
 * Si el juego pidiera las 51 URLs, cada arranque produciria decenas de 404 y un
 * aviso de consola por cada uno mientras el arte nuevo no este completo.
 *
 * Con el manifiesto se piden solo los archivos reales: agregar una ilustracion
 * es dejarla en la carpeta y volver a correr esto.
 *
 *   node tools/genArtIndex.mjs      (o `npm run art:index`)
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ART = join(ROOT, 'public', 'art');

const files = readdirSync(ART)
  .filter((name) => name.endsWith('.webp'))
  // Las hojas de MotionFrames (`mf_*.webp`) NO van al indice: no son arte de
  // carta sino spritesheets, y las carga `MotionFrameCache` desde
  // `motionframes.json`. Si entraran aca, `ArtAssets` las pediria como si
  // fueran ilustraciones y se bajararian al arrancar sin que nadie las use.
  .filter((name) => !name.startsWith('mf_'))
  .sort();

writeFileSync(join(ART, 'index.json'), `${JSON.stringify({ files }, null, 2)}\n`, 'utf8');

const cards = files.filter((name) => name.startsWith('art_card_') && name !== 'art_cardback.webp');
console.log(`art/index.json: ${files.length} archivos (${cards.length} de carta)`);
if (cards.length < 40) {
  console.log(`  faltan ${40 - cards.length} de las 40 ilustraciones de elemento x rareza`);
}
