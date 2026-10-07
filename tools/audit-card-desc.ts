/**
 * audit-card-desc.ts — Cuenta cuantas LINEAS necesita la descripcion de cada
 * carta al dibujarse en la CARA de la textura (512x744).
 *
 * POR QUE EXISTE
 * --------------
 * La cara de la carta es la UNICA superficie donde el jugador ve el texto sin
 * abrir nada: el `.hud-tooltip` necesita long-press y el mazo/tienda muestran la
 * carta chica. Si `wrapText` corta a 2 lineas en las cartas CON habilidad, media
 * docena de cartas salen con "…" a mitad de frase y el jugador nunca lee la
 * regla completa.
 *
 * Este script reproduce la metrica REAL (misma fuente, mismo ancho util, mismo
 * presupuesto via `descLineBudget`) y dice cuantas lineas pide cada carta. Con
 * eso se decide el presupuesto sin adivinar.
 *
 *   npm run audit:desc             # informe
 *   npm run audit:desc -- --json   # solo las que desbordan, en JSON
 *   npm run audit:desc -- --scale=1.2   # simula una tipografia 20% mas grande
 *
 * El flag `--scale` sirve para ELEGIR un aumento de tipografia con datos en la
 * mano: dice cuantas cartas empezarian a truncarse antes de tocar el dibujo.
 * El presupuesto de lineas no cambia con la escala (el panel mide lo mismo), asi
 * que un texto mas grande solo puede pedir MAS lineas.
 */
import { loadContentFromDisk, loadDictionaries } from './loadContent.node.ts';
import { descLineBudget, wrapTextLines } from '../src/render/CardTexture.ts';

const asJson = process.argv.includes('--json');
const scaleArg = process.argv.find((a) => a.startsWith('--scale='));
const SCALE = scaleArg ? Math.max(0.1, Number.parseFloat(scaleArg.split('=')[1] ?? '1') || 1) : 1;

const bundle = loadContentFromDisk();
const dicts = loadDictionaries();

function tr(lang: string, key: string): string {
  const parts = key.split('.');
  let node: unknown = dicts[lang];
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return '';
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : '';
}

/**
 * Las descripciones son ESPANIOL (es.json es el idioma fuente del proyecto).
 * Se mide con espanol porque es el texto mas largo de los dos: si entra en
 * espanol, entra en ingles.
 */
const LANG = 'es';

/** Metrica real de `drawCardFace` (W=512, pad=16, margen 34). */
const CARD_W = 512;
const PAD = 16;
const MARGIN = 34;
const MAX_WIDTH = CARD_W - PAD * 2 - MARGIN;
const DESC_PANEL_H = 126;
const ABILITY_TAG_H = 38;

interface Row {
  id: string;
  ability: boolean;
  lines: number;
  budget: number;
  chars: number;
  text: string;
}

const rows: Row[] = [];
for (const card of bundle.cards) {
  const hasAbility = (card.effects?.length ?? 0) > 0;
  const budget = descLineBudget(hasAbility);
  const text = tr(LANG, card.descKey);
  // `SCALE` simula una tipografia mas grande: el presupuesto de lineas NO
  // cambia (el panel mide lo mismo), asi que un texto mas grande solo puede
  // pedir mas lineas. Con `--scale=1` esto es la metrica real.
  const fontPx = (hasAbility ? 23 : 25) * SCALE;
  const lines = wrapTextLines(text, { fontPx, maxWidth: MAX_WIDTH }).length;
  rows.push({ id: card.id, ability: hasAbility, lines, budget, chars: text.length, text });
}

const overflowing = rows.filter((r) => r.lines > r.budget).sort((a, b) => b.lines - a.lines || a.id.localeCompare(b.id));

if (asJson) {
  console.log(JSON.stringify(overflowing, null, 2));
} else {
  const withAbility = rows.filter((r) => r.ability);
  const withoutAbility = rows.filter((r) => !r.ability);
  const maxA = withAbility.reduce((m, r) => Math.max(m, r.lines), 0);
  const maxNoA = withoutAbility.reduce((m, r) => Math.max(m, r.lines), 0);

  console.log('── Descripcion en la CARA de la carta ────────────');
  if (SCALE !== 1) console.log(`escala de tipografia : x${SCALE} (simulada)`);
  console.log(`cartas               : ${rows.length}`);
  console.log(`  con habilidad      : ${withAbility.length} (max ${maxA} lineas)`);
  console.log(`  sin habilidad      : ${withoutAbility.length} (max ${maxNoA} lineas)`);
  console.log(`presupuesto          : habilidad ${descLineBudget(true)}, normal ${descLineBudget(false)}`);
  console.log(`caben fisicamente    : habilidad ${Math.floor((DESC_PANEL_H - ABILITY_TAG_H) / 29)}, normal ${Math.floor(DESC_PANEL_H / 32)}`);
  console.log('');

  if (overflowing.length === 0) {
    console.log('✓ Ninguna descripcion se trunca.');
  } else {
    console.log(`! ${overflowing.length} carta(s) se truncan: piden mas lineas que el presupuesto.`);
    for (const r of overflowing) {
      console.log(
        `  ${r.id.padEnd(30)} ${r.ability ? '[HAB]' : '     '} ${r.lines} > ${r.budget} lineas · ${r.chars} car.`,
      );
    }
  }
}
