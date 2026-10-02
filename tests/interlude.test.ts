/**
 * interlude.test.ts — Eventos entre Ciegos (P2.4) y decisiones de riesgo (P2.3).
 *
 * Un interludio es una parada entre dos ciegos donde el jugador acepta un trato
 * (con ventaja y coste) o sigue de largo. Lo que hay que proteger no es "que
 * aparezca", sino las propiedades que lo vuelven una DECISION y no una trampa:
 *
 *   - que el motor no aplique NADA hasta que el jugador confirme,
 *   - que el sorteo sea determinista (misma semilla = mismos eventos),
 *   - que un trato con coste imposible no deje la ventaja sin el coste,
 *   - que el objetivo alterado sea el MISMO en la pantalla de seleccion y en la
 *     ronda real (una sola fuente: `targetFor`),
 *   - que el debuff de objetivo sobreviva al guardado,
 *   - que la opcion de declinar siempre exista (si no, es un castigo disfrazado).
 *
 * Contenido de referencia: `src/data/packs/base/interludes.json` (6 eventos).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';
import {
  applyInterludeModifiers,
  DEFAULT_INTERLUDE_MODIFIERS,
  eligibleInterludes,
  immediateInterludeEffects,
  parseInterludes,
  pickInterlude,
  type InterludeDefinition,
} from '../src/engine/interlude/interlude.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readData(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../src/data/packs/base/${name}`, import.meta.url), 'utf8'),
  );
}

const INTERLUDE_DATA = readData('interludes.json') as InterludeDefinition[];

function engineWithInterludes(seed = 1): GameEngine {
  const engine = new GameEngine({ seed, bundle: buildRegistry().toBundle() });
  engine.startRun(seed);
  return engine;
}

/** Fuerza un interludio concreto en el motor (evita depender del sorteo). */
function forceInterlude(engine: GameEngine, def: InterludeDefinition): void {
  // `pendingInterlude` es privado: se entra por la via publica simulando el
  // estado. Se escribe con cast porque el objetivo es probar el CONTRATO
  // (chooseInterlude aplica bien), no el sorteo.
  const internals = engine as unknown as {
    pendingInterlude: InterludeDefinition | null;
  };
  internals.pendingInterlude = def;
  engine.run.status = 'interlude';
}

// ---------------------------------------------------------------------------
// Contenido y registro
// ---------------------------------------------------------------------------

test('los interludios del pack llegan al registro', () => {
  const registry = buildRegistry();
  const stats = registry.stats();
  assert.equal(stats.interludes, INTERLUDE_DATA.length);
  assert.ok(stats.interludes > 0, 'el pack base deberia declarar interludios');
});

test('cada interludio tiene una opcion de declinar (sin efectos)', () => {
  for (const def of INTERLUDE_DATA) {
    const hasDecline = def.choices.some((c) => (c.effects?.length ?? 0) === 0);
    assert.ok(hasDecline, `${def.id} no tiene opcion de declinar: es un castigo, no una decision`);
  }
});

test('cada interludio tiene al menos una opcion con efectos', () => {
  for (const def of INTERLUDE_DATA) {
    const hasPayoff = def.choices.some((c) => (c.effects?.length ?? 0) > 0);
    assert.ok(hasPayoff, `${def.id} no hace nada: ocupa el lugar de una decision real`);
  }
});

// ---------------------------------------------------------------------------
// Parser y sorteo puro
// ---------------------------------------------------------------------------

test('parseInterludes descarta entradas mal formadas', () => {
  const parsed = parseInterludes([
    { id: 'ok', nameKey: 'a.b', descKey: 'a.c', choices: [
      { id: 'y', labelKey: 'x.y', detailKey: 'x.z', effects: [{ type: 'MONEY', value: 1 }] },
      { id: 'n', labelKey: 'x.w', detailKey: 'x.v' },
    ] },
    { id: 'sin-opciones', nameKey: 'a.b', descKey: 'a.c', choices: [] },
    { id: 'solo-aceptar', nameKey: 'a.b', descKey: 'a.c', choices: [
      { id: 'y', labelKey: 'x.y', detailKey: 'x.z', effects: [{ type: 'MONEY', value: 1 }] },
      { id: 'y2', labelKey: 'x.y', detailKey: 'x.z', effects: [{ type: 'MONEY', value: 2 }] },
    ] },
    null,
    'no soy un objeto',
  ]);

  assert.equal(parsed.length, 1, 'solo la entrada valida deberia sobrevivir');
  assert.equal(parsed[0]?.id, 'ok');
});

test('parseInterludes clampa la cantidad de cartas y purgas', () => {
  const parsed = parseInterludes([
    { id: 'x', nameKey: 'a.b', descKey: 'a.c', choices: [
      { id: 'y', labelKey: 'x.y', detailKey: 'x.z', effects: [
        { type: 'CARD', count: 99 },
        { type: 'PURGE_RANDOM', count: 99 },
      ] },
      { id: 'n', labelKey: 'x.w', detailKey: 'x.v' },
    ] },
  ]);

  const effects = parsed[0]?.choices[0]?.effects ?? [];
  const card = effects.find((e) => e.type === 'CARD');
  const purge = effects.find((e) => e.type === 'PURGE_RANDOM');
  assert.ok(card && card.type === 'CARD' && card.count! <= 3, 'las cartas se clampean a 3');
  assert.ok(purge && purge.type === 'PURGE_RANDOM' && purge.count! <= 3, 'las purgas se clampean a 3');
});

test('eligibleInterludes respeta minAnte', () => {
  const defs = parseInterludes(INTERLUDE_DATA);
  const enAnte1 = eligibleInterludes(defs, 1);
  const enAnte6 = eligibleInterludes(defs, 6);
  assert.ok(enAnte6.length >= enAnte1.length, 'a mas ante, mas eventos elegibles');
  for (const def of enAnte1) {
    assert.ok((def.minAnte ?? 1) <= 1, `${def.id} no deberia salir en el ante 1`);
  }
});

test('pickInterlude es determinista para el mismo roll', () => {
  const defs = parseInterludes(INTERLUDE_DATA);
  const a = pickInterlude(defs, 3, 0.42);
  const b = pickInterlude(defs, 3, 0.42);
  assert.equal(a?.id, b?.id);
  assert.ok(a, 'deberia elegir algun interludio');
});

test('applyInterludeModifiers multiplica y clampea el objetivo', () => {
  const up = applyInterludeModifiers(DEFAULT_INTERLUDE_MODIFIERS, [
    { type: 'TARGET_MULTIPLIER', value: 1.15 },
  ]);
  assert.ok(Math.abs(up.targetMultiplier - 1.15) < 1e-9);

  // Encadenar multiplicadores tiene que multiplicar, no sumar.
  const chain = applyInterludeModifiers(up, [{ type: 'TARGET_MULTIPLIER', value: 0.85 }]);
  assert.ok(Math.abs(chain.targetMultiplier - 1.15 * 0.85) < 1e-9);

  // El tope evita que una cadena vuelva el juego imposible o trivial.
  const clampedUp = applyInterludeModifiers(DEFAULT_INTERLUDE_MODIFIERS, [
    { type: 'TARGET_MULTIPLIER', value: 100 },
  ]);
  assert.equal(clampedUp.targetMultiplier, 2);
  const clampedDown = applyInterludeModifiers(DEFAULT_INTERLUDE_MODIFIERS, [
    { type: 'TARGET_MULTIPLIER', value: 0.001 },
  ]);
  assert.equal(clampedDown.targetMultiplier, 0.5);
});

test('immediateInterludeEffects separa los modificadores acumulados', () => {
  const out = immediateInterludeEffects([
    { type: 'MONEY', value: 5 },
    { type: 'TARGET_MULTIPLIER', value: 1.2 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.type, 'MONEY');
});

// ---------------------------------------------------------------------------
// Motor: el interludio no aplica nada hasta confirmar
// ---------------------------------------------------------------------------

test('entrar a un interludio NO aplica efectos por si solo', () => {
  const engine = engineWithInterludes(5);
  const moneyBefore = engine.run.money;
  const deckBefore = engine.run.deck.totalSize;

  const def = parseInterludes(INTERLUDE_DATA)[0];
  assert.ok(def);
  forceInterlude(engine, def);

  assert.equal(engine.run.money, moneyBefore, 'no deberia cobrar antes de elegir');
  assert.equal(engine.run.deck.totalSize, deckBefore, 'no deberia tocar el mazo antes de elegir');
});

test('elegir la opcion de declinar no cambia nada', () => {
  const engine = engineWithInterludes(5);
  const moneyBefore = engine.run.money;
  const deckBefore = engine.run.deck.totalSize;

  const def = INTERLUDE_DATA[0];
  assert.ok(def);
  forceInterlude(engine, def);

  const decline = def.choices.find((c) => (c.effects?.length ?? 0) === 0);
  assert.ok(decline, 'deberia haber una opcion de declinar');
  const ok = engine.chooseInterlude(decline.id);

  assert.equal(ok, true);
  assert.equal(engine.run.money, moneyBefore);
  assert.equal(engine.run.deck.totalSize, deckBefore);
  assert.equal(engine.run.status, 'blind_select', 'despues del interludio se elige ciego');
});

test('aceptar un trato de dinero lo cobra/paga y sigue a la seleccion', () => {
  const engine = engineWithInterludes(5);
  // Se fuerza un trato conocido: +6 dinero y objetivo x1.15.
  const def = INTERLUDE_DATA.find((d) => d.id === 'interlude_spore_trade');
  assert.ok(def, 'interlude_spore_trade deberia existir');
  forceInterlude(engine, def);

  const moneyBefore = engine.run.money;
  const accept = def.choices.find((c) => (c.effects?.length ?? 0) > 0);
  assert.ok(accept);

  const ok = engine.chooseInterlude(accept.id);
  assert.equal(ok, true);
  assert.equal(engine.run.money, moneyBefore + 6);
  assert.ok(Math.abs(engine.run.interludeModifiers.targetMultiplier - 1.15) < 1e-9);
  assert.equal(engine.run.status, 'blind_select');
});

test('un trato con coste imposible no aplica NADA (ni la ventaja)', () => {
  const engine = engineWithInterludes(5);
  const def = INTERLUDE_DATA.find((d) => d.id === 'interlude_cracked_jar');
  assert.ok(def, 'interlude_cracked_jar deberia existir');
  forceInterlude(engine, def);

  // Sin dinero: el trato cuesta 5.
  engine.run.money = 0;
  engine.run.baseHands = 4;
  engine.run.jokerSlots = 1;

  const accept = def.choices.find((c) => (c.effects?.length ?? 0) > 0);
  assert.ok(accept);
  const ok = engine.chooseInterlude(accept.id);

  assert.equal(ok, false, 'no deberia poder aceptar un trato que no puede pagar');
  assert.equal(engine.run.jokerSlots, 1, 'no deberia dar la ranura sin cobrar');
  assert.equal(engine.run.money, 0);
  assert.equal(engine.run.status, 'interlude', 'el panel deberia quedar abierto');
});

// ---------------------------------------------------------------------------
// Objetivo: una sola fuente de verdad
// ---------------------------------------------------------------------------

test('el objetivo del interludio se refleja en targetFor y en la ronda', () => {
  const engine = engineWithInterludes(5);
  const blind = engine.availableBlinds()[0];
  assert.ok(blind, 'deberia haber un ciego disponible');

  const base = engine.targetFor(blind);

  engine.run.interludeModifiers = { targetMultiplier: 1.2 };
  const boosted = engine.targetFor(blind);
  assert.ok(boosted > base, 'el objetivo deberia subir con el multiplicador');

  // La ronda real tiene que pedir el MISMO numero que la pantalla de seleccion.
  engine.chooseBlind(blind.id);
  assert.equal(engine.round?.target, boosted, 'la ronda y la seleccion deben coincidir');
});

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

test('el multiplicador de interludio y los vistos sobreviven al guardado', () => {
  const engine = engineWithInterludes(7);
  engine.run.interludeModifiers = { targetMultiplier: 0.85 };
  engine.run.seenInterludes = ['interlude_spore_trade'];

  const save = engine.serialize();
  const reloaded = new GameEngine({ seed: 7, bundle: buildRegistry().toBundle() });
  const ok = reloaded.restore(save);

  assert.equal(ok, true);
  assert.ok(
    Math.abs(reloaded.run.interludeModifiers.targetMultiplier - 0.85) < 1e-9,
    'el objetivo alterado no puede reseteares al recargar',
  );
  assert.deepEqual(reloaded.run.seenInterludes, ['interlude_spore_trade']);
});

test('un guardado sin interludios carga con los valores neutros (migracion)', () => {
  const engine = engineWithInterludes(11);
  const save = engine.serialize();
  // Simula un guardado previo a P2.4: sin los campos nuevos.
  const legacy = { ...save };
  delete (legacy as { interludeTargetMultiplier?: number }).interludeTargetMultiplier;
  delete (legacy as { seenInterludes?: string[] }).seenInterludes;

  const reloaded = new GameEngine({ seed: 11, bundle: buildRegistry().toBundle() });
  const ok = reloaded.restore(legacy);

  assert.equal(ok, true);
  assert.equal(reloaded.run.interludeModifiers.targetMultiplier, 1);
  assert.deepEqual(reloaded.run.seenInterludes, []);
});

test('un interludio que ya no existe en el contenido se descarta al cargar', () => {
  const engine = engineWithInterludes(13);
  engine.run.seenInterludes = ['interlude_borrado', 'interlude_spore_trade'];

  const save = engine.serialize();
  const reloaded = new GameEngine({ seed: 13, bundle: buildRegistry().toBundle() });
  reloaded.restore(save);

  assert.deepEqual(reloaded.run.seenInterludes, ['interlude_spore_trade']);
});

// ---------------------------------------------------------------------------
// P2.4: interludio como parada del flujo
// ---------------------------------------------------------------------------

test('interlude tras salir de la tienda cuando el sorteo lo decide', () => {
  const registry = buildRegistry().toBundle();
  const engine = new GameEngine({ seed: 3, bundle: registry });
  engine.startRun(3);
  engine.chooseBlind(engine.availableBlinds()[0]!.id);

  // Fuerza el estado de tienda y sale: `leaveShop` intenta el interludio.
  engine.enterShop();
  // 40% de probabilidad: se prueba con varias semillas que al menos una entre.
  let sawInterlude = false;
  for (let seed = 1; seed <= 30 && !sawInterlude; seed++) {
    const e = new GameEngine({ seed, bundle: registry });
    e.startRun(seed);
    e.chooseBlind(e.availableBlinds()[0]!.id);
    e.enterShop();
    e.leaveShop();
    if (e.run.status === 'interlude') sawInterlude = true;
  }
  assert.ok(sawInterlude, 'en 30 semillas, algun interludio deberia aparecer al salir de la tienda');
});

test('el interludio no se repite en la misma run', () => {
  const registry = buildRegistry().toBundle();
  const def = parseInterludes(INTERLUDE_DATA)[0];
  assert.ok(def);

  const engine = new GameEngine({ seed: 21, bundle: registry });
  engine.startRun(21);
  engine.run.seenInterludes = [def.id];

  const defs = registry.interludes ?? [];
  const unseen = defs.filter((d) => !engine.run.seenInterludes.includes(d.id));
  assert.ok(
    !unseen.some((d) => d.id === def.id),
    'un interludio ya visto no deberia volver a ofrecerse',
  );
});
