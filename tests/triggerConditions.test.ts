/**
 * triggerConditions.test.ts — Condiciones sobre la CARTA DISPARADORA y estados
 * PENDIENTES. Los dos agujeros del motor que dejaban 14 piezas de contenido sin
 * cumplir su texto.
 *
 * 1) `element_is` / `family_is` / `rarity_is` se evaluan contra el SUJETO
 *    (`source.card`, la carta que LLEVA el efecto), no contra la carta que
 *    disparo el evento. Por eso las cartas que dicen "cada carta de X jugada"
 *    usaban `element_is` y quedaban SIEMPRE verdaderas (el dueño es de ese
 *    elemento, por definicion) y disparaban con CADA carta jugada. En un
 *    SIMBIONTE es peor: `sourceFromJoker` no expone `card`, asi que el sujeto es
 *    `undefined` y la condicion era SIEMPRE falsa: 5 simbiontes muertos.
 *    -> `trigger_element_is` / `trigger_family_is` / `trigger_rarity_is` miran la
 *       carta disparadora. `element_is` y hermanas NO cambian de significado.
 *
 * 2) `APPLY_STATUS` difiere la mutacion a `applyDeltas` (fin de la resolucion),
 *    asi que un estado que una carta se aplica NO era visible en la misma mano:
 *    `deep_latent_sporocarp` ("al puntuar revienta el Sobrecrecimiento que se
 *    puso al jugarse") revivia una mano TARDE.
 *    -> Las condiciones de estado y `CONSUME_STATUS` miran tambien los pedidos
 *       pendientes, y consumir RECORTA/ELIMINA el pedido para que `applyDeltas`
 *       no vuelva a aplicar lo que se acaba de cosechar.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';
import type { CardDefinition, CardInstance, ContentBundle } from '../src/engine/index.ts';

const REAL = buildRegistry().toBundle();

function realCard(id: string): CardDefinition {
  const def = REAL.cards.find((c) => c.id === id);
  assert.ok(def, `el pack tiene que traer "${id}"`);
  return def;
}

function realJoker(id: string): Record<string, unknown> {
  const def = (REAL.jokers ?? []).find((j) => j.id === id);
  assert.ok(def, `el pack tiene que traer el simbionte "${id}"`);
  return def as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Arnes
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

function bundleWith(cards: CardDefinition[], jokers: unknown[] = []): ContentBundle {
  return {
    cards,
    jokers: jokers as never,
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
    ],
    anteTargets: { 1: 1000 },
  };
}

/**
 * Arranca una run con UN ejemplar de la carta auditada + relleno de sobra, y
 * busca la semilla que la reparte en la mano (con varias copias, `trigger:fired`
 * llegaria desde otra copia y la medicion por uid daria un falso negativo).
 */
function startedWith(uniques: CardDefinition[], jokerIds: string[] = []): GameEngine {
  const filler = card('zz_filler');
  const defs = [...uniques, filler];
  const jokerDefs = jokerIds.map(realJoker);

  for (let seed = 1; seed <= 400; seed += 1) {
    const engine = new GameEngine({ seed, bundle: bundleWith(defs, jokerDefs) });
    engine.setArchetypeLoadout(
      [
        ...uniques.map((d) => ({ cardId: d.id, copies: 1 })),
        { cardId: filler.id, copies: 20 },
      ],
      [],
    );
    engine.startRun(seed);
    for (const id of jokerIds) engine.run.jokers.push(engine.registry.instantiateJoker(id));
    engine.chooseBlind('b1');
    const hand = engine.roundSnapshot().hand;
    if (uniques.every((d) => hand.some((c) => c.def.id === d.id))) return engine;
  }
  throw new Error('ninguna semilla repartio las cartas pedidas');
}

function inHand(engine: GameEngine, id: string): CardInstance {
  const found = engine.roundSnapshot().hand.find((c) => c.def.id === id);
  assert.ok(found, `"${id}" tiene que estar en la mano`);
  return found;
}

type Res = ReturnType<GameEngine['playHand']>;

/** Cuantas veces aporto ESPORAS esa carta (una por disparo del efecto). */
function sporeFires(res: Res, uid: string): number {
  return (res?.steps ?? []).filter((s) => s.sourceId === uid && s.action === 'ADD_SPORES').length;
}

function sporesGained(res: Res, uid: string): number {
  return (res?.steps ?? [])
    .filter((s) => s.sourceId === uid && s.action === 'ADD_SPORES')
    .reduce((acc, s) => acc + (s.value ?? 0), 0);
}

function consumedCount(res: Res, uid: string): number {
  return (res?.statusEvents ?? []).filter((e) => e.kind === 'consumed' && e.uid === uid).length;
}

const statusCount = (c: CardInstance, status: string): number =>
  c.statuses.filter((s) => s.type === status).length;

// ---------------------------------------------------------------------------
// 1) Condiciones sobre la carta DISPARADORA
// ---------------------------------------------------------------------------

test('trigger_element_is dispara SOLO por las cartas de ese elemento', () => {
  // "Cada carta de Veneno jugada: +3 Esporas". Antes usaba `element_is`, que
  // evalua a la propia Amanita Pantera (que ES Veneno) -> siempre verdadera ->
  // disparaba 5 veces con 5 cartas jugadas, 4 de ellas de otro elemento.
  const engine = startedWith([realCard('amanita_pantherina')]);
  const pan = inHand(engine, 'amanita_pantherina');
  const others = engine.roundSnapshot().hand.filter((c) => c.uid !== pan.uid);

  for (const c of [pan, ...others].slice(0, 5)) engine.toggleSelect(c.uid);
  const res = engine.playHand();

  assert.equal(
    sporeFires(res, pan.uid),
    1,
    'con 5 cartas jugadas (4 neutrales) el efecto dispara UNA vez: la propia Pantera',
  );
});

test('trigger_family_is dispara SOLO por las cartas de esa familia', () => {
  const engine = startedWith([realCard('oyster_cluster')]);
  const oyster = inHand(engine, 'oyster_cluster');
  const others = engine.roundSnapshot().hand.filter((c) => c.uid !== oyster.uid);

  for (const c of [oyster, ...others].slice(0, 5)) engine.toggleSelect(c.uid);
  const res = engine.playHand();

  const fires = (res?.steps ?? []).filter(
    (s) => s.sourceId === oyster.uid && s.action === 'ADD_SUBSTRATE' && s.value === 3,
  ).length;
  assert.equal(fires, 1, 'el relleno es Agaricacea, no Tricolomatacea: dispara solo por el Racimo');
});

test('trigger_element_is FUNCIONA en un SIMBIONTE (donde el sujeto es undefined)', () => {
  // Un simbionte no tiene `card`: con `element_is` la condicion era siempre falsa
  // y el simbionte no disparaba NUNCA.
  const poison = card('zz_poison', { element: 'poison' });
  const neutral = card('zz_neutral');
  const engine = new GameEngine({
    seed: 3,
    bundle: bundleWith([poison, neutral], [realJoker('joker_poison_bloom')]),
  });
  engine.setArchetypeLoadout(
    [{ cardId: poison.id, copies: 3 }, { cardId: neutral.id, copies: 3 }],
    [],
  );
  engine.startRun(3);
  const joker = engine.registry.instantiateJoker('joker_poison_bloom');
  engine.run.jokers.push(joker);
  engine.chooseBlind('b1');

  const hand = engine.roundSnapshot().hand;
  const played = hand.slice(0, 5);
  const venoms = played.filter((c) => c.def.element === 'poison');
  assert.ok(venoms.length >= 2, 'se juegan al menos 2 cartas de Veneno');

  for (const c of played) engine.toggleSelect(c.uid);
  const res = engine.playHand();

  const fires = (res?.steps ?? []).filter(
    (s) => s.sourceId === joker.uid && s.action === 'MULTIPLY_SPORES' && s.value === 1.5,
  ).length;
  assert.equal(fires, venoms.length, `dispara una vez por cada carta de Veneno JUGADA (${venoms.length})`);
});

test('element_is sigue significando "la carta DUEÑA" (no se cambio)', () => {
  // Guarda de la semantica vieja: una carta con `element_is` sobre SU propio
  // elemento sigue disparando con CADA carta jugada. Es lo que garantiza que el
  // arreglo no convirtio todas las condiciones en globales.
  const owner = card('zz_owner', {
    element: 'poison',
    effects: [
      {
        id: 'zz_owner_aura',
        trigger: 'ON_CARD_PLAYED',
        conditions: [{ type: 'element_is', value: 'poison' }],
        actions: [{ type: 'ADD_SPORES', value: 2 }],
      },
    ],
  });
  const engine = startedWith([owner]);
  const mine = inHand(engine, 'zz_owner');
  const others = engine.roundSnapshot().hand.filter((c) => c.uid !== mine.uid);

  for (const c of [mine, ...others].slice(0, 5)) engine.toggleSelect(c.uid);
  const res = engine.playHand();

  assert.equal(sporeFires(res, mine.uid), 5, 'la condicion mira al dueño: dispara con las 5 cartas jugadas');
});

// ---------------------------------------------------------------------------
// 2) Estados PENDIENTES visibles en la misma mano
// ---------------------------------------------------------------------------

test('una carta ve el estado que ELLA MISMA se aplica en la misma mano', () => {
  // `deep_latent_sporocarp`: "Al jugarse se cubre de Sobrecrecimiento; al puntuar
  // lo revienta y lo cobra como Esporas." Con la mutacion diferida a
  // `applyDeltas`, el reviente solo llegaba una mano TARDE.
  const engine = startedWith([realCard('deep_latent_sporocarp')]);
  const latent = inHand(engine, 'deep_latent_sporocarp');
  const others = engine.roundSnapshot().hand.filter((c) => c.uid !== latent.uid);

  for (const c of [latent, ...others].slice(0, 5)) engine.toggleSelect(c.uid);
  const res = engine.playHand();

  assert.equal(consumedCount(res, latent.uid), 1, 'revienta su Sobrecrecimiento en la MISMA mano');
  assert.equal(
    sporesGained(res, latent.uid),
    6,
    '3 pilas de Sobrecrecimiento x +2 Esporas = +6',
  );
  assert.equal(
    statusCount(latent, 'overgrowth'),
    0,
    'y NO queda con el estado: el pedido pendiente se cancelo al cosecharlo',
  );
});

test('consumir un estado PENDIENTE no lo deja puesto al cerrar la mano', () => {
  // La parte fina: si `CONSUME_STATUS` cobrara el pedido sin recortarlo,
  // `applyDeltas` lo aplicaria igual despues y la carta terminaria con el estado
  // que se acaba de cosechar (doble contabilidad).
  const engine = startedWith([realCard('deep_latent_sporocarp')]);
  const latent = inHand(engine, 'deep_latent_sporocarp');

  // Un estado PREVIO de la misma familia: la carta arranca con Sobrecrecimiento 1
  // y en la mano se le suma 3 mas (pedido). Debe quedar en 0 tras el reviente.
  latent.statuses = [{ type: 'overgrowth', value: 1, turnsLeft: 3 }];

  const others = engine.roundSnapshot().hand.filter((c) => c.uid !== latent.uid);
  for (const c of [latent, ...others].slice(0, 5)) engine.toggleSelect(c.uid);
  const res = engine.playHand();

  assert.equal(consumedCount(res, latent.uid), 1, 'consume una sola vez');
  assert.equal(
    statusCount(latent, 'overgrowth'),
    0,
    'no sobrevive ni lo asentado ni el pedido pendiente',
  );
});

test('una carta ve el estado que OTRA carta le aplica en la misma mano', () => {
  // `deep_carrion_lattice`: "Pudre una carta de la mano por 3 ciegos; al puntuar
  // con Putrefaccion: +12 Sustrato." La podredumbre que el mismo aplica tambien
  // es un pedido pendiente: sin verla, el +12 llegaba una mano tarde.
  const engine = startedWith([realCard('deep_carrion_lattice')]);
  const lattice = inHand(engine, 'deep_carrion_lattice');
  const others = engine.roundSnapshot().hand.filter((c) => c.uid !== lattice.uid);

  for (const c of [lattice, ...others].slice(0, 5)) engine.toggleSelect(c.uid);
  const res = engine.playHand();

  const reaped = (res?.steps ?? []).some(
    (s) => s.sourceId === lattice.uid && s.action === 'ADD_SUBSTRATE' && s.value === 12,
  );
  assert.ok(reaped, 'cobra el +12 en la MISMA mano en que pudre');
});
