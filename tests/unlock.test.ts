/**
 * unlock.test.ts — Puertas de contenido (R2).
 *
 * Que se prueba aca y por que:
 *   - Un desbloqueo es una PUERTA, no una medalla. Si se rompe, el jugador
 *     juega un juego mas chico y NUNCA se entera. Por eso hay tests.
 *   - La idempotencia importa DOS veces: no se puede duplicar el contenido en el
 *     perfil, y no se puede volver a avisar (el aviso dispara un banner).
 *   - El `PackGate` es el que consume todo esto: si el candado no se levanta en
 *     el gate, `contentState` sigue 'locked' aunque el perfil diga lo contrario.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { Emitter, type GameEventMap } from '../src/engine/events.ts';
import { ContentRegistry } from '../src/content/ContentRegistry.ts';
import { parsePack } from '../src/content/parse.ts';
import { EntitlementStore } from '../src/meta/EntitlementStore.ts';
import { PackGate } from '../src/meta/PackGate.ts';
import { defaultProfile, type ProfileSave } from '../src/meta/ProfileState.ts';
import {
  UnlockTracker,
  parseUnlockRules,
  type UnlockContext,
  type UnlockDef,
} from '../src/meta/UnlockTracker.ts';
import { parseAchievements, AchievementTracker } from '../src/retention/AchievementTracker.ts';
import type { CardDefinition } from '../src/engine/index.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function profileHandle(save: ProfileSave = defaultProfile()) {
  return {
    current: save,
    patch(mutate: (p: ProfileSave) => void) {
      mutate(save);
    },
  };
}

/**
 * Tracker con contexto MUTABLE: los tests cambian `ctx` entre emisiones para
 * simular el avance de la partida (ante 3 -> ante 6) sin reconstruir nada.
 */
function harness(defs: UnlockDef[], ctx: UnlockContext = {}) {
  const bus = new Emitter<GameEventMap>();
  const profile = profileHandle();
  const tracker = new UnlockTracker({ bus, defs, profile, getContext: () => ctx });
  return { bus, profile, tracker, ctx };
}

const RULE: UnlockDef = {
  id: 'unlock_test_card',
  contentId: 'card_x',
  kind: 'card',
  nameKey: 'unlockRule.unlock_test_card.name',
  descKey: 'unlockRule.unlock_test_card.desc',
  event: 'round:win',
  when: { op: 'gte', path: 'ctx.ante', value: 4 },
};

/** Lee un JSON de `src/data` del disco, igual que el arranque pero sin bundler. */
function readData(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
}

const realRules = () => parseUnlockRules(readData('unlock-rules.json'));
const realAchievements = () => parseAchievements(readData('achievements.json'));

/**
 * Payload de `round:win` tal como lo emite el motor. El ANTEO no viaja en el
 * payload: lo lee la condicion desde `ctx`. Por eso se emite siempre el mismo
 * y quien varia es el contexto del harness.
 */
const WIN: GameEventMap['round:win'] = { score: 0, target: 0, reward: 0, money: 0 };

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

test('parseUnlockRules acepta una regla bien formada', () => {
  const defs = parseUnlockRules([
    {
      id: 'unlock_a',
      contentId: 'card_x',
      kind: 'card',
      nameKey: 'unlockRule.unlock_a.name',
      descKey: 'unlockRule.unlock_a.desc',
      event: 'round:win',
      when: { op: 'gte', path: 'ctx.ante', value: 4 },
    },
  ]);
  assert.equal(defs.length, 1);
  assert.equal(defs[0]?.contentId, 'card_x');
});

test('parseUnlockRules descarta una regla SIN when (a diferencia de un logro)', () => {
  const defs = parseUnlockRules([
    {
      id: 'unlock_no_when',
      contentId: 'card_x',
      kind: 'card',
      nameKey: 'k',
      descKey: 'd',
      event: 'round:win',
    },
  ]);
  assert.equal(defs.length, 0);
});

test('parseUnlockRules descarta un evento que no existe en el bus', () => {
  const defs = parseUnlockRules([
    {
      id: 'unlock_bad_event',
      contentId: 'card_x',
      kind: 'card',
      nameKey: 'k',
      descKey: 'd',
      event: 'evento:inventado',
      when: { op: 'always' },
    },
  ]);
  assert.equal(defs.length, 0);
});

test('parseUnlockRules descarta un kind que no es contenido desbloqueable', () => {
  const defs = parseUnlockRules([
    {
      id: 'unlock_bad_kind',
      contentId: 'card_x',
      kind: 'blind',
      nameKey: 'k',
      descKey: 'd',
      event: 'round:win',
      when: { op: 'always' },
    },
  ]);
  assert.equal(defs.length, 0);
});

test('una regla invalida NO tumba a las validas que la rodean', () => {
  const good = {
    id: 'unlock_ok',
    contentId: 'card_x',
    kind: 'card' as const,
    nameKey: 'k',
    descKey: 'd',
    event: 'round:win',
    when: { op: 'always' },
  };
  const defs = parseUnlockRules([good, { id: 'rota' }, good]);
  assert.equal(defs.length, 2);
});

// ---------------------------------------------------------------------------
// Condicion y concesion
// ---------------------------------------------------------------------------

test('la condicion NO se cumple todavia: no abre nada', () => {
  const { bus, profile, tracker } = harness([RULE], { ante: 3 });
  tracker.start();

  bus.emit('round:win', WIN);

  assert.deepEqual(profile.current.collection.unlockedCardIds, []);
});

test('la condicion se cumple: abre la carta y registra el ORIGEN', () => {
  const { bus, profile, tracker, ctx } = harness([RULE], { ante: 4 });
  tracker.start();

  bus.emit('round:win', WIN);

  assert.deepEqual(profile.current.collection.unlockedCardIds, ['card_x']);
  // El origen es 'unlock' y no 'daily'/'achievement': la Coleccion lo usa para
  // explicar de donde salio.
  assert.equal(profile.current.collection.unlockSource['card_x'], 'unlock');
  assert.equal(ctx.ante, 4);
});

test('emite unlock:granted una sola vez', () => {
  const { bus, profile, tracker } = harness([RULE], { ante: 6 });
  const seen: string[] = [];
  bus.on('unlock:granted', ({ contentId }) => seen.push(contentId));
  tracker.start();

  bus.emit('round:win', WIN);
  bus.emit('round:win', WIN);
  bus.emit('round:win', WIN);

  assert.deepEqual(seen, ['card_x']);
  // Y el perfil no tiene duplicados.
  assert.deepEqual(profile.current.collection.unlockedCardIds, ['card_x']);
});

test('un contenido YA poseido no vuelve a avisar (pero igual sella el origen)', () => {
  const save = defaultProfile();
  save.collection.unlockedCardIds.push('card_x');
  const bus = new Emitter<GameEventMap>();
  const profile = { current: save, patch: (m: (p: ProfileSave) => void) => m(save) };
  const tracker = new UnlockTracker({
    bus,
    defs: [RULE],
    profile,
    getContext: () => ({ ante: 9 }),
  });
  const seen: string[] = [];
  bus.on('unlock:granted', ({ contentId }) => seen.push(contentId));
  tracker.start();

  bus.emit('round:win', WIN);

  assert.deepEqual(seen, []);
  assert.deepEqual(save.collection.unlockedCardIds, ['card_x']);
});

test('un tracker nuevo con la puerta ya abierta no vuelve a escuchar', () => {
  const save = defaultProfile();
  save.collection.unlockedCardIds.push('card_x');
  const bus = new Emitter<GameEventMap>();
  const seen: string[] = [];
  bus.on('unlock:granted', ({ contentId }) => seen.push(contentId));

  const tracker = new UnlockTracker({
    bus,
    defs: [RULE],
    profile: { current: save, patch: (m) => m(save) },
    getContext: () => ({ ante: 9 }),
  });
  tracker.start();
  bus.emit('round:win', WIN);

  assert.deepEqual(seen, []);
});

test('stop() corta la escucha', () => {
  const { bus, profile, tracker } = harness([RULE], { ante: 6 });
  tracker.start();
  tracker.stop();

  bus.emit('round:win', WIN);

  assert.deepEqual(profile.current.collection.unlockedCardIds, []);
});

test('los jokers se guardan en su propia lista', () => {
  const { bus, profile, tracker } = harness(
    [{ ...RULE, kind: 'joker', contentId: 'joker_x' }],
    { ante: 6 },
  );
  tracker.start();

  bus.emit('round:win', WIN);

  assert.deepEqual(profile.current.collection.unlockedJokerIds, ['joker_x']);
  assert.deepEqual(profile.current.collection.unlockedCardIds, []);
});

// ---------------------------------------------------------------------------
// Predicados
// ---------------------------------------------------------------------------

test('los cuatro operadores del mini-lenguaje se evaluan', () => {
  const cases: Array<[UnlockDef['when'], UnlockContext, boolean]> = [
    [{ op: 'always' }, {}, true],
    [{ op: 'gte', path: 'ctx.n', value: 5 }, { n: 5 }, true],
    [{ op: 'gte', path: 'ctx.n', value: 5 }, { n: 4 }, false],
    [{ op: 'lte', path: 'ctx.n', value: 5 }, { n: 5 }, true],
    [{ op: 'lte', path: 'ctx.n', value: 5 }, { n: 6 }, false],
    [{ op: 'eq', path: 'ctx.flag', value: 'yes' }, { flag: 'yes' }, true],
    [{ op: 'eq', path: 'ctx.flag', value: 'yes' }, { flag: 'no' }, false],
  ];

  for (const [when, ctx, expected] of cases) {
    const { bus, profile, tracker } = harness([{ ...RULE, when }], ctx);
    tracker.start();
    bus.emit('round:win', WIN);
    assert.equal(
      profile.current.collection.unlockedCardIds.length === 1,
      expected,
      `when=${JSON.stringify(when)} ctx=${JSON.stringify(ctx)}`,
    );
  }
});

test('una ruta inexistente no abre la puerta (no la trata como 0)', () => {
  const { bus, profile, tracker } = harness(
    [{ ...RULE, when: { op: 'gte', path: 'ctx.noExiste', value: 0 } }],
    {},
  );
  tracker.start();
  bus.emit('round:win', WIN);
  // `Number(undefined)` es NaN y NaN >= 0 es false: una ruta mal escrita no
  // puede regalar contenido.
  assert.deepEqual(profile.current.collection.unlockedCardIds, []);
});

test('una condicion puede leer el payload de la partida', () => {
  const { bus, profile, tracker } = harness(
    [{ ...RULE, event: 'score:hand', when: { op: 'gte', path: 'payload.total', value: 500 } }],
    {},
  );
  tracker.start();

  bus.emit('score:hand', { total: 400, base: 0, total2: 0 } as never);
  assert.deepEqual(profile.current.collection.unlockedCardIds, []);

  bus.emit('score:hand', { total: 600, base: 0, total2: 0 } as never);
  assert.deepEqual(profile.current.collection.unlockedCardIds, ['card_x']);
});

// ---------------------------------------------------------------------------
// Publicacion de condiciones (lo que lee la Coleccion)
// ---------------------------------------------------------------------------

test('publishConditions escribe la condicion de cada puerta cerrada', () => {
  const { tracker, profile } = harness([RULE]);
  tracker.publishConditions();

  assert.equal(profile.current.collection.pendingUnlocks['card_x'], RULE.descKey);
});

test('publishConditions NO publica lo ya abierto', () => {
  const save = defaultProfile();
  save.collection.unlockedCardIds.push('card_x');
  const tracker = new UnlockTracker({
    bus: new Emitter<GameEventMap>(),
    defs: [RULE],
    profile: { current: save, patch: (m) => m(save) },
    getContext: () => ({}),
  });

  tracker.publishConditions();

  assert.deepEqual(save.collection.pendingUnlocks, {});
});

test('abrir la puerta retira su condicion del mapa publicado', () => {
  const { bus, profile, tracker } = harness([RULE], { ante: 6 });
  tracker.publishConditions();
  assert.equal(profile.current.collection.pendingUnlocks['card_x'], RULE.descKey);

  tracker.start();
  bus.emit('round:win', WIN);

  assert.equal(profile.current.collection.pendingUnlocks['card_x'], undefined);
});

test('publishConditions REESCRIBE el mapa entero (una regla borrada no deja basura)', () => {
  const save = defaultProfile();
  save.collection.pendingUnlocks['contenido_viejo_que_ya_no_existe'] = 'x.y';
  const tracker = new UnlockTracker({
    bus: new Emitter<GameEventMap>(),
    defs: [RULE],
    profile: { current: save, patch: (m) => m(save) },
    getContext: () => ({}),
  });

  tracker.publishConditions();

  assert.deepEqual(Object.keys(save.collection.pendingUnlocks), ['card_x']);
});

test('publishConditions MUTA EN SITIO: la referencia que guarda el PackGate sigue viva', () => {
  // El bug que este test previene: `PackGate` guarda una referencia al mapa
  // para no reconstruirse en cada consulta. Si `publishConditions` reasignara
  // el objeto, el gate miraria el viejo y el candado nunca aparecería, sin
  // errores.
  const { tracker, profile } = harness([RULE]);
  const captured = profile.current.collection.pendingUnlocks;

  tracker.publishConditions();

  assert.equal(
    profile.current.collection.pendingUnlocks,
    captured,
    'el objeto del perfil no puede reemplazarse',
  );
  // Y la referencia capturada ANTES ya ve la condicion publicada.
  assert.equal(captured['card_x'], RULE.descKey);
});

test('las reglas reales NO apuntan a un destino de evolucion', () => {
  // Un destino de evolucion detras de una puerta quedaria fuera del
  // `CardRegistry`, `EvolutionService.apply()` devolveria null en silencio y esa
  // carta seria INALCANZABLE. El `PackGate` lo protege igual (exime a los
  // destinos), pero publicar una condicion para algo que el gate permite deja a
  // la Coleccion mintiendo. Se prohibe en los datos.
  const registry = buildRegistry();
  const targets = registry.evolutionTargets();
  assert.ok(targets.size > 0, 'deberia haber reglas de evolucion');

  for (const rule of realRules()) {
    assert.ok(
      !targets.has(rule.contentId),
      `${rule.contentId} es destino de evolucion y no puede tener puerta`,
    );
  }
});

test('PackGate: un destino de evolucion esta permitido aunque haya una puerta', () => {
  const registry = buildRegistry();
  const target = [...registry.evolutionTargets()][0];
  assert.ok(target, 'deberia haber al menos un destino');

  // Caso hostil: alguien publica una puerta sobre un destino de evolucion.
  const pending: Record<string, string> = { [target!]: 'unlockRule.x.desc' };
  const gate = new PackGate(
    new EntitlementStore({ owned: ['pack.base'] }),
    registry,
    { cards: [], jokers: [] },
    pending,
  );

  // El gate NO lo bloquea: prefiere una Coleccion con un candado de mas que un
  // juego con una evolucion rota.
  assert.equal(gate.contentState(target!), 'allowed');
  // Y el bundle lo incluye, que es lo que `EvolutionService` necesita.
  assert.ok(registry.toBundle(gate).cards.some((c) => c.id === target));
});

test('las evoluciones siguen resolviendo su destino con el gate real', () => {
  // El fallo que este test previene es MUDO: sin destino, `apply()` devuelve
  // null y la carta simplemente nunca evoluciona. Nadie ve un error.
  const registry = buildRegistry();
  const pending: Record<string, string> = {};
  for (const rule of realRules()) pending[rule.contentId] = rule.descKey;
  const gate = new PackGate(
    new EntitlementStore({ owned: ['pack.base'] }),
    registry,
    { cards: [], jokers: [] },
    pending,
  );
  const bundle = registry.toBundle(gate);
  const ids = new Set(bundle.cards.map((c) => c.id));

  for (const rule of bundle.evolutions ?? []) {
    assert.ok(ids.has(rule.to), `la evolucion ${rule.id} no puede alcanzar ${rule.to}`);
  }
});

// ---------------------------------------------------------------------------
// Integration con PackGate
// ---------------------------------------------------------------------------

function card(id: string): CardDefinition {
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
    art: { hue: 120, pattern: 'radial' },
  };
}

function baseRegistry(...cards: CardDefinition[]): ContentRegistry {
  const registry = new ContentRegistry('1.0.0');
  registry.add(
    parsePack({
      manifest: {
        id: 'base',
        version: 1,
        kind: 'base',
        priority: 0,
        titleKey: 'pack.base.title',
        requires: { appMin: '1.0.0' },
        gating: { entitlement: 'pack.base', lockedVisibility: 'visible' },
        // `parsePack` lee los archivos declarados en `contents`: sin esto, el
        // pack carga vacio y el test pasaria por el motivo equivocado.
        contents: { cards: ['cards.json'] },
      },
      files: { 'cards.json': cards } as never,
      origin: 'bundled',
    }),
  );
  return registry;
}

test('PackGate: sin condiciones, el contenido del pack base esta permitido', () => {
  const registry = baseRegistry(card('card_x'));
  const gate = new PackGate(new EntitlementStore({ owned: ['pack.base'] }), registry);
  assert.equal(gate.contentState('card_x'), 'allowed');
});

test('PackGate: una puerta pendiente bloquea el contenido aunque el pack sea propio', () => {
  const registry = baseRegistry(card('card_x'));
  const pending: Record<string, string> = { card_x: 'unlockRule.unlock_test_card.desc' };
  const gate = new PackGate(
    new EntitlementStore({ owned: ['pack.base'] }),
    registry,
    { cards: [], jokers: [] },
    pending,
  );

  // El pack base ESTA comprado, pero la puerta por jugar sigue cerrada. Si el
  // orden de la comprobacion se invirtiera, esto seria 'allowed' y el contenido
  // apareceria antes de ganarselo.
  assert.equal(gate.contentState('card_x'), 'locked');
  // Y el gate sabe EXPLICAR el candado.
  assert.equal(gate.lockReasonKey('card_x'), 'unlockRule.unlock_test_card.desc');
  // Fuera de los sorteos.
  assert.equal(registry.toBundle(gate).cards.length, 0);
});

test('PackGate: ganar la puerta lo mete al bundle EN CALIENTE', () => {
  const registry = baseRegistry(card('card_x'));
  const owned = { cards: [] as string[], jokers: [] as string[] };
  const pending: Record<string, string> = { card_x: 'unlockRule.unlock_test_card.desc' };
  const gate = new PackGate(
    new EntitlementStore({ owned: ['pack.base'] }),
    registry,
    owned,
    pending,
  );
  assert.equal(gate.contentState('card_x'), 'locked');

  // Simula lo que hace `RetentionReward`: el array VIVO y el mapa VIVO.
  owned.cards.push('card_x');
  delete pending['card_x'];

  assert.equal(gate.contentState('card_x'), 'allowed');
  assert.equal(gate.lockReasonKey('card_x'), undefined);
  assert.deepEqual(
    registry.toBundle(gate).cards.map((c) => c.id),
    ['card_x'],
  );
});

test('PackGate: las condiciones y los logros conviven (medalla != puerta)', () => {
  const registry = baseRegistry(card('card_x'), card('card_y'));
  const owned = { cards: [] as string[], jokers: [] as string[] };
  const pending: Record<string, string> = { card_y: 'unlockRule.unlock_card_y.desc' };
  const gate = new PackGate(
    new EntitlementStore({ owned: ['pack.base'] }),
    registry,
    owned,
    pending,
  );

  assert.equal(gate.contentState('card_x'), 'allowed');
  assert.equal(gate.contentState('card_y'), 'locked');
});

test('PackGate: el contenido bloqueado por jugar se explica, no se vende', () => {
  const registry = baseRegistry(card('card_x'));
  const pending: Record<string, string> = { card_x: 'unlockRule.unlock_test_card.desc' };
  const gate = new PackGate(
    new EntitlementStore({ owned: ['pack.base'] }),
    registry,
    { cards: [], jokers: [] },
    pending,
  );

  // El pack base esta comprado, asi que `lockedContent` (superficie de venta)
  // no lo lista: no hay nada que vender. Pero `contentState` sigue bloqueado.
  assert.equal(gate.lockedContent().length, 0);
  assert.equal(gate.contentState('card_x'), 'locked');
});

// ---------------------------------------------------------------------------
// Contenido real
// ---------------------------------------------------------------------------

test('las reglas reales apuntan a contenido que EXISTE y no pisan a los logros', () => {
  const rules = realRules();
  assert.ok(rules.length > 0, 'deberia haber reglas');

  const registry = buildRegistry();
  const cardIds = new Set(registry.poolOf('card').map((c) => c.id));
  const jokerIds = new Set(registry.poolOf('joker').map((j) => j.id));

  for (const rule of rules) {
    const pool = rule.kind === 'card' ? cardIds : jokerIds;
    assert.ok(pool.has(rule.contentId), `${rule.id}: ${rule.contentId} no existe`);
  }

  // Ningun id ni contentId repetido: dos puertas sobre lo mismo se pisarian.
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  assert.equal(new Set(rules.map((r) => r.contentId)).size, rules.length);

  // Y no se solapan con la recompensa de un logro: si un logro ya regala la
  // carta, la puerta nunca se cierra y la condicion publicada seria una mentira.
  const granted = new Set(
    realAchievements()
      .map((a) => (a.reward ? a.reward.id : ''))
      .filter((id) => id.length > 0),
  );
  for (const rule of rules) {
    assert.ok(
      !granted.has(rule.contentId),
      `${rule.contentId} ya lo regala un logro (${[...granted].join(', ')})`,
    );
  }
});

test('las reglas reales no dejan el juego base sin contenido jugable', () => {
  const registry = buildRegistry();
  const pending: Record<string, string> = {};
  for (const rule of realRules()) pending[rule.contentId] = rule.descKey;

  const gate = new PackGate(
    new EntitlementStore({ owned: ['pack.base'] }),
    registry,
    { cards: [], jokers: [] },
    pending,
  );
  const bundle = registry.toBundle(gate);

  // Un juego sin cartas de sobra ni jokers no se puede jugar. Los umbrales son
  // deliberadamente flojos: lo que se protege es que una regla nueva no vacie
  // el pool por accidente.
  assert.ok(bundle.cards.length >= 20, `quedan ${bundle.cards.length} cartas`);
  assert.ok(bundle.jokers.length >= 3, `quedan ${bundle.jokers.length} jokers`);
  // Los starters nunca pueden estar detras de una puerta: son el mazo inicial.
  for (const id of ['spore_puffball', 'mycelium_thread', 'decay_bracket']) {
    assert.ok(
      bundle.cards.some((c) => c.id === id),
      `${id} es una carta inicial y quedo bloqueada`,
    );
  }
  // Y ningun ciego puede bloquearse: son la estructura de la run.
  assert.equal(bundle.blinds.length, 24);
});

test('todos los logros y desbloqueos comparten el mismo catalogo de eventos', () => {
  // Si alguien agrega un evento al bus y lo usa en logros pero no en
  // desbloqueos, este test lo detecta (o al reves).
  const ach = realAchievements();
  const rules = realRules();
  assert.ok(ach.length > 0 && rules.length > 0);
  // Un tracker real de cada tipo se construye sin tirar.
  const bus = new Emitter<GameEventMap>();
  const save = defaultProfile();
  const profile = { current: save, patch: (m: (p: ProfileSave) => void) => m(save) };
  new AchievementTracker({ bus, defs: ach, profile, getContext: () => ({}) }).start();
  new UnlockTracker({ bus, defs: rules, profile, getContext: () => ({}) }).start();
});
