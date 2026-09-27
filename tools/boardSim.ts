/**
 * boardSim.ts — Simulacion masiva del duelo micelial.
 *
 *   npm run sim:board                 # 10.000 partidas aleatorias
 *   npm run sim:board -- --runs 500 --quiet
 *
 * Un duelo es un caso perfecto para simulacion adversarial: el azar elige
 * celdas y cartas sin ninguna estrategia, que es justo lo que lleva al motor a
 * los rincones. Se verifican tres propiedades, en orden de importancia:
 *
 *   1. NO MUTACION. El estado entra congelado (`Object.freeze` profundo). Si
 *      `applyCommand` escribiera en su entrada, el modo estricto de los modulos
 *      ES tira excepcion en el acto, y el contador de fallas lo registra. Es la
 *      propiedad mas facil de romper sin querer y la mas cara: un render que
 *      lee el estado anterior mientras el motor ya lo cambio.
 *   2. DETERMINISMO. Cada partida se juega DOS veces y ademas se re-ejecuta su
 *      log de comandos sobre un estado nuevo. Sin esto no se puede depurar un
 *      bug de duelo ni mandar comandos por la red (Fase 9).
 *   3. TERMINACION. Toda partida termina, y la red de profundidad nunca se
 *      activa.
 */

import { RNG } from '../src/engine/rng.ts';
import {
  BOARD_HAND_SIZE,
  applyCommand,
  createMatch,
  type BoardCardDef,
  type BoardState,
  type MatchCommand,
} from '../src/engine/board/index.ts';
import { buildRegistry } from './loadContent.node.ts';

interface Options {
  runs: number;
  quiet: boolean;
  baseSeed: number;
  /** Cartas por jugador. Sirve para tantear el tamaño de partida. */
  handSize?: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { runs: 10_000, quiet: false, baseSeed: 20260927 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') options.quiet = true;
    else if (arg === '--runs') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isFinite(value) && value > 0) options.runs = value;
    } else if (arg === '--hand') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isFinite(value) && value > 0) options.handSize = value;
    } else if (arg === '--seed') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isFinite(value)) options.baseSeed = value;
    }
  }
  return options;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Huella estable del estado: si dos partidas difieren, la huella difiere. */
function fingerprint(state: BoardState): string {
  const cells = state.cells
    .map((card) => (card ? `${card.owner}${card.faceUp ? 'u' : 'd'}:${card.uid}` : '-'))
    .join(',');
  const hands = state.hands.map((hand) => hand.map((c) => c.uid).join('+')).join('|');
  return [
    cells,
    hands,
    state.currentPlayer,
    state.turn,
    state.status,
    String(state.winner),
    state.rng,
  ].join('#');
}

interface GameResult {
  commands: MatchCommand[];
  final: BoardState;
  placements: number;
  flips: number;
  chained: number;
  maxDepth: number;
  truncated: number;
  /** Cuantas veces una escritura sobre el estado congelado exploto. */
  mutationThrows: number;
}

/** Una partida aleatoria. Congela cada estado antes de aplicarle un comando. */
function playRandomGame(
  defs: readonly BoardCardDef[],
  seed: number,
  quiet: boolean,
  handSize?: number,
): GameResult {
  const rng = new RNG(seed ^ 0x5bf03635);
  let state = createMatch(handSize === undefined ? { defs, seed } : { defs, seed, handSize });
  const commands: MatchCommand[] = [];
  let placements = 0;
  let flips = 0;
  let chained = 0;
  let maxDepth = 0;
  let truncated = 0;
  let mutationThrows = 0;

  // Tope duro: con 10 colocaciones no deberia llegar ni cerca. Si se alcanza,
  // la partida no termino y el reporte lo tiene que gritar.
  const guard = state.cells.length * 4 + 32;
  for (let step = 0; step < guard; step++) {
    if (state.status !== 'placing') break;

    const player = state.currentPlayer;
    const card = rng.pick(state.hands[player]);
    const free = state.cells
      .map((cell, index) => (cell === null ? index : -1))
      .filter((index) => index >= 0);
    const cell = rng.pick(free);
    if (!card || cell === undefined) break;

    const command: MatchCommand = {
      t: 'place',
      by: player,
      cell,
      uid: card.uid,
      faceDown: rng.chance(0.25),
    };
    commands.push(command);

    deepFreeze(state);
    let result;
    try {
      result = applyCommand(state, command);
    } catch (error) {
      mutationThrows += 1;
      if (!quiet && mutationThrows <= 3) {
        console.error(`  ✗ mutacion detectada (seed ${seed}): ${String(error)}`);
      }
      break;
    }
    if (result.error) throw new Error(`[boardSim] comando rechazado: ${result.error}`);

    for (const s of result.steps) {
      if (s.kind === 'flip') flips += 1;
      if (s.depth > 0) chained += 1;
      if (s.depth > maxDepth) maxDepth = s.depth;
    }
    if (result.truncated) truncated += 1;

    placements += 1;
    state = result.state;
  }

  return { commands, final: state, placements, flips, chained, maxDepth, truncated, mutationThrows };
}

/** Re-ejecuta un log de comandos sobre un estado nuevo. */
function replay(
  defs: readonly BoardCardDef[],
  seed: number,
  commands: readonly MatchCommand[],
  handSize?: number,
): BoardState {
  let state = createMatch(handSize === undefined ? { defs, seed } : { defs, seed, handSize });
  for (const command of commands) {
    const result = applyCommand(state, command);
    if (result.error) throw new Error(`[boardSim] replay rechazado: ${result.error}`);
    state = result.state;
  }
  return state;
}

// `options` se resuelve una sola vez al arrancar y lo leen los helpers.
let options: Options = { runs: 10_000, quiet: false, baseSeed: 20260927 };

function main(): void {
  options = parseArgs(process.argv.slice(2));
  const registry = buildRegistry();
  const defs = registry.boardDefs();
  const defsSnapshot = JSON.stringify(defs);

  if (!options.quiet) {
    console.log('── Duelo micelial ─────────────────────────');
    console.log(`cartas de tablero  ${defs.length}`);
    console.log(`mano por jugador   ${options.handSize ?? BOARD_HAND_SIZE}`);
    console.log(`partidas           ${options.runs}`);
    console.log(`semilla base       ${options.baseSeed}`);
  }

  let finished = 0;
  let draws = 0;
  let wins0 = 0;
  let wins1 = 0;
  let placements = 0;
  let flips = 0;
  let chained = 0;
  let maxDepth = 0;
  let truncations = 0;
  let determinismFailures = 0;
  let replayFailures = 0;
  let mutationThrows = 0;

  for (let run = 0; run < options.runs; run++) {
    const seed = (options.baseSeed + run * 2654435761) >>> 0;

    const a = playRandomGame(defs, seed, options.quiet, options.handSize);
    const b = playRandomGame(defs, seed, options.quiet, options.handSize);

    // --- 2. Determinismo: misma semilla, misma partida ---
    if (fingerprint(a.final) !== fingerprint(b.final)) determinismFailures += 1;
    if (JSON.stringify(a.commands) !== JSON.stringify(b.commands)) determinismFailures += 1;

    // --- 2b. Replay: el log reconstruye el estado final ---
    const replayed = replay(defs, seed, a.commands, options.handSize);
    if (fingerprint(replayed) !== fingerprint(a.final)) replayFailures += 1;

    // --- 3. Terminacion ---
    if (a.final.status === 'finished') finished += 1;
    if (a.truncated > 0 || b.truncated > 0) truncations += 1;

    if (a.final.winner === null) draws += 1;
    else if (a.final.winner === 0) wins0 += 1;
    else wins1 += 1;

    placements += a.placements;
    flips += a.flips;
    chained += a.chained;
    mutationThrows += a.mutationThrows + b.mutationThrows;
    maxDepth = Math.max(maxDepth, a.maxDepth, b.maxDepth);
  }

  // --- 1. No mutacion: ni el estado congelado ni el contenido cambiaron ---
  const contentChanged = JSON.stringify(defs) !== defsSnapshot;
  const unterminated = options.runs - finished;

  const pct = (n: number): string => `${((n / options.runs) * 100).toFixed(1)}%`;

  console.log('\n── Resultado ──────────────────────────────');
  console.log(`terminadas         ${finished} / ${options.runs}`);
  console.log(`empates            ${draws} (${pct(draws)})`);
  console.log(`gana el jugador 0  ${wins0} (${pct(wins0)})`);
  console.log(`gana el jugador 1  ${wins1} (${pct(wins1)})`);
  console.log(`colocaciones       ${(placements / options.runs).toFixed(2)} por partida`);
  console.log(`volteos            ${(flips / options.runs).toFixed(2)} por partida`);
  console.log(`ataques en cadena  ${(chained / options.runs).toFixed(2)} por partida`);
  console.log(`profundidad max    ${maxDepth}`);

  console.log('\n── Invariantes ────────────────────────────');
  console.log(`${unterminated === 0 ? '✓' : '✗'} todas las partidas terminan (${unterminated} sin terminar)`);
  console.log(`${truncations === 0 ? '✓' : '✗'} la red de profundidad nunca se activo (${truncations})`);
  console.log(`${determinismFailures === 0 ? '✓' : '✗'} misma semilla = misma partida (${determinismFailures} fallas)`);
  console.log(`${replayFailures === 0 ? '✓' : '✗'} el log de comandos reconstruye el estado final (${replayFailures} fallas)`);
  console.log(`${mutationThrows === 0 ? '✓' : '✗'} el estado congelado nunca se muto (${mutationThrows} fallas)`);
  console.log(`${!contentChanged ? '✓' : '✗'} el contenido de tablero no se muto`);

  // Colocar segundo vale un ataque extra (el primero pone una carta sin tener a
  // quien atacar). Con el inicio FIJO la simulacion midio 25% / 63%; sorteando
  // quien arranca, cada jugador es segundo la mitad de las veces y el reparto
  // tiene que volver cerca del 50%. La banda es ancha a proposito: esto detecta
  // que el sorteo se rompio, no mide balance fino.
  const decided = wins0 + wins1;
  const share0 = decided > 0 ? wins0 / decided : 0.5;
  const fairShare = share0 >= 0.45 && share0 <= 0.55;
  console.log(
    `${fairShare ? '✓' : '✗'} entre las decididas, el inicio sorteado reparte 50/50 ` +
      `(${(share0 * 100).toFixed(1)}% / ${((1 - share0) * 100).toFixed(1)}% de ${decided})`,
  );

  const ok =
    unterminated === 0 &&
    truncations === 0 &&
    determinismFailures === 0 &&
    replayFailures === 0 &&
    mutationThrows === 0 &&
    !contentChanged &&
    fairShare;

  console.log(ok ? '\n✓ DUELO ESTABLE' : '\n✗ DUELO INESTABLE');
  if (!ok) process.exit(1);
}

main();
