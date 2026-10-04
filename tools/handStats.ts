/**
 * handStats.ts — Medidor de CONSISTENCIA de los mazos iniciales por arquetipo.
 *
 * Responde una pregunta que `simulate.ts` (partidas completas) NO puede
 * contestar: ¿el mazo ya le entrega la combinación al jugador, o el jugador
 * tiene que construirla?
 *
 * El diagnostico real (2026-10): los 4 starters estaban armados con la MISMA
 * plantilla (6+6 comunes de la familia dominante, 3+3 raras de la familia
 * dominante, 2 puente). Resultado: 15-18 de 20 cartas compartian elemento Y
 * familia, asi que una mano cualquiera activaba Floracion (elemento) + Colonia
 * (familia) + el multiplicador de una carta, todo con las MISMAS cartas. El
 * jugador no decidia: el mazo decidia por el.
 *
 * Uso:
 *   npm run sim:hands                       # 20000 manos por arquetipo
 *   npm run sim:hands -- --hands 50000      # mas volumen
 *   npm run sim:hands -- --archetype spores # solo uno
 *   npm run sim:hands -- --json             # salida cruda (para comparar)
 *
 * Metricas (las del documento de diseno):
 *   - % manos con 3+ cartas del MISMO elemento   (Floracion automatica)
 *   - % manos con 3+ cartas de la MISMA familia  (Colonia automatica)
 *   - % manos con "triple bonus automatico"      (elemento3 + familia3 + mult. de carta)
 *   - % manos sin combo posible                  (ni elemento3 ni familia3)
 *   - muestreo de la puntuacion de la mejor jugada (normal vs perfecta)
 */

import { readFileSync } from 'node:fs';
import {
  GameEngine,
  RNG,
  type CardInstance,
  type ElementType,
} from '../src/engine/index.ts';
import { buildRegistry } from './loadContent.node.ts';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? 'true') : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const HANDS = Number(flag('hands', '20000')) || 20000;
const ONLY = flag('archetype');
const JSON_OUT = has('json');
const HAND_SIZE = Number(flag('handSize', '8')) || 8;
const PLAY_SIZE = Number(flag('playSize', '5')) || 5;

// ---------------------------------------------------------------------------
// Contenido real (mismo merge que el juego)
// ---------------------------------------------------------------------------

const registry = buildRegistry();
const bundle = registry.toBundle();

// El `CardRegistry` (el que sabe armar el mazo inicial) vive DENTRO del engine y
// se alimenta con `load(bundle)`. Se construye uno de descarte para reusarlo:
// asi el script ve exactamente el mismo mazo que arranca una run real.
const probe = new GameEngine({ seed: 1, bundle });
const cardRegistry = probe.registry;

interface ArchetypeDef {
  id: string;
  element: ElementType;
  accentElement: ElementType;
  starter: Array<{ cardId: string; copies: number }>;
  bias: ElementType[];
}

const ARCHETYPES: ArchetypeDef[] = JSON.parse(
  readFileSync(new URL('../src/data/archetypes.json', import.meta.url), 'utf8'),
) as ArchetypeDef[];

// ---------------------------------------------------------------------------
// Analisis de una mano
// ---------------------------------------------------------------------------

/** Una carta "multiplica esporas" si tiene un MULTIPLY_SPORES entre sus acciones. */
function multipliesSpores(card: CardInstance): boolean {
  const effects = (
    card.def as unknown as {
      effects?: Array<{ actions?: Array<{ type?: string }> }>;
    }
  ).effects;
  if (!Array.isArray(effects)) return false;
  return effects.some(
    (e) => Array.isArray(e.actions) && e.actions.some((a) => a.type === 'MULTIPLY_SPORES'),
  );
}

interface HandShape {
  maxElem: number;
  maxFam: number;
  hasMult: boolean;
}

function analyzeHand(hand: readonly CardInstance[]): HandShape {
  const elems = new Map<string, number>();
  const fams = new Map<string, number>();
  let hasMult = false;
  for (const c of hand) {
    if (c.def.element !== 'neutral') {
      elems.set(c.def.element, (elems.get(c.def.element) ?? 0) + 1);
    }
    fams.set(c.def.family, (fams.get(c.def.family) ?? 0) + 1);
    if (multipliesSpores(c)) hasMult = true;
  }
  const maxElem = Math.max(0, ...elems.values());
  const maxFam = Math.max(0, ...fams.values());
  return { maxElem, maxFam, hasMult };
}

// ---------------------------------------------------------------------------
// Medicion por arquetipo
// ---------------------------------------------------------------------------

interface ArchResult {
  id: string;
  deckSize: number;
  hands: number;
  elem3: number;
  fam3: number;
  triple: number;
  noCombo: number;
  scores: number[];
  deckElements: Record<string, number>;
  deckFamilies: Record<string, number>;
}

function measure(arch: ArchetypeDef): ArchResult {
  const res: ArchResult = {
    id: arch.id,
    deckSize: 0,
    hands: 0,
    elem3: 0,
    fam3: 0,
    triple: 0,
    noCombo: 0,
    scores: [],
    deckElements: {},
    deckFamilies: {},
  };

  // El mazo real del arquetipo (una sola vez: es deterministico por contenido).
  const deck = cardRegistry.buildStarterDeck(new RNG(1), arch.starter);
  res.deckSize = deck.length;
  for (const c of deck) {
    res.deckElements[c.def.element] = (res.deckElements[c.def.element] ?? 0) + 1;
    res.deckFamilies[c.def.family] = (res.deckFamilies[c.def.family] ?? 0) + 1;
  }

  for (let i = 0; i < HANDS; i++) {
    // Semilla distinta por mano: muestreamos el espacio de APERTURAS, no una
    // sola run. (xorshift-ish para no repetir semilla cercana.)
    const seed = ((i + 1) * 2654435761) % 2147483647 || 1;
    const engine = new GameEngine({ seed, bundle });
    engine.setArchetypeLoadout(arch.starter, arch.bias);
    engine.startRun(seed, 0, arch.id);
    engine.chooseBlind();

    const hand = engine.round?.hand ?? [];
    if (hand.length === 0) continue;
    res.hands++;

    const shape = analyzeHand(hand);
    if (shape.maxElem >= 3) res.elem3++;
    if (shape.maxFam >= 3) res.fam3++;
    if (shape.maxElem >= 3 && shape.maxFam >= 3 && shape.hasMult) res.triple++;
    if (shape.maxElem < 3 && shape.maxFam < 3) res.noCombo++;

    if (i % Math.max(1, Math.floor(HANDS / 200)) === 0) {
      const score = bestPlayScore(engine);
      if (score > 0) res.scores.push(score);
    }
  }
  return res;
}

/** Mejor jugada posible de la mano actual (busqueda exhaustiva hasta 5 cartas). */
function bestPlayScore(engine: GameEngine): number {
  const hand = engine.round?.hand ?? [];
  if (hand.length === 0) return 0;
  let best = 0;
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const combo: CardInstance[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) combo.push(hand[i] as CardInstance);
    if (combo.length > PLAY_SIZE) continue;
    engine.clearSelection();
    for (const card of combo) engine.toggleSelect(card.uid);
    const preview = engine.previewSelection();
    if (preview && preview.total > best) best = preview.total;
  }
  engine.clearSelection();
  return best;
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  if (total === 0) return '  0.0%';
  return `${((n / total) * 100).toFixed(1)}%`.padStart(6);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] as number;
}

function report(results: ArchResult[]): void {
  const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
  };
  for (const r of results) {
    const topElem = Object.entries(r.deckElements).sort((a, b) => b[1] - a[1])[0];
    const topFam = Object.entries(r.deckFamilies).sort((a, b) => b[1] - a[1])[0];
    const sorted = [...r.scores].sort((a, b) => a - b);
    console.log(`\n${C.bold}=== ${r.id} ===${C.reset}  (mazo ${r.deckSize}, ${r.hands} manos)`);
    console.log(
      `  ${C.dim}mazo:${C.reset} elem ${C.cyan}${topElem?.[0]}=${topElem?.[1]}${C.reset}` +
        ` (${((topElem?.[1] ?? 0) / r.deckSize * 100).toFixed(0)}%),` +
        ` familia ${C.cyan}${topFam?.[0]}=${topFam?.[1]}${C.reset}` +
        ` (${((topFam?.[1] ?? 0) / r.deckSize * 100).toFixed(0)}%)`,
    );
    console.log(`  3+ elemento  (Floracion auto): ${pct(r.elem3, r.hands)}`);
    console.log(`  3+ familia   (Colonia auto)  : ${pct(r.fam3, r.hands)}`);
    console.log(`  TRIPLE BONUS automatico      : ${pct(r.triple, r.hands)}`);
    console.log(`  sin combo posible            : ${pct(r.noCombo, r.hands)}`);
    if (sorted.length > 0) {
      const med = percentile(sorted, 50);
      const p90 = percentile(sorted, 90);
      const max = sorted[sorted.length - 1] ?? 0;
      console.log(
        `  score mejor jugada: mediana ${C.yellow}${med}${C.reset}` +
          `  p90 ${C.yellow}${p90}${C.reset}  max ${C.yellow}${max}${C.reset}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const targets = ONLY ? ARCHETYPES.filter((a) => a.id === ONLY) : ARCHETYPES;
  if (targets.length === 0) {
    console.error(`Arquetipo desconocido: ${ONLY}`);
    process.exit(1);
  }

  const results = targets.map(measure);

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(
    `\nConsistencia de aperturas — mano de ${HAND_SIZE} (juega hasta ${PLAY_SIZE}), ` +
      `${HANDS} manos por arquetipo.\n` +
      `Objetivos: 3+ elemento 50-70%, 3+ familia 35-55%, triple <20%, sin combo <20%.`,
  );
  report(results);
}

main();
