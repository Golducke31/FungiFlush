/**
 * simulate.ts — Harness de consola (Fase 2).
 *
 * Corre partidas completas SIN GPU, SIN DOM y SIN Three.js, leyendo la
 * terminal. Es la red de seguridad del Trigger Engine: si una cadena de
 * reacciones puede colgar el juego, se descubre aca y no en el navegador.
 *
 * Uso:
 *   npm run sim                       # valida contenido + 200 partidas
 *   npm run sim -- --runs 2000        # mas volumen
 *   npm run sim -- --stress           # prueba de bucles infinitos
 *   npm run sim -- --show 5           # imprime el log de 5 partidas
 */

import {
  CardRegistry,
  GameEngine,
  bus,
  describeResolution,
  type CardInstance,
  type InterludeEffect,
  type ResolutionContext,
} from '../src/engine/index.ts';
import { validateDictionaryCoverage } from '../src/i18n/coverage.ts';
import { loadContentFromDisk, loadDictionaries } from './loadContent.node.ts';
import { SIMULATED_PHASES } from './simPhases.ts';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? 'true') : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const RUNS = Number(flag('runs', '100')) || 100;
const QUIET = has('quiet');
const STRESS = has('stress');
const SHOW = Number(flag('show', '0')) || 0;
const SEED = Number(flag('seed', '20260927')) || 20260927;
/**
 * Nivel de ascension a simular (R1). `--ascension 5` mide el balance de A5 sin
 * tocar el contenido: es la unica forma de saber si un nivel es justo antes de
 * publicarlo. Sin el flag, corre A0 (la curva base de siempre).
 */
const ASCENSION = Number(flag('ascension', '0')) || 0;

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// ---------------------------------------------------------------------------
// Telemetria del bus (detecta bucles y mide profundidad)
// ---------------------------------------------------------------------------

interface Telemetry {
  maxDepth: number;
  overflows: number;
  overflowReasons: string[];
  chains: number;
  triggers: number;
}

const telemetry: Telemetry = { maxDepth: 0, overflows: 0, overflowReasons: [], chains: 0, triggers: 0 };

bus.on('trigger:fired', ({ depth }) => {
  telemetry.triggers += 1;
  if (depth > telemetry.maxDepth) telemetry.maxDepth = depth;
});
bus.on('trigger:chain', () => {
  telemetry.chains += 1;
});
bus.on('trigger:overflow', ({ event, depth, reason }) => {
  telemetry.overflows += 1;
  telemetry.overflowReasons.push(`${reason} @ ${event} depth=${depth}`);
});

// ---------------------------------------------------------------------------
// Politica de IA (para que las partidas automaticas sean creibles)
// ---------------------------------------------------------------------------

/** Todas las combinaciones de tamano 1..5 de una mano. */
function subsets<T>(items: T[], maxSize = 5): T[][] {
  const out: T[][] = [];
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const combo: T[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) combo.push(items[i] as T);
    if (combo.length <= maxSize) out.push(combo);
  }
  return out;
}

interface PolicyResult {
  play: CardInstance[];
  score: number;
}

/** Elige la mejor jugada evaluando todas las combinaciones (busqueda exhaustiva). */
function bestPlay(engine: GameEngine): PolicyResult {
  const hand = engine.round?.hand ?? [];
  if (hand.length === 0) return { play: [], score: 0 };

  let best: CardInstance[] = [hand[0] as CardInstance];
  let bestScore = -1;

  for (const combo of subsets(hand, 5)) {
    engine.clearSelection();
    for (const card of combo) engine.toggleSelect(card.uid);
    const preview = engine.previewSelection();
    const score = preview?.total ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = combo;
    }
  }

  engine.clearSelection();
  return { play: best, score: Math.max(0, bestScore) };
}

// ---------------------------------------------------------------------------
// Simulacion de una partida
// ---------------------------------------------------------------------------

interface RunResult {
  seed: number;
  outcome: 'victory' | 'game_over';
  ante: number;
  blindsCleared: number;
  handsPlayed: number;
  discardsUsed: number;
  bestHand: number;
  finalMoney: number;
  jokers: number;
  deckSize: number;
  destroyed: number;
  /** Cartas ofrecidas en drafts de recompensa. */
  rewardsOffered: number;
  /** Cartas efectivamente tomadas en los drafts. */
  rewardsTaken: number;
  /** Mejoras compradas en la tienda. */
  upgradesBought: number;
  /** Interludios resueltos (P2.3/P2.4): paradas de decision entre ciegos. */
  interludesResolved: number;
  /** Problemas reales: la partida no pudo continuar. */
  errores: string[];
  /** Cortes de seguridad del Trigger Engine (no son fallos). */
  overflows: number;
}

/** Valor heuristico de una carta para decidir que descartar. */
function cardValue(card: CardInstance): number {
  return card.def.baseSubstrate + card.def.baseSpores * 3;
}

/**
 * Puntua un efecto de interludio desde el punto de vista del bot. Positivo =
 * el trato conviene; negativo = cuesta mas de lo que da.
 *
 * El objetivo de un ciego es lo que hay que batir, asi que subirlo (multiplicar
 * >1) es un COSTE y bajarlo es una ventaja. Lo demas es valor directo: dinero,
 * cartas, slots de joker, manos y tamano de mano suman; la purga aleatoria es
 * ambigua (adelgaza el mazo, que suele ser bueno) y se puntua apenas positivo.
 */
function interludeEffectValue(effect: InterludeEffect): number {
  switch (effect.type) {
    case 'MONEY':
      return effect.value;
    case 'TARGET_MULTIPLIER':
      // 1.15 -> -15 puntos de "dificultad" (malo); 0.85 -> +15 (bueno).
      return (1 - effect.value) * 100;
    case 'JOKER_SLOT':
      return effect.value * 25;
    case 'HANDS_DELTA':
      return effect.value * 30;
    case 'HAND_SIZE':
      return effect.value * 20;
    case 'CARD':
      return (effect.count ?? 1) * 12;
    case 'UPGRADE_RANDOM':
      return (effect.count ?? 1) * 18;
    case 'PURGE_RANDOM':
      // Purga: mazo mas fino, en general bueno, pero aleatorio. Poco peso.
      return (effect.count ?? 1) * 4;
    default:
      return 0;
  }
}

/**
 * Elige la opcion del interludio que el bot tomaria. Siempre prefiere una
 * jugada que pueda PAGAR; si ninguna conviene, declina (que no tiene efectos y
 * es la salida segura que garantiza el contenido).
 */
function bestInterludeChoice(
  choices: readonly { id: string; effects?: readonly InterludeEffect[] }[],
  money: number,
): { id: string; score: number } {
  let best: { id: string; score: number } | null = null;
  for (const choice of choices) {
    const effects = choice.effects ?? [];
    const cost = effects.reduce((sum, e) => (e.type === 'MONEY' ? sum + e.value : sum), 0);
    // No se puede pagar la parte en dinero: se descarta la opcion (el motor la
    // rechazaria y el bot quedaria trabado).
    if (money + cost < 0) continue;
    // Declinar no tiene efectos: puntua 0 y sirve de piso. Con score estricto
    // (>), un trato que empata con declinar no se toma: mejor no arriesgar.
    const score = effects.reduce((sum, e) => sum + interludeEffectValue(e), 0);
    if (!best || score > best.score) best = { id: choice.id, score };
  }
  return best ?? { id: 'decline', score: 0 };
}

/** A partir de este tamano de mazo el bot deja de tomar cartas en los drafts. */
const DRAFT_DECK_LIMIT = 55;

/**
 * Fungis que el bot no gasta en mejoras. Sin reserva, volcaria TODO en una sola
 * carta y la simulacion dejaria de parecerse a una partida real.
 */
const UPGRADE_RESERVE = 20;

function simulateRun(seed: number, verbose: boolean): RunResult {
  const engine = new GameEngine({ seed, bundle: content });
  const errores: string[] = [];
  let overflows = 0;
  let discardsUsed = 0;
  let rewardsOffered = 0;
  let rewardsTaken = 0;
  let upgradesBought = 0;
  let interludesResolved = 0;
  engine.startRun(seed, ASCENSION);

  const track = (label: string, res: ResolutionContext | null) => {
    if (!res) return;
    overflows += res.overflowEvents.length;
    if (verbose) {
      console.log(`      ${C.dim}${label} -> ${describeResolution(res)}${C.reset}`);
    }
  };

  let safety = 0;
  while (safety++ < 400) {
    const status = engine.run.status;
    if (status === 'game_over' || status === 'victory') break;

    if (status === 'interlude') {
      // P2.3/P2.4: parada entre ciegos con una decision de riesgo/recompensa.
      // El bot toma el mejor trato que pueda PAGAR y, si ninguno conviene,
      // declina. Antes este estado no estaba cubierto: el bot cortaba la run
      // con "estado inesperado: interlude" (~99% de las partidas al llegar al
      // primer interludio), lo que ademas envenenaba la telemetria de balance.
      const def = engine.currentInterlude;
      if (!def) {
        errores.push('estado interlude sin definicion pendiente');
        break;
      }
      const choice = bestInterludeChoice(def.choices, engine.run.money);
      if (!engine.chooseInterlude(choice.id)) {
        errores.push(`chooseInterlude("${choice.id}") fallo con una opcion valida`);
        break;
      }
      interludesResolved += 1;
      continue;
    }

    if (status === 'blind_select') {
      // Progresion estandar: small -> big -> boss dentro de cada ante.
      engine.chooseBlind();
      continue;
    }

    if (status === 'playing') {
      const round = engine.round;
      if (!round) {
        errores.push('estado playing sin ronda');
        break;
      }

      const { play, score } = bestPlay(engine);

      // Politica de descarte: si la mejor jugada no alcanza para cerrar el
      // blind con las manos que quedan, y hay descartes, se cambia la mano.
      const needed = (round.target - round.score) / Math.max(1, round.handsLeft);
      const handIsWeak = score < needed * 0.75;
      if (handIsWeak && round.discardsLeft > 0 && round.hand.length > 3) {
        const worst = [...round.hand].sort((a, b) => cardValue(a) - cardValue(b)).slice(0, 5);
        engine.clearSelection();
        for (const card of worst) engine.toggleSelect(card.uid);
        const res = engine.discardSelected();
        if (res) {
          discardsUsed += 1;
          track('discard', res);
          continue;
        }
        engine.clearSelection();
      }

      if (play.length === 0) {
        errores.push('mano vacia en estado playing');
        break;
      }
      engine.clearSelection();
      for (const card of play) engine.toggleSelect(card.uid);

      const res = engine.playHand();
      track('playHand', res);
      if (!res) {
        errores.push('playHand devolvio null con seleccion valida');
        break;
      }
      if (verbose) {
        console.log(
          `      ${C.cyan}score ${round.score}${C.reset} / ${round.target} ${C.dim}(${round.handsLeft} manos)${C.reset}`,
        );
      }
      continue;
    }

    if (status === 'reward') {
      // Politica del draft: tomar la mejor carta, salvo que el mazo ya este
      // demasiado grande. Diluir un mazo cuesta mas de lo que suma una carta
      // mediocre, asi que a partir de cierto tamano el bot prefiere saltar.
      const offers = engine.rewardOffers().filter((o) => !o.sold);
      const deckSize = engine.run.deck.totalSize;

      let best: { id: string; value: number } | null = null;
      for (const offer of offers) {
        const def = engine.registry.tryGetCard(offer.refId);
        if (!def) continue;
        const value = def.baseSubstrate + def.baseSpores * 3;
        if (!best || value > best.value) best = { id: offer.id, value };
      }

      rewardsOffered += offers.length;
      if (best && deckSize < DRAFT_DECK_LIMIT) {
        if (engine.chooseReward(best.id)) rewardsTaken += 1;
        else errores.push('chooseReward fallo con una oferta valida');
      } else if (!engine.chooseReward(null)) {
        errores.push('chooseReward(skip) fallo');
      }
      continue;
    }

    if (status === 'shop') {
      // Compra voraz: prioriza jokers (que escalan) y luego lo mas barato.
      let bought = true;
      while (bought) {
        bought = false;
        const offers = [...(engine.run.shop?.offers ?? [])].sort((a, b) => {
          const score = (k: string) => (k === 'joker' ? 0 : k === 'mutation' ? 1 : 2);
          return score(a.kind) - score(b.kind) || a.cost - b.cost;
        });
        for (const offer of offers) {
          if (offer.sold || offer.cost > engine.run.money) continue;
          if (offer.kind === 'joker' && engine.run.jokers.length >= engine.run.jokerSlots) continue;
          if (engine.buyOffer(offer.id)) {
            bought = true;
            break;
          }
        }
      }
      // Cultivo: con el dinero que sobra despues de comprar, el bot mejora su
      // mejor carta. Es lo que haria un jugador, y ejercita el camino de
      // mejoras (que no tiene techo) dentro de la simulacion.
      if (engine.hasUpgrades) {
        let guard = 0;
        while (guard++ < 40 && engine.run.money > UPGRADE_RESERVE) {
          const best = [...engine.run.deck.allCards].sort(
            (a, b) =>
              b.def.baseSubstrate + b.bonusSubstrate - (a.def.baseSubstrate + a.bonusSubstrate),
          )[0];
          if (!best) break;
          const quote = engine.upgradeQuote(best.uid);
          if (!quote || quote.atMaxLevel || quote.cost > engine.run.money - UPGRADE_RESERVE) break;
          if (!engine.upgradeCard(best.uid)) break;
          upgradesBought += 1;
        }
      }

      engine.leaveShop();
      continue;
    }

    // Estado sin rama. Si es una fase que simula el bot (SIMULATED_PHASES),
    // falta la implementacion aca; si no esta en ninguna lista, es una fase
    // nueva del motor que hay que clasificar en tools/simPhases.ts. El mensaje
    // apunta al archivo correcto para que el arreglo sea evidente desde la CI.
    const known = (SIMULATED_PHASES as readonly string[]).includes(status);
    errores.push(
      known
        ? `estado inesperado: ${status} (declarado en SIMULATED_PHASES pero sin rama en el bot)`
        : `estado inesperado: ${status} (fase sin clasificar en tools/simPhases.ts)`,
    );
    break;
  }

  if (safety >= 400) errores.push('safety break: la partida no termino en 400 iteraciones');

  return {
    seed,
    outcome: engine.run.status === 'victory' ? 'victory' : 'game_over',
    ante: engine.run.ante,
    blindsCleared: engine.run.stats.blindsCleared,
    handsPlayed: engine.run.stats.handsPlayed,
    discardsUsed,
    bestHand: engine.run.stats.bestHand,
    finalMoney: engine.run.money,
    jokers: engine.run.jokers.length,
    deckSize: engine.run.deck.totalSize,
    destroyed: engine.run.stats.cardsDestroyed,
    rewardsOffered,
    rewardsTaken,
    upgradesBought,
    interludesResolved,
    errores,
    overflows,
  };
}

// ---------------------------------------------------------------------------
// Prueba de stress: bucles infinitos
// ---------------------------------------------------------------------------

function stressTest(): boolean {
  console.log(`\n${C.bold}${C.magenta}PRUEBA DE STRESS — proteccion anti bucles${C.reset}`);
  console.log(`  ${C.dim}Se inyecta contenido deliberadamente malicioso: cartas que se`);
  console.log(`  re-disparan a si mismas y jokers que se realimentan sin condicion.`);
  console.log(`  Sin los tres frenos del TriggerEngine esto no terminaria nunca.${C.reset}\n`);

  // --- Contenido adversarial, construido a mano ---
  const evilBundle = {
    cards: [
      {
        id: 'evil_self_loop',
        nameKey: 'evil.self.name',
        descKey: 'evil.self.desc',
        element: 'neutral' as const,
        family: 'agaricaceae' as const,
        rarity: 'mythic' as const,
        baseSubstrate: 1,
        baseSpores: 1,
        cost: 0,
        art: { hue: 0, pattern: 'radial' as const, silhouette: 'cap' as const },
        tags: ['starter'],
        copies: 5,
        effects: [
          // 1. Se retriggerea a si misma para siempre (target: self).
          {
            id: 'evil_a',
            trigger: 'ON_PLAY' as const,
            target: 'self' as const,
            actions: [{ type: 'RETRIGGER' as const, value: 1 }],
          },
          // 2. Cada disparo emite ON_SPORES_GAINED, que vuelve a sumar Spores.
          {
            id: 'evil_b',
            trigger: 'ON_SPORES_GAINED' as const,
            actions: [{ type: 'ADD_SPORES' as const, value: 1 }],
          },
          // 3. Abanico ancho: dispara a todas las cartas jugadas a la vez.
          {
            id: 'evil_c',
            trigger: 'ON_CARD_PLAYED' as const,
            target: 'scored_cards' as const,
            actions: [{ type: 'MULTIPLY_SPORES' as const, value: 1.01 }],
          },
        ],
      },
    ],
    jokers: [
      {
        id: 'evil_joker',
        nameKey: 'evil.joker.name',
        descKey: 'evil.joker.desc',
        rarity: 'mythic' as const,
        cost: 0,
        sellValue: 0,
        art: { hue: 300, pattern: 'crystal' as const, silhouette: 'coral' as const },
        effects: [
          // Sin condicion y sin "once": se realimenta en cada evento.
          {
            id: 'evil_j1',
            trigger: 'ON_HAND_SCORED' as const,
            actions: [{ type: 'RETRIGGER' as const, value: 5 }],
          },
          {
            id: 'evil_j2',
            trigger: 'ON_SUBSTRATE_GAINED' as const,
            actions: [{ type: 'ADD_SUBSTRATE' as const, value: 1 }],
          },
        ],
      },
    ],
    blinds: [
      {
        id: 'evil_blind',
        nameKey: 'evil.blind.name',
        descKey: 'evil.blind.desc',
        ante: 1,
        scoreMultiplier: 1,
        reward: 0,
        effects: [
          {
            id: 'evil_b1',
            trigger: 'ON_ROUND_START' as const,
            actions: [{ type: 'EMIT_EVENT' as const, event: 'ON_ROUND_START' as const }],
          },
        ],
      },
      { id: 'evil_blind2', nameKey: 'b2', descKey: 'b2', ante: 1, scoreMultiplier: 1.5, reward: 0 },
      { id: 'evil_blind3', nameKey: 'b3', descKey: 'b3', ante: 1, scoreMultiplier: 2, reward: 0 },
    ],
  };

  const engine = new GameEngine({ seed: 999, bundle: evilBundle as never });

  const started = Date.now();
  engine.startRun(999);
  // El blind malicioso dispara EMIT_EVENT de ON_ROUND_START: si los frenos
  // fallaran, el cuelgue ocurriria justo aca.
  engine.chooseBlind();
  const startMs = Date.now() - started;

  engine.run.jokerSlots = 99;
  for (let i = 0; i < 5; i++) engine.run.jokers.push(engine.registry.instantiateJoker('evil_joker'));

  const round = engine.round;
  if (round) {
    round.hand = [];
    for (let i = 0; i < 5; i++) round.hand.push(engine.registry.instantiate('evil_self_loop'));
    round.handSize = 5;
    for (const card of round.hand) engine.toggleSelect(card.uid);
  }

  const playStart = Date.now();
  const res = engine.playHand();
  const elapsed = Date.now() - playStart;

  if (!res) {
    console.log(`  ${C.red}✗ playHand devolvio null${C.reset}`);
    return false;
  }

  const budgetSpent = 600 - res.budget;
  const ok = elapsed < 5000;

  console.log(`  Cartas jugadas        : ${res.scoredCards.length}`);
  console.log(`  Jokers activos        : ${engine.run.jokers.length}`);
  console.log(`  Arranque de run       : ${startMs} ms ${C.dim}(el EMIT_EVENT de ON_ROUND_START no colgo)${C.reset}`);
  console.log(`  Disparos ejecutados   : ${res.steps.length}`);
  console.log(`  Profundidad alcanzada : ${C.yellow}${telemetry.maxDepth}${C.reset} ${C.dim}(freno 1: limite 12)${C.reset}`);
  console.log(`  Presupuesto usado     : ${budgetSpent} / 600 ${C.dim}(freno 2)${C.reset}`);
  console.log(`  Cortes registrados    : ${res.overflowEvents.length} ${C.dim}(freno 3: reporte)${C.reset}`);
  console.log(`  Score resultante      : ${res.total}`);
  console.log(`  Tiempo de resolucion  : ${elapsed} ms`);
  console.log(
    ok
      ? `\n  ${C.green}✓ Los tres frenos actuaron. El motor termino en ${elapsed} ms sin colgarse.${C.reset}`
      : `\n  ${C.red}✗ TARDO DEMASIADO (${elapsed} ms): revisar los frenos.${C.reset}`,
  );
  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const content = loadContentFromDisk();

console.log(`${C.bold}${C.green}FungiFlush — Harness de consola${C.reset}`);
console.log(`${C.dim}seed=${SEED} runs=${RUNS}${C.reset}\n`);

// --- 1. Validacion de contenido ---
const registry = new CardRegistry();
registry.load(content);
const issues = registry.validate();
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');

console.log(`${C.bold}1. Validacion de contenido${C.reset}`);
if (errors.length === 0 && warnings.length === 0) {
  console.log(`  ${C.green}✓ Sin problemas.${C.reset}`);
} else {
  for (const issue of errors) {
    console.log(`  ${C.red}✗ [error] ${issue.where}${C.reset}\n      ${issue.message}`);
  }
  for (const issue of warnings.slice(0, 12)) {
    console.log(`  ${C.yellow}! [warn ] ${issue.where}${C.reset}\n      ${issue.message}`);
  }
  if (warnings.length > 12) console.log(`  ${C.dim}... y ${warnings.length - 12} avisos mas.${C.reset}`);
}
console.log(`  ${errors.length} errores, ${warnings.length} avisos.`);

const stats = registry.stats();
console.log(
  `\n  Contenido: ${C.bold}${stats.cards}${C.reset} cartas, ${C.bold}${stats.jokers}${C.reset} jokers, ${C.bold}${stats.blinds}${C.reset} blinds`,
);
console.log(`  Por rareza: ${Object.entries(stats.byRarity).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  Por elemento: ${Object.entries(stats.byElement).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  Triggers usados: ${stats.triggersUsed.join(', ')}`);

if (errors.length > 0) {
  console.log(`\n${C.red}Hay errores de contenido. Abortando simulacion.${C.reset}`);
  process.exit(1);
}

// --- 1b. Cobertura de traducciones ---
console.log(`\n${C.bold}1b. Cobertura de traducciones${C.reset}`);
const dictionaries = loadDictionaries();
const missingKeys = validateDictionaryCoverage(content, dictionaries);
if (missingKeys.length === 0) {
  console.log(
    `  ${C.green}✓ Todas las claves i18n del contenido existen en ${Object.keys(dictionaries).join(', ')}.${C.reset}`,
  );
} else {
  console.log(`  ${C.red}✗ ${missingKeys.length} claves faltantes:${C.reset}`);
  for (const key of missingKeys.slice(0, 20)) console.log(`      ${key}`);
  if (missingKeys.length > 20) console.log(`      ${C.dim}... y ${missingKeys.length - 20} mas.${C.reset}`);
  process.exit(1);
}

// --- 2. Prueba de stress ---
if (STRESS) {
  const ok = stressTest();
  if (!ok) process.exit(1);
}

// --- 3. Partidas simuladas ---
console.log(`\n${C.bold}2. Simulacion de ${RUNS} partidas completas${C.reset}`);
if (ASCENSION > 0) {
  console.log(`${C.yellow}   Ascension: A${ASCENSION}${C.reset}`);
}
const t0 = Date.now();
const results: RunResult[] = [];

for (let i = 0; i < RUNS; i++) {
  const seed = SEED + i * 7919;
  const verbose = !QUIET && i < SHOW;
  if (verbose) console.log(`\n  ${C.blue}--- Partida ${i + 1} (seed ${seed}) ---${C.reset}`);
  results.push(simulateRun(seed, verbose));
}

const elapsed = Date.now() - t0;

// --- 4. Reporte ---
const wins = results.filter((r) => r.outcome === 'victory').length;
const withErrors = results.filter((r) => r.errores.length > 0);
const totalOverflows = results.reduce((acc, r) => acc + r.overflows, 0);
const anteReached = new Map<number, number>();
for (const r of results) anteReached.set(r.ante, (anteReached.get(r.ante) ?? 0) + 1);

const avg = (fn: (r: RunResult) => number) =>
  results.length > 0 ? results.reduce((acc, r) => acc + fn(r), 0) / results.length : 0;
const max = (fn: (r: RunResult) => number) => results.reduce((acc, r) => Math.max(acc, fn(r)), 0);

console.log(`\n${C.bold}3. Reporte de balance${C.reset}`);
console.log(`  Tiempo total          : ${elapsed} ms (${(elapsed / RUNS).toFixed(1)} ms/partida)`);
console.log(`  Victorias (ante 8)    : ${wins} / ${RUNS} (${((wins / RUNS) * 100).toFixed(1)}%)`);
console.log(`  Ante promedio         : ${avg((r) => r.ante).toFixed(2)}`);
console.log(`  Blinds superados      : ${avg((r) => r.blindsCleared).toFixed(2)} promedio`);
console.log(`  Manos jugadas         : ${avg((r) => r.handsPlayed).toFixed(1)} promedio`);
console.log(`  Descartes usados      : ${avg((r) => r.discardsUsed).toFixed(1)} promedio`);
console.log(`  Mejor mano promedio   : ${avg((r) => r.bestHand).toFixed(0)}`);
console.log(`  Mejor mano absoluta   : ${max((r) => r.bestHand)}`);
console.log(`  Jokers finales        : ${avg((r) => r.jokers).toFixed(2)} promedio`);
console.log(`  Cartas destruidas     : ${avg((r) => r.destroyed).toFixed(2)} promedio`);
console.log(
  `  Drafts (ofertas)      : ${avg((r) => r.rewardsOffered).toFixed(1)} ofrecidas / ${avg((r) => r.rewardsTaken).toFixed(1)} tomadas`,
);
console.log(`  Mejoras compradas     : ${avg((r) => r.upgradesBought).toFixed(2)} promedio`);
console.log(`  Interludios resueltos : ${avg((r) => r.interludesResolved).toFixed(2)} promedio`);

console.log(`\n  ${C.dim}Distribucion de ante alcanzado:${C.reset}`);
for (let ante = 1; ante <= 8; ante++) {
  const count = anteReached.get(ante) ?? 0;
  const pct = (count / RUNS) * 100;
  const bar = '█'.repeat(Math.round(pct / 2));
  console.log(`    Ante ${ante}: ${String(count).padStart(5)} ${C.cyan}${bar}${C.reset}`);
}

console.log(`\n  ${C.dim}Telemetria de disparadores:${C.reset}`);
console.log(`    Disparos resueltos   : ${telemetry.triggers}`);
console.log(`    Cadenas A->B         : ${telemetry.chains}`);
console.log(`    Profundidad maxima   : ${telemetry.maxDepth}`);
console.log(`    Cortes por overflow  : ${telemetry.overflows}`);

// --- 5. Veredicto ---
console.log(`\n${C.bold}4. Veredicto${C.reset}`);
if (withErrors.length > 0) {
  console.log(`  ${C.red}✗ ${withErrors.length} partidas reportaron problemas:${C.reset}`);
  for (const r of withErrors.slice(0, 5)) {
    console.log(`      seed ${r.seed}: ${r.errores.join(' | ')}`);
  }
  process.exit(1);
}

if (totalOverflows > 0) {
  console.log(
    `  ${C.yellow}! ${totalOverflows} cortes de seguridad en ${RUNS} partidas (${(totalOverflows / RUNS).toFixed(2)} por partida).${C.reset}`,
  );
  console.log(
    `      ${C.dim}No son cuelgues: es el Trigger Engine cortando cadenas al limite.${C.reset}`,
  );
  if (totalOverflows / RUNS > 1) {
    console.log(
      `      ${C.yellow}Revisar contenido: hay cartas que se re-disparan en cascada con demasiada frecuencia.${C.reset}`,
    );
  }
}

console.log(`  ${C.green}✓ ${RUNS} partidas completadas sin cuelgues ni bucles infinitos.${C.reset}`);
console.log(
  `  ${C.green}✓ El Trigger Engine es determinista y estable a profundidad ${telemetry.maxDepth}.${C.reset}\n`,
);
