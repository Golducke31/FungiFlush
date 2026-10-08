/**
 * decayHarvest.test.ts — La COSECHADORA de putrefaccion cosecha TUS cartas.
 *
 * El bug (reportado como "verificar que la cosechadora cumpla su funcion"):
 * `decay_carrion_bloom` ("Flor de Carroña") promete
 *
 *   "Cosecha toda la podredumbre de tus cartas: cada pila pudrida da +4 Esporas."
 *
 * pero sus dos mitades apuntaban a SI MISMA:
 *   1. la condicion era `has_status`, que solo mira la carta que lleva el
 *      efecto (`conditions.ts`), asi que exigia que la cosechadora estuviera
 *      podrida para activarse;
 *   2. `CONSUME_STATUS` sin `target` cae en `'self'` (`TriggerEngine.resolveTargets`),
 *      asi que consumia SU PROPIA podredumbre.
 *
 * Resultado medido con el diagnostico: con la podredumbre en otra carta de la
 * mano la carta no hacia NADA (0 esporas, el estado quedaba puesto). Solo
 * funcionaba si la propia cosechadora estaba podrida, que no es lo que dice su
 * texto.
 *
 * El arreglo agrega las dos piezas que faltaban en el motor:
 *   - condicion `status_in_hand`  -> "al menos UNA carta de esta mano tiene X";
 *   - target    `all_cards`       -> barre jugadas + retenidas; como
 *     `CONSUME_STATUS` es no-op en las cartas sin el estado, el resultado es
 *     "una pila pudrida = un pago".
 *
 * Las hermanas del mismo arquetipo (`decay_boletus_slime`, `deep_carrion_lattice`)
 * tenian SOLO el bug de la condicion: pudren a OTRA carta y despues miraban su
 * propio estado. Se arreglan en el contenido y se fijan aca.
 *
 * ⚠️ `has_status` NO se toco: es la condicion correcta para las cartas que
 * hablan de SI MISMAS (`deep_latent_sporocarp` se cubre de Sobrecrecimiento y
 * despues lo revienta). Ese camino se protege con su propio test.
 *
 * NOTA sobre el arnes: cada carta "protagonista" entra al mazo con UNA sola
 * copia. Con varias copias, `ON_HAND_SCORED` es global y dispara el efecto de
 * TODAS las copias que esten en la mano (jugadas o retenidas), asi que medir
 * "lo que hizo esta carta" por uid daria un falso negativo. Ver
 * `startedWith`.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';
import type { CardDefinition, CardInstance, ContentBundle } from '../src/engine/index.ts';

// ---------------------------------------------------------------------------
// Contenido REAL (pinea el JSON, no un fixture paralelo)
// ---------------------------------------------------------------------------

const REAL = buildRegistry().toBundle();

function realCard(id: string): CardDefinition {
  const def = REAL.cards.find((c) => c.id === id);
  assert.ok(def, `el pack tiene que traer "${id}"`);
  return def;
}

const HARVESTER = 'decay_carrion_bloom';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 10,
    baseSpores: 1,
    cost: 3,
    art: { hue: 100, pattern: 'radial' },
    tags: ['starter'],
    copies: 1,
    ...overrides,
  };
}

function bundleWith(cards: CardDefinition[]): ContentBundle {
  return {
    cards,
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 1000 },
  };
}

/**
 * Arranca una run con UN ejemplar de cada carta protagonista y relleno de sobra,
 * buscando la semilla que reparte todas las protagonistas en la mano.
 *
 * Una sola copia es a proposito: el efecto cuelga de `ON_HAND_SCORED`, que es un
 * evento GLOBAL, asi que dispara desde toda copia presente en la mano (jugada o
 * retenida). Con dos copias, "las esporas que dio esta carta" se repartiria
 * entre dos uids y la asercion seria fragil por un motivo que no es el bug.
 */
function startedWith(uniques: CardDefinition[]): GameEngine {
  const filler = card('filler');
  const defs = [...uniques, filler];
  const loadout = [
    ...uniques.map((d) => ({ cardId: d.id, copies: 1 })),
    // Relleno suficiente para que la mano tenga 6 cartas, pero poco: cuanto mas
    // corto el mazo, mas probable que las protagonistas entren en la mano.
    { cardId: filler.id, copies: 8 },
  ];

  for (let seed = 1; seed <= 2000; seed += 1) {
    const engine = new GameEngine({ seed, bundle: bundleWith(defs) });
    engine.setArchetypeLoadout(loadout, []);
    engine.startRun(seed);
    engine.chooseBlind('b1');
    const hand = engine.roundSnapshot().hand;
    if (uniques.every((d) => hand.some((c) => c.def.id === d.id))) return engine;
  }
  throw new Error('ninguna semilla repartio las cartas protagonistas');
}

function inHand(engine: GameEngine, id: string): CardInstance {
  const found = engine.roundSnapshot().hand.find((c) => c.def.id === id);
  assert.ok(found, `"${id}" tiene que estar en la mano`);
  return found;
}

/**
 * Pone `n` pilas de putrefaccion en la carta.
 *
 * Se muta la instancia de la MANO, que es la que la resolucion ve: `round.hand`
 * guarda las mismas referencias que `roundSnapshot().hand`, mientras que
 * `deck.allCards` es SOLO `[...drawPile, ...discardPile]` y por definicion no
 * incluye la mano.
 */
function rot(target: CardInstance, n: number): void {
  target.statuses = [{ type: 'decay', value: n, turnsLeft: 3 }];
}

function play(engine: GameEngine, cards: CardInstance[]): ReturnType<GameEngine['playHand']> {
  for (const c of cards) engine.toggleSelect(c.uid);
  return engine.playHand();
}

type Res = ReturnType<GameEngine['playHand']>;

/** Esporas que aportaron los efectos de una carta (los pasos de ADD_SPORES). */
function effectSpores(res: Res, uid: string): number {
  return (res?.steps ?? [])
    .filter((s) => s.sourceId === uid && s.action === 'ADD_SPORES')
    .reduce((acc, s) => acc + (s.value ?? 0), 0);
}

/**
 * Hay un paso de Sustrato con ESE valor aportado por esa carta?
 *
 * Se busca el valor exacto del efecto en vez de sumar: asi la asercion no se
 * contamina con el paso BASE (`addCardBaseValues`) ni con la penalizacion de
 * putrefaccion, que tambien entran como `ADD_SUBSTRATE` con el mismo sourceId.
 */
function hasSubstrateStep(res: Res, uid: string, value: number): boolean {
  return (res?.steps ?? []).some(
    (s) => s.sourceId === uid && s.action === 'ADD_SUBSTRATE' && s.value === value,
  );
}

const decayLeft = (c: CardInstance): number =>
  c.statuses.filter((s) => s.type === 'decay').reduce((acc, s) => acc + s.value, 0);

const consumedFor = (res: Res, uid: string): number =>
  (res?.statusEvents ?? []).filter((e) => e.kind === 'consumed' && e.uid === uid).length;

// ---------------------------------------------------------------------------
// El caso reportado
// ---------------------------------------------------------------------------

test('la cosechadora cosecha la podredumbre de OTRA carta de la mano', () => {
  // EL test de la regresion. Antes: 0 esporas y la podredumbre quedaba puesta.
  const engine = startedWith([realCard(HARVESTER), card('victim')]);
  const harvester = inHand(engine, HARVESTER);
  const victim = inHand(engine, 'victim');
  rot(victim, 3);

  const res = play(engine, [harvester, victim]);

  assert.equal(
    effectSpores(res, harvester.uid),
    12,
    '3 pilas de putrefaccion x +4 Esporas = +12 (cada pila pudrida paga)',
  );
  assert.equal(decayLeft(victim), 0, 'la podredumbre cosechada se limpia de la carta');
  assert.equal(consumedFor(res, victim.uid), 1, 'y se reporta un unico consumo');
  assert.equal(decayLeft(harvester), 0, 'la cosechadora no queda con estado');
});

test('la cosechadora NO dispara si no hay podredumbre en la mano', () => {
  const engine = startedWith([realCard(HARVESTER), card('clean')]);
  const harvester = inHand(engine, HARVESTER);
  const clean = inHand(engine, 'clean');

  const res = play(engine, [harvester, clean]);

  assert.equal(effectSpores(res, harvester.uid), 0, 'sin podredumbre no hay cosecha');
  assert.equal(
    (res?.statusEvents ?? []).filter((e) => e.kind === 'consumed').length,
    0,
    'y no se consume nada',
  );
});

test('la podredumbre FUERA de la mano no activa la cosecha', () => {
  // `status_in_hand` mira las cartas de ESTA mano (jugadas + retenidas), no el
  // mazo: una carta podrida que todavia no se robo no es "tus cartas" en juego.
  const engine = startedWith([realCard(HARVESTER), card('victim')]);
  const harvester = inHand(engine, HARVESTER);
  const victim = inHand(engine, 'victim');
  const handUids = new Set(engine.roundSnapshot().hand.map((c) => c.uid));

  const outside = engine.run.deck.allCards.find((c) => !handUids.has(c.uid));
  assert.ok(outside, 'el mazo tiene cartas fuera de la mano');
  rot(outside, 5);

  const res = play(engine, [harvester, victim]);

  assert.equal(effectSpores(res, harvester.uid), 0, 'la podredumbre fuera de la mano no paga');
  assert.equal(decayLeft(outside), 5, 'y no se toca');
});

test('la cosechadora barre TODAS las cartas podridas: una paga por cada una', () => {
  // "Cosecha toda la podredumbre de tus cartas" — no la primera que encuentra.
  const engine = startedWith([realCard(HARVESTER), card('rot_a'), card('rot_b')]);
  const harvester = inHand(engine, HARVESTER);
  const a = inHand(engine, 'rot_a');
  const b = inHand(engine, 'rot_b');
  rot(a, 2);
  rot(b, 3);

  const res = play(engine, [harvester, a, b]);

  assert.equal(effectSpores(res, harvester.uid), 20, '2+3 pilas x 4 esporas = 20');
  assert.equal(decayLeft(a), 0, 'la carta A quedo limpia');
  assert.equal(decayLeft(b), 0, 'la carta B quedo limpia');
});

// ---------------------------------------------------------------------------
// Las hermanas del arquetipo (bug de condicion, sin barrido)
// ---------------------------------------------------------------------------

test('Baba de Boleto cobra si la MANO tiene una carta podrida (no ella misma)', () => {
  const engine = startedWith([realCard('decay_boletus_slime'), card('victim')]);
  const slime = inHand(engine, 'decay_boletus_slime');
  const victim = inHand(engine, 'victim');
  rot(victim, 1);

  const res = play(engine, [slime, victim]);

  assert.ok(
    hasSubstrateStep(res, slime.uid, 6),
    'la Baba cobra +6 aunque la podredumbre este en otra carta',
  );
  assert.equal(decayLeft(victim), 1, 'y NO consume la podredumbre: solo la mira');
});

test('Enrejado de Carroña cobra +12 si hay putrefaccion en la mano', () => {
  const engine = startedWith([realCard('deep_carrion_lattice'), card('victim')]);
  const lattice = inHand(engine, 'deep_carrion_lattice');
  const victim = inHand(engine, 'victim');
  rot(victim, 2);

  const res = play(engine, [lattice, victim]);

  assert.ok(
    hasSubstrateStep(res, lattice.uid, 12),
    'cobra el +12 con la podredumbre en otra carta',
  );
  assert.equal(decayLeft(victim), 2, 'y no la consume');
});

test('Ceniza de Clavaria consume 1 punto de CADA carta podrida (3 Esporas cada una)', () => {
  // Decision de contenido: el texto prometia "Consume 3 puntos de Pudriéndose"
  // pero los datos consumian 1 pila y pagaban 3 (y encima exigian que la propia
  // Ceniza estuviera podrida). Se resolvio como cosecha PARCIAL por carta: es
  // la version debil de la rara (`decay_carrion_bloom`, que toma TODAS las
  // pilas a +4): esta toma 1 pila de cada carta podrida a +3.
  const engine = startedWith([realCard('decay_clavaria_ash'), card('rot_a'), card('rot_b')]);
  const ash = inHand(engine, 'decay_clavaria_ash');
  const a = inHand(engine, 'rot_a');
  const b = inHand(engine, 'rot_b');
  rot(a, 2);
  rot(b, 3);

  const res = play(engine, [ash, a, b]);

  assert.equal(
    effectSpores(res, ash.uid),
    6,
    '2 cartas podridas x +3 Esporas = +6 (una paga por cada carta podrida)',
  );
  assert.equal(decayLeft(a), 1, 'a la carta A le queda 1 pila de las 2');
  assert.equal(decayLeft(b), 2, 'a la carta B le quedan 2 pilas de las 3');
});

// ---------------------------------------------------------------------------
// Guardas: `has_status` sigue siendo "self"
// ---------------------------------------------------------------------------
test('has_status sigue siendo "self": la carta podrida ELLA MISMA si dispara', () => {
  // Contracara del test anterior. El estado se pone ANTES de jugar a proposito:
  // `APPLY_STATUS` difiere la mutacion al final de la resolucion
  // (`statusRequests` -> `applyDeltas`), asi que una carta que se auto-aplica un
  // estado NO lo ve dentro de la MISMA mano. Ese es un bug aparte (afecta al
  // Esporocarpo Latente) y no se mezcla con lo que este test fija: la semantica
  // de `has_status` = "el estado esta en la carta que lleva el efecto".
  const selfish = card('selfish', {
    effects: [
      {
        id: 'selfish_reap',
        trigger: 'ON_HAND_SCORED',
        conditions: [{ type: 'has_status', status: 'decay' }],
        actions: [{ type: 'ADD_SUBSTRATE', value: 7 }],
      },
    ],
  });
  const engine = startedWith([selfish, card('clean')]);
  const selfishCard = inHand(engine, 'selfish');
  const clean = inHand(engine, 'clean');
  rot(selfishCard, 1);

  const res = play(engine, [selfishCard, clean]);

  assert.ok(
    hasSubstrateStep(res, selfishCard.uid, 7),
    'con la podredumbre en si misma, el efecto SI dispara',
  );
});

test('has_status sigue exigiendo el estado en la PROPIA carta', () => {
  // Contracara del test anterior: una carta con `has_status` NO se activa por la
  // podredumbre de un vecino. Es la garantia de que el arreglo no convirtio
  // todas las condiciones en globales.
  const selfish = card('selfish', {
    effects: [
      {
        id: 'selfish_reap',
        trigger: 'ON_HAND_SCORED',
        conditions: [{ type: 'has_status', status: 'decay' }],
        actions: [{ type: 'ADD_SUBSTRATE', value: 7 }],
      },
    ],
  });
  const engine = startedWith([selfish, card('victim')]);
  const selfishCard = inHand(engine, 'selfish');
  const victim = inHand(engine, 'victim');
  rot(victim, 2);

  const res = play(engine, [selfishCard, victim]);

  assert.ok(
    !hasSubstrateStep(res, selfishCard.uid, 7),
    'la podredumbre del vecino NO activa una condicion `has_status`',
  );
});

// ---------------------------------------------------------------------------
// Guarda de CONTENIDO: el JSON tiene que seguir usando las piezas nuevas
// ---------------------------------------------------------------------------

test('el pack declara las condiciones/targets que hacen funcionar el arquetipo', () => {
  const byEffect = new Map<string, { conditions?: unknown; target?: unknown }>();
  for (const def of REAL.cards) {
    for (const effect of def.effects ?? []) {
      if (effect.id) byEffect.set(effect.id, effect);
    }
  }

  const harvester = byEffect.get('carrion_harvest_all');
  assert.deepEqual(
    harvester?.conditions,
    [{ type: 'status_in_hand', status: 'decay' }],
    'la cosechadora tiene que mirar la MANO, no su propio estado',
  );
  assert.equal(harvester?.target, 'all_cards', 'y tiene que BARRER todas las cartas');

  // La Ceniza de Clavaria es la version PARCIAL: barre, pero consume 1 pila por
  // carta (`stacks: 1`) y paga 3 Esporas por cada una.
  const ash = byEffect.get('clavaria_ash_harvest') as
    | { conditions?: unknown; target?: unknown; actions?: Array<Record<string, unknown>> }
    | undefined;
  assert.deepEqual(
    ash?.conditions,
    [{ type: 'status_in_hand', status: 'decay' }],
    'la Ceniza tiene que mirar la MANO, no su propio estado',
  );
  assert.equal(ash?.target, 'all_cards', 'y tiene que barrer todas las cartas');
  assert.deepEqual(
    ash?.actions,
    [{ type: 'CONSUME_STATUS', status: 'decay', gain: 'spores', value: 3, stacks: 1, full: false }],
    'consume 1 pila por carta podrida y paga 3 Esporas por cada una',
  );

  for (const id of ['boletus_slime_seep', 'carrion_lattice_reap']) {
    assert.deepEqual(
      byEffect.get(id)?.conditions,
      [{ type: 'status_in_hand', status: 'decay' }],
      `"${id}" tiene que mirar la mano`,
    );
    assert.equal(
      byEffect.get(id)?.target,
      undefined,
      `"${id}" NO debe barrer: su accion (ADD_SUBSTRATE) dispararia una vez por carta`,
    );
  }
});
