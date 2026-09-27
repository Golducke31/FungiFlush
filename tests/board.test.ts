/**
 * board.test.ts — Reglas del duelo micelial.
 *
 * Lo que se protege aca es lo que se rompe en silencio: que una colocacion NO
 * mute el estado que recibe, que una cadena de volteos termine siempre, que el
 * empate respete la regla declarada y que la mano del rival no se filtre a la
 * vista. La animacion y el tablero 3D no se prueban aca: eso es el smoke test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ARROW_DIRS,
  BOARD_HAND_SIZE,
  applyCommand,
  attackOf,
  createBoardState,
  createMatch,
  defenseOf,
  neighborOf,
  otherPlayer,
  passTurn,
  resolvePlacement,
  validatePlacement,
  viewFor,
  winnerOf,
  type ArrowDir,
  type BoardCard,
  type BoardState,
  type BoardCardDef,
  type PlayerIndex,
} from '../src/engine/board/index.ts';
import { validateBoardDefs } from '../src/content/boardValidation.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

// ---------------------------------------------------------------------------
// Utilidades de fixture
// ---------------------------------------------------------------------------

/** Indices: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7. */
function arrows(spec: Partial<Record<ArrowDir, number>>): number[] {
  const out = new Array<number>(ARROW_DIRS.length).fill(0);
  for (const [dir, value] of Object.entries(spec)) {
    out[ARROW_DIRS.indexOf(dir as ArrowDir)] = value ?? 0;
  }
  return out;
}

function card(
  defId: string,
  uid: string,
  owner: PlayerIndex,
  spec: Partial<Record<ArrowDir, number>>,
  options?: { power?: number; defense?: number; faceUp?: boolean },
): BoardCard {
  return {
    uid,
    defId,
    owner,
    faceUp: options?.faceUp ?? true,
    arrows: arrows(spec),
    power: options?.power ?? 0,
    defense: options?.defense ?? 0,
  };
}

/** Tablero con cartas ya puestas y una mano para el jugador 0. */
function fixture(
  placed: Array<[number, BoardCard]>,
  hand: BoardCard[] = [],
  options?: { tieRule?: BoardState['tieRule']; currentPlayer?: PlayerIndex },
): BoardState {
  const state = createBoardState({ hands: [hand, []], seed: 7 });
  for (const [index, value] of placed) state.cells[index] = value;
  if (options?.tieRule) state.tieRule = options.tieRule;
  if (options?.currentPlayer !== undefined) state.currentPlayer = options.currentPlayer;
  return state;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const HAND_CARD = card('atacante', 'h0', 0, { E: 5, S: 5, N: 5, W: 5, NE: 5, SE: 5, SW: 5, NW: 5 });

// ---------------------------------------------------------------------------
// Aritmetica de flechas
// ---------------------------------------------------------------------------

test('la flecha opuesta de E es W y viceversa', () => {
  const east = ARROW_DIRS.indexOf('E');
  const west = ARROW_DIRS.indexOf('W');
  assert.equal((east + 4) % 8, west);
  assert.equal((west + 4) % 8, east);
});

test('attackOf suma power y defenseOf usa la flecha que da la cara', () => {
  const attacker = card('a', 'a', 0, { E: 3 }, { power: 2 });
  assert.equal(attackOf(attacker, ARROW_DIRS.indexOf('E')), 5);

  const defender = card('d', 'd', 1, { W: 4 }, { defense: 1 });
  // El ataque llega por el E del atacante, o sea desde el W del defensor.
  assert.equal(defenseOf(defender, ARROW_DIRS.indexOf('E')), 5);
});

test('una carta boca abajo no aporta defensa', () => {
  const defender = card('d', 'd', 1, { W: 9 }, { defense: 9, faceUp: false });
  assert.equal(defenseOf(defender, ARROW_DIRS.indexOf('E')), 0);
});

test('las esquinas del tablero no tienen vecinos fuera del tablero', () => {
  // Celda 0 = fila 0, columna 0: N y W se salen.
  assert.equal(neighborOf(0, ARROW_DIRS.indexOf('N')), -1);
  assert.equal(neighborOf(0, ARROW_DIRS.indexOf('W')), -1);
  assert.equal(neighborOf(0, ARROW_DIRS.indexOf('E')), 1);
  assert.equal(neighborOf(0, ARROW_DIRS.indexOf('S')), 4);
  // Celda 15 = fila 3, columna 3: E y S se salen.
  assert.equal(neighborOf(15, ARROW_DIRS.indexOf('E')), -1);
  assert.equal(neighborOf(15, ARROW_DIRS.indexOf('S')), -1);
  assert.equal(neighborOf(15, ARROW_DIRS.indexOf('NW')), 10);
});

// ---------------------------------------------------------------------------
// Combate
// ---------------------------------------------------------------------------

test('un ataque mas fuerte voltea la carta y le cambia el dueño', () => {
  const state = fixture([[1, card('def', 'd1', 1, { W: 2 })]], [HAND_CARD]);
  const { state: next, steps } = resolvePlacement(state, 0, 'h0');

  assert.equal(next.cells[1]?.owner, 0, 'la carta atacada pasa al jugador 0');
  const flip = steps.find((s) => s.kind === 'flip');
  assert.ok(flip, 'deberia haber un paso de volteo');
  assert.equal(flip.attack, 5);
  assert.equal(flip.defense, 2);
  assert.equal(steps[0]?.kind, 'place');
});

test('un ataque mas debil no hace nada', () => {
  const state = fixture([[1, card('def', 'd1', 1, { W: 8 })]], [HAND_CARD]);
  const { state: next, steps } = resolvePlacement(state, 0, 'h0');

  assert.equal(next.cells[1]?.owner, 1);
  assert.equal(steps.filter((s) => s.kind === 'flip').length, 0);
  assert.ok(steps.some((s) => s.kind === 'hold'));
});

test('el empate sigue la regla declarada', () => {
  const build = (tieRule: BoardState['tieRule']): BoardState =>
    fixture([[1, card('def', 'd1', 1, { W: 5 })]], [HAND_CARD], { tieRule });

  const holds = resolvePlacement(build('defender_holds'), 0, 'h0');
  assert.equal(holds.state.cells[1]?.owner, 1);
  assert.ok(holds.steps.some((s) => s.kind === 'tie'));

  const wins = resolvePlacement(build('attacker_wins'), 0, 'h0');
  assert.equal(wins.state.cells[1]?.owner, 0);
});

test('la regla rng es determinista para la misma semilla', () => {
  const build = (): BoardState => {
    const state = fixture([[1, card('def', 'd1', 1, { W: 5 })]], [HAND_CARD], { tieRule: 'rng' });
    state.rng = 12345;
    return state;
  };
  const a = resolvePlacement(build(), 0, 'h0');
  const b = resolvePlacement(build(), 0, 'h0');

  assert.equal(a.state.cells[1]?.owner, b.state.cells[1]?.owner);
  assert.notEqual(a.state.rng, 12345, 'la tirada tiene que avanzar el RNG');
});

test('una carta boca abajo se revela antes de comparar', () => {
  const state = fixture([[1, card('def', 'd1', 1, { W: 9 }, { faceUp: false })]], [HAND_CARD]);
  const { state: next, steps } = resolvePlacement(state, 0, 'h0');

  const reveal = steps.find((s) => s.kind === 'reveal');
  assert.ok(reveal, 'deberia haber un paso de revelado');
  assert.equal(reveal.defense, 0, 'boca abajo no aporta defensa');
  assert.equal(next.cells[1]?.faceUp, true);
  assert.equal(next.cells[1]?.owner, 0, 'revelar sin defensa = volteo');
});

test('no hay fuego amigo', () => {
  const state = fixture(
    [
      [1, card('ally', 'a1', 0, { W: 1 })],
      [4, card('ally', 'a2', 0, { N: 1 })],
    ],
    [HAND_CARD],
  );
  const { state: next, steps } = resolvePlacement(state, 0, 'h0');

  assert.equal(next.cells[1]?.owner, 0);
  assert.equal(next.cells[4]?.owner, 0);
  assert.equal(steps.length, 1, 'solo el paso de colocacion');
});

test('una carta volteada sigue atacando desde su celda nueva (cadena)', () => {
  // 0 -> voltea 1 -> 1 (ya del jugador 0) voltea 2.
  const state = fixture(
    [
      [1, card('mid', 'm1', 1, { W: 1, E: 4 })],
      [2, card('far', 'f1', 1, { W: 1 })],
    ],
    [HAND_CARD],
  );
  const { state: next, steps } = resolvePlacement(state, 0, 'h0');

  const flips = steps.filter((s) => s.kind === 'flip');
  assert.equal(flips.length, 2, 'la cadena tiene que encadenar dos volteos');
  assert.equal(next.cells[1]?.owner, 0);
  assert.equal(next.cells[2]?.owner, 0);
  assert.equal(flips[1]?.from, 1, 'el segundo ataque sale de la celda volteada');
  assert.equal(flips[1]?.depth, 1);
});

test('ninguna celda se voltea dos veces: la cadena termina siempre', () => {
  // Tablero denso y hostil: el centro con las 8 flechas, enemigos alrededor.
  // La garantia real de terminacion es que cada volteo le suma una celda al
  // jugador activo y se la saca al rival: la propiedad no puede volver atras.
  const state = fixture(
    [
      [1, card('n1', 'n1', 1, { S: 1, N: 4 })],
      [2, card('ne1', 'ne1', 1, { SW: 1, NE: 4 })],
      [4, card('w1', 'w1', 1, { E: 1, W: 4 })],
      [6, card('e1', 'e1', 1, { W: 1, E: 4 })],
      [8, card('sw1', 'sw1', 1, { NE: 1, SW: 4 })],
      [9, card('s1', 's1', 1, { N: 1, S: 4 })],
      [10, card('se1', 'se1', 1, { NW: 1, SE: 4 })],
      [0, card('n2', 'n2', 1, { S: 4 })],
      [3, card('w2', 'w2', 1, { E: 4 })],
      [7, card('e2', 'e2', 1, { W: 4 })],
      [13, card('s2', 's2', 1, { N: 4 })],
    ],
    [HAND_CARD],
  );
  const { steps, truncated } = resolvePlacement(state, 5, 'h0');

  const flipped = steps.filter((s) => s.kind === 'flip').map((s) => s.cell);
  assert.equal(new Set(flipped).size, flipped.length, 'ninguna celda se voltea dos veces');
  assert.equal(truncated, false, 'la red de profundidad no deberia activarse');
  assert.ok(flipped.length <= 16, `no puede haber mas volteos que celdas (${flipped.length})`);
  assert.ok(steps.length < 80, `la resolucion no puede explotar (${steps.length} pasos)`);
});

test('resolver una colocacion NO muta el estado de entrada', () => {
  const state = fixture([[1, card('def', 'd1', 1, { W: 2 })]], [HAND_CARD]);
  const snapshot = JSON.stringify(state);
  deepFreeze(state);

  // Con el estado congelado, cualquier escritura tira en modo estricto.
  const { state: next } = resolvePlacement(state, 0, 'h0');

  assert.equal(JSON.stringify(state), snapshot, 'el estado de entrada no cambio');
  assert.notEqual(next, state, 'se devuelve un estado nuevo');
  assert.equal(next.cells[1]?.owner, 0);
});

test('la misma semilla y los mismos comandos dan la misma partida', () => {
  const defs = buildRegistry().boardDefs();
  const play = (): string => {
    let state = createMatch({ defs, seed: 4242 });
    const log: string[] = [];
    for (let i = 0; i < 10 && state.status === 'placing'; i++) {
      const player = state.currentPlayer;
      const uid = state.hands[player][0]?.uid;
      if (!uid) break;
      const cell = state.cells.findIndex((c) => c === null);
      const result = applyCommand(state, { t: 'place', by: player, cell, uid });
      assert.equal(result.error, null);
      log.push(`${cell}:${uid}:${result.steps.map((s) => s.kind).join(',')}`);
      state = result.state;
    }
    return `${log.join('|')}#${state.winner}`;
  };

  assert.equal(play(), play());
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

test('applyCommand rechaza a quien no tiene el turno', () => {
  const state = fixture([], [HAND_CARD]);
  const result = applyCommand(state, { t: 'place', by: 1, cell: 0, uid: 'h0' });

  assert.ok(result.error);
  assert.equal(result.state, state, 'un comando invalido devuelve el MISMO estado');
  assert.equal(result.steps.length, 0);
});

test('applyCommand rechaza una celda ocupada y un uid ajeno', () => {
  const state = fixture([[0, card('x', 'x', 1, { S: 1 })]], [HAND_CARD]);

  assert.ok(applyCommand(state, { t: 'place', by: 0, cell: 0, uid: 'h0' }).error);
  assert.ok(applyCommand(state, { t: 'place', by: 0, cell: 5, uid: 'no_existe' }).error);
  assert.ok(applyCommand(state, { t: 'place', by: 0, cell: 99, uid: 'h0' }).error);
});

test('rendirse termina la partida a favor del rival', () => {
  const state = fixture([], [HAND_CARD]);
  const result = applyCommand(state, { t: 'concede', by: 0 });

  assert.equal(result.error, null);
  assert.equal(result.state.status, 'finished');
  assert.equal(result.state.winner, 1);
});

test('el turno alterna, el contador avanza y el final decide por celdas', () => {
  const state = createBoardState({
    hands: [
      [card('a', 'p0a', 0, { S: 1 }), card('c', 'p0c', 0, { S: 1 })],
      [card('b', 'p1a', 1, { S: 1 })],
    ],
    seed: 1,
  });

  const first = applyCommand(state, { t: 'place', by: 0, cell: 0, uid: 'p0a' });
  assert.equal(first.state.currentPlayer, 1, 'le toca al otro');
  assert.equal(first.state.turn, 1);

  const second = applyCommand(first.state, { t: 'place', by: 1, cell: 5, uid: 'p1a' });
  assert.equal(second.state.currentPlayer, 0, 'el jugador 1 se quedo sin cartas');

  const third = applyCommand(second.state, { t: 'place', by: 0, cell: 10, uid: 'p0c' });
  assert.equal(third.state.status, 'finished');
  assert.equal(third.state.winner, 0, 'dos celdas contra una');
});

test('passTurn solo lo acepta el jugador activo', () => {
  const state = fixture([], [HAND_CARD]);
  assert.ok(passTurn(state, 1).error);
  assert.equal(passTurn(state, 0).state.currentPlayer, 1);
});

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

test('viewFor entrega la mano propia completa y del rival solo la cantidad', () => {
  const state = createBoardState({
    hands: [
      [card('a', 'p0a', 0, { S: 1 }), card('b', 'p0b', 0, { N: 1 })],
      [card('c', 'p1a', 1, { S: 1 }), card('d', 'p1b', 1, { S: 1 }), card('e', 'p1c', 1, { S: 1 })],
    ],
    seed: 1,
  });
  state.cells[3] = card('board', 'bd', 1, { W: 2 });

  const view = viewFor(state, 0);

  assert.equal(view.hand.length, 2);
  assert.deepEqual(
    view.hand.map((c) => c.uid),
    ['p0a', 'p0b'],
  );
  assert.equal(view.opponentHandSize, 3);
  assert.equal(view.cells[3]?.uid, 'bd', 'las cartas de la mesa se ven siempre');

  // La comprobacion que importa: NINGUNA carta del rival aparece en la vista.
  const serialized = JSON.stringify(view);
  for (const uid of ['p1a', 'p1b', 'p1c']) {
    assert.ok(!serialized.includes(uid), `la mano rival no puede viajar: ${uid}`);
  }
});

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

test('createMatch reparte manos parejas y reproducibles', () => {
  const defs = buildRegistry().boardDefs();
  const a = createMatch({ defs, seed: 99 });
  const b = createMatch({ defs, seed: 99 });

  assert.equal(a.hands[0].length, BOARD_HAND_SIZE);
  assert.equal(a.hands[1].length, BOARD_HAND_SIZE);
  assert.deepEqual(
    a.hands.map((h) => h.map((c) => c.defId)),
    b.hands.map((h) => h.map((c) => c.defId)),
  );

  const uids = [...a.hands[0], ...a.hands[1]].map((c) => c.uid);
  assert.equal(new Set(uids).size, uids.length, 'los uid no pueden repetirse');
});

test('el jugador que arranca se sortea desde la semilla', () => {
  // Colocar segundo vale un ataque extra: si el inicio fuera fijo, uno de los
  // dos tendria una ventaja sistematica. Ver la medicion en boardSim.
  const defs = buildRegistry().boardDefs();
  const starters = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) starters.add(createMatch({ defs, seed }).currentPlayer);

  assert.equal(starters.size, 2, 'con 40 semillas tienen que aparecer los dos inicios');
  assert.equal(createMatch({ defs, seed: 5 }).currentPlayer, createMatch({ defs, seed: 5 }).currentPlayer);
});

test('board.json del pack base cubre todas las cartas y tiene 8 flechas', () => {
  const registry = buildRegistry();
  const defs = registry.boardDefs();
  const cardIds = new Set(registry.poolOf('card').map((c) => c.id));

  assert.ok(defs.length > 0, 'el pack base deberia declarar datos de tablero');
  assert.equal(defs.length, cardIds.size, 'todas las cartas del base juegan en el tablero');

  for (const def of defs) {
    assert.equal(def.arrows.length, 8, `${def.cardId} deberia tener 8 flechas`);
    assert.ok(cardIds.has(def.cardId), `${def.cardId} no existe como carta`);
  }
});

test('validateBoardDefs detecta los errores que romperian un duelo', () => {
  const known = new Set(['ok']);
  const cases: BoardCardDef[] = [
    { cardId: 'fantasma', arrows: new Array(8).fill(1) },
    { cardId: 'ok', arrows: [1, 2, 3] },
    { cardId: 'ok', arrows: new Array(8).fill(12) },
    { cardId: 'ok', arrows: new Array(8).fill(0) },
  ];

  for (const def of cases) {
    const issues = validateBoardDefs([def], known);
    assert.ok(issues.length > 0, `deberia reportar algo para ${JSON.stringify(def)}`);
  }

  const dup = validateBoardDefs(
    [
      { cardId: 'ok', arrows: new Array(8).fill(1) },
      { cardId: 'ok', arrows: new Array(8).fill(1) },
    ],
    known,
  );
  assert.ok(dup.some((i) => i.message.includes('duplicado')));
});

test('validatePlacement explica por que no se puede colocar', () => {
  const state = fixture([[0, card('x', 'x', 1, { S: 1 })]], [HAND_CARD]);
  assert.equal(validatePlacement(state, 5, 'h0'), null);
  assert.ok(validatePlacement(state, 0, 'h0'));
  assert.ok(validatePlacement(state, 5, 'otra'));
  assert.ok(validatePlacement(state, -1, 'h0'));
});

test('winnerOf cuenta celdas y devuelve null en empate', () => {
  const state = fixture([
    [0, card('a', 'a', 0, {})],
    [1, card('b', 'b', 1, {})],
  ]);
  assert.equal(winnerOf(state), null);

  state.cells[2] = card('c', 'c', 0, {});
  assert.equal(winnerOf(state), 0);
  assert.equal(otherPlayer(0), 1);
});
