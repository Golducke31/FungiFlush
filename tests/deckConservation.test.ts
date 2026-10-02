/**
 * deckConservation.test.ts — El mazo NO pierde cartas al cerrar un Ciego.
 *
 * Contexto: el plan de claridad (P0.5 / P0.6) pedia auditar la transicion
 * "jugar el Ciego -> puntuar -> recompensa -> tienda -> siguiente Ciego" y
 * garantizar que una carta solo desaparezca por una regla EXPLICITA.
 *
 * La auditoria encontro dos fugas reales, las dos silenciosas:
 *
 *   1. CONSERVACION. Al ganar (o perder) el ciego, las cartas que sobraban en
 *      `round.hand` no volvian al mazo. `chooseBlind()` reemplaza el RoundState
 *      entero, asi que esas cartas quedaban huerfanas: ni en la mano, ni en el
 *      mazo. En una mano de 8 con 5 jugadas, el mazo encogia 3 cartas por ciego.
 *
 *   2. DUPLICACION POR DESTRUCCION. Una carta con `DESTROY_SELF` se sacaba del
 *      mazo (`deck.remove()` en `applyDeltas`) y despues `playHand()` la volvia
 *      a mandar al descarte. Resultado: el mazo terminaba con MAS copias que al
 *      principio (1 en el mazo -> 1 destruida + 1 en el descarte -> 2). No era
 *      una fuga sino un exploit.
 *
 * Lo que se protege aca:
 *   - la cantidad total de cartas del mazo es invariante a traves de un ciego,
 *   - ninguna carta queda en `round.hand` al salir del ciego (huerfana),
 *   - los uids se conservan: se comparan los conjuntos, no solo el tamano,
 *   - una carta destruida por su propia habilidad NO vuelve al mazo,
 *   - una carta comprada en la tienda sobrevive al siguiente ciego.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import type { CardDefinition, ContentBundle } from '../src/engine/index.ts';

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 10,
    baseSpores: 2,
    cost: 3,
    art: { hue: 100, pattern: 'radial' },
    tags: ['starter'],
    copies: 10,
    ...overrides,
  };
}

/** El bundle minimo: un mazo grande, varios ciegos y un objetivo bajito. */
function bundle(extra: CardDefinition[] = []): ContentBundle {
  return {
    cards: [card('alpha'), card('beta'), ...extra],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
      { id: 'b2', nameKey: 'blind.b2.name', descKey: 'blind.b2.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
      { id: 'b3', nameKey: 'blind.b3.name', descKey: 'blind.b3.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 100 },
  };
}

/** Acceso a la pila real: `deck.allCards` es la vista de solo lectura publica. */
function deckOf(engine: GameEngine): {
  allCards: ReadonlyArray<{ uid: string; def: { id: string } }>;
  totalSize: number;
  remaining: number;
} {
  return (engine as unknown as { run: { deck: never } }).run.deck;
}

function deckUids(engine: GameEngine): Set<string> {
  return new Set(deckOf(engine).allCards.map((c) => c.uid));
}

/** Juega la cantidad pedida de cartas de la mano actual. */
function playTopOfHand(engine: GameEngine, count: number): void {
  const hand = engine.roundSnapshot().hand;
  const picked = hand.slice(0, count).map((c) => c.uid);
  for (const uid of picked) engine.toggleSelect(uid);
  engine.playHand();
}

test('el mazo conserva TODAS sus cartas al ganar un ciego', () => {
  const engine = new GameEngine({ seed: 7, bundle: bundle() });
  engine.startRun(7);

  const before = deckUids(engine);
  assert.ok(before.size > 10, 'el mazo inicial deberia tener cartas');

  engine.chooseBlind('b1');
  // El ciego se gana con la primera mano (objetivo 100, cartas de 10+ sustrato).
  playTopOfHand(engine, 5);

  assert.notEqual(engine.runSnapshot().status, 'playing', 'el ciego deberia cerrarse');

  const after = deckUids(engine);
  assert.equal(after.size, before.size, `el mazo perdio ${before.size - after.size} cartas al cerrar el ciego`);

  const missing = [...before].filter((uid) => !after.has(uid));
  assert.deepEqual(missing, [], 'ningun uid del mazo deberia desaparecer');

  // Y no quedan huerfanas en la mano.
  assert.equal(engine.roundSnapshot().hand.length, 0, 'la mano deberia volver al mazo');
});

test('el mazo conserva sus cartas tambien al PERDER un ciego', () => {
  // Cartas deliberadamente debiles y objetivo alto: 3 manos de UNA carta no
  // alcanzan los 1000 puntos, asi que la ronda termina en derrota.
  const weak = card('weak', { baseSubstrate: 0, baseSpores: 1, copies: 12 });
  const impossible: ContentBundle = {
    cards: [weak],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 1000 },
  };

  const engine = new GameEngine({ seed: 11, bundle: impossible });
  engine.startRun(11);

  const before = deckUids(engine);
  engine.chooseBlind('b1');

  let guard = 0;
  while (engine.runSnapshot().status === 'playing' && guard++ < 10) {
    playTopOfHand(engine, 1);
  }

  assert.equal(engine.runSnapshot().status, 'game_over', 'se deberia quedar sin manos');
  const after = deckUids(engine);
  assert.equal(after.size, before.size, 'perder no debe destruir cartas');
  assert.deepEqual([...before].filter((uid) => !after.has(uid)), []);
});

test('una carta destruida por su habilidad NO vuelve al mazo (ni se duplica)', () => {
  const doomed = card('doomed', {
    copies: 1,
    // Debe llevar el tag `starter`: el mazo inicial se arma con las cartas que
    // lo llevan (`CardRegistry.buildStarterDeck`). Sin el, la carta no entra.
    tags: ['starter'],
    effects: [
      {
        id: 'doomed_self',
        trigger: 'ON_PLAY',
        actions: [{ type: 'DESTROY_SELF' }],
      },
    ],
  });

  // El mazo es SOLO la carta maldita: asi esta garantizado que aparece en la
  // primera mano, sin depender del orden del shuffle. El objetivo es
  // inalcanzable para que la ronda no se cierre sola antes de jugarla.
  const onlyDoomed: ContentBundle = {
    cards: [doomed],
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 1_000_000 },
  };

  const engine = new GameEngine({ seed: 5, bundle: onlyDoomed });
  engine.startRun(5);

  const doomedCount = () => deckOf(engine).allCards.filter((c) => c.def.id === 'doomed').length;
  assert.equal(doomedCount(), 1, 'arranca con una copia');

  engine.chooseBlind('b1');

  // La unica carta del mazo esta en la mano: se juega y se destruye. El mazo
  // debe quedar VACIO, no con una copia resucitada.
  const hand = engine.roundSnapshot().hand;
  const victim = hand.find((c) => c.def.id === 'doomed');
  assert.ok(victim, 'la carta maldita deberia estar en la mano inicial');
  engine.toggleSelect(victim.uid);
  engine.playHand();

  assert.equal(doomedCount(), 0, 'la carta destruida no puede resucitar en el descarte');
  const runStats = (engine as unknown as { run: { stats: { cardsDestroyed: number } } }).run.stats;
  assert.equal(runStats.cardsDestroyed, 1, 'se registro exactamente una destruccion');
  assert.equal(deckUids(engine).size, 0, 'el mazo queda vacio: la carta se destruyo, no se duplico');
});

test('una carta comprada en la tienda sobrevive al siguiente ciego', () => {
  const engine = new GameEngine({ seed: 3, bundle: bundle() });
  engine.startRun(3);

  engine.chooseBlind('b1');
  playTopOfHand(engine, 5);

  // El estado tras ganar puede ser 'reward' (draft) o directamente 'shop'.
  if (engine.runSnapshot().status === 'reward') {
    engine.chooseReward(null); // se saltea el draft
  }
  assert.equal(engine.runSnapshot().status, 'shop', 'deberia estar en la tienda');

  const cardOffer = engine.run?.shop?.offers.find((o) => o.kind === 'card');
  if (!cardOffer) return; // el sorteo puede no ofrecer carta: nada que comprobar

  const before = deckUids(engine);
  const bought = engine.buyOffer(cardOffer.id);
  if (!bought) return; // sin plata: tampoco hay nada que comprobar

  const afterBuy = deckUids(engine);
  assert.equal(afterBuy.size, before.size + 1, 'la compra suma una carta al mazo');

  const boughtUids = [...afterBuy].filter((uid) => !before.has(uid));
  assert.equal(boughtUids.length, 1);

  // Se avanza al siguiente ciego y se gana de nuevo.
  engine.leaveShop();
  engine.chooseBlind('b2');
  playTopOfHand(engine, 5);

  const final = deckUids(engine);
  for (const uid of boughtUids) {
    assert.ok(final.has(uid), 'la carta comprada desaparecio al cerrar el siguiente ciego');
  }
});

// ---------------------------------------------------------------------------
// Chip MAZO: los DOS numeros que ve el jugador
// ---------------------------------------------------------------------------

test('el chip MAZO separa "por robar" del TOTAL y el total incluye la mano', () => {
  const engine = new GameEngine({ seed: 5, bundle: bundle() });
  engine.startRun(5);

  // Fuera de la ronda (seleccion de ciego) no hay mano: el total es el mazo
  // entero y no queda nada por robar de una ronda anterior.
  const atSelect = engine.deckSize;
  assert.ok(atSelect > 10, 'el mazo inicial deberia tener cartas');
  assert.equal(engine.deckDraw, deckOf(engine).totalSize, 'sin ronda, todo el mazo esta disponible');

  engine.chooseBlind('b1');
  const hand = engine.roundSnapshot().hand.length;
  assert.ok(hand > 0, 'el ciego reparte una mano');

  // EL BUG REPORTADO: `totalSize` cae a (mazo - mano) al repartir, pero el
  // numero que el jugador llama "mi mazo" NO se mueve. `deckSize` lo cubre.
  assert.equal(engine.deckSize, atSelect, 'el total no cambia al repartir: las cartas siguen siendo del mazo');
  // Al repartir todavia no se consumio nada: el disponible sigue siendo el mazo.
  assert.equal(engine.deckDraw, atSelect, 'nada se consumio todavia: disponible = mazo entero');

  // Y al jugar una mano, el disponible BAJA. La clave es que la pila de robo se
  // rellena sola, asi que `deck.remaining` no lo refleja; lo que baja es lo que
  // la ronda consumio.
  const beforeDraw = engine.deckDraw;
  playTopOfHand(engine, 5);
  assert.ok(engine.deckDraw < beforeDraw, 'jugar cartas debe descontar del mazo disponible');
  assert.equal(engine.deckSize, atSelect, 'el total del mazo sigue intacto durante la mano');
});

test('el snapshot publico (`runSnapshot().deckSize`) coincide con el total real', () => {
  const engine = new GameEngine({ seed: 5, bundle: bundle() });
  engine.startRun(5);
  engine.chooseBlind('b1');

  // Antes el snapshot traia `deck.totalSize`, que durante la mano daba MENOS
  // que el mazo: logros y debug median un mazo encogido.
  assert.equal(engine.runSnapshot().deckSize, engine.deckSize);
  assert.equal(
    engine.runSnapshot().deckSize,
    deckOf(engine).totalSize + engine.roundSnapshot().hand.length,
    'el total del snapshot = pilas + mano',
  );
});
