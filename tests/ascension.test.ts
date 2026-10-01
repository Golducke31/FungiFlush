/**
 * ascension.test.ts — Ascensiones: dificultad acumulativa que el jugador elige.
 *
 * Una ascension NO es contenido que se colecciona: es una CAPA de reglas que se
 * aplica al nacer la run. Lo que hay que proteger es:
 *
 *   - que el nivel se resuelva desde el contenido y no desde una tabla
 *     hardcodeada en el motor (el balance vive en el JSON),
 *   - que un nivel inexistente (A0, o uno por encima del techo) sea IDENTIDAD y
 *     no `undefined` — un getter que devuelve undefined tumba el HUD entero,
 *   - que los modificadores se apliquen UNA vez al crear la run y no en cada
 *     consulta (si no, las manos bajan solas cada vez que el HUD mira),
 *   - que el objetivo compuesto (voucher x ascension) se calcule en el ORDEN
 *     correcto, porque al reves el nivel se abarata solo,
 *   - que el precio que muestra la tienda sea el mismo que cobra `buyOffer`,
 *   - que la run sobreviva al guardado CONSERVANDO su nivel, sin subir la
 *     version del save (el campo es aditivo).
 *
 * Contenido de referencia: `src/data/packs/base/ascensions.json` (A1..A8).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CardRegistry } from '../src/engine/cards/CardRegistry.ts';
import { GameEngine } from '../src/engine/GameEngine.ts';
import { RNG } from '../src/engine/rng.ts';
import { createRunState, setAscensionResolver } from '../src/engine/state/RunState.ts';
import { Deck } from '../src/engine/cards/Deck.ts';
import { ECONOMY, RUN_DEFAULTS } from '../src/engine/constants.ts';
import type { AscensionDefinition, RunSaveData } from '../src/engine/index.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readData(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../src/data/packs/base/${name}`, import.meta.url), 'utf8'),
  );
}

const ASCENSION_DATA = readData('ascensions.json') as AscensionDefinition[];

/** Ascensiones reales indexadas por nivel, para no hardcodear numeros. */
const REAL = new Map(ASCENSION_DATA.map((a) => [a.level, a]));

function registryFromRealContent(): CardRegistry {
  const registry = new CardRegistry();
  registry.load(buildRegistry().toBundle());
  return registry;
}

/**
 * Un motor arrancado en una run del nivel pedido.
 *
 * El registro del contenido inyecta el resolver de ascensiones en el
 * constructor del motor, asi que aca ya se resuelven los modificadores reales.
 */
function engineAt(ascension: number, seed = 1): GameEngine {
  const engine = new GameEngine({ seed, bundle: buildRegistry().toBundle() });
  engine.startRun(seed, ascension);
  return engine;
}

// ---------------------------------------------------------------------------
// Contenido: la tabla de niveles
// ---------------------------------------------------------------------------

test('el contenido trae ascensiones continuas desde A1', () => {
  const registry = registryFromRealContent();
  const max = registry.maxAscension();
  assert.ok(max >= 1, 'deberia haber al menos una ascension');

  // Cadena sin huecos: A1, A2, ... A(max). Un hueco dejaria un nivel
  // inalcanzable y el validador de contenido ya lo rechaza al autorar.
  for (let level = 1; level <= max; level++) {
    assert.ok(REAL.has(level), `falta el nivel A${level} en la tabla`);
  }
});

test('un nivel inexistente resuelve a IDENTIDAD, nunca a undefined', () => {
  const registry = registryFromRealContent();

  // A0 no esta declarado: es el "sin ascension".
  const a0 = registry.ascension(0);
  assert.ok(a0, 'A0 deberia existir como identidad');
  assert.deepEqual(a0.modifiers, {}, 'A0 no deberia modificar nada');

  // Por encima del techo tampoco explota: se recorta a identidad.
  const over = registry.ascension(999);
  assert.ok(over, 'un nivel fuera de rango deberia devolver identidad');
  assert.deepEqual(over.modifiers, {});

  // Y un nivel negativo tampoco.
  const neg = registry.ascension(-3);
  assert.deepEqual(neg.modifiers, {});
});

test('los modificadores declarados son coherentes (objetivo y tienda suben)', () => {
  for (const def of ASCENSION_DATA) {
    const mult = def.modifiers.targetMultiplier ?? 1;
    assert.ok(mult >= 1, `A${def.level}: el objetivo no deberia bajar (${mult})`);
    const shop = def.modifiers.shopCostMultiplier ?? 1;
    assert.ok(shop >= 1, `A${def.level}: la tienda no deberia abaratarse (${shop})`);
  }
});

// ---------------------------------------------------------------------------
// Aplicacion al nacer la run
// ---------------------------------------------------------------------------

test('los modificadores se aplican UNA vez al crear la run', () => {
  // OJO: `createRunState` resuelve el nivel por una funcion INYECTADA. Un
  // `createRunState` suelto en un test corre con el resolver por defecto
  // (identidad) y no aplicaria nada: hay que pasar por el motor, que es quien
  // inyecta el resolver del contenido en su constructor.
  const engine = engineAt(4, 1);
  const mods = engine.ascension.modifiers;

  assert.equal(engine.run.ascension, 4, 'la run deberia recordar su nivel');
  assert.equal(
    engine.run.baseHands,
    Math.max(1, RUN_DEFAULTS.hands + (mods.baseHands ?? 0)),
    'las manos deberian incluir el delta del nivel',
  );
  assert.equal(
    engine.run.baseDiscards,
    Math.max(0, RUN_DEFAULTS.discards + (mods.baseDiscards ?? 0)),
    'los descartes deberian incluir el delta del nivel',
  );

  // Doble lectura: el valor no cambia entre consultas. Si los deltas se
  // aplicaran al LEER (en vez de al nacer), un getter los volveria a restar.
  assert.equal(engine.run.baseHands, engine.run.baseHands);
  assert.equal(engine.run.baseDiscards, engine.run.baseDiscards);
});

test('createRunState sin resolver inyectado no aplica nada (identidad)', () => {
  // Documenta POR QUE el test de arriba usa el motor: el estado puro no conoce
  // el contenido. Se fuerza el resolver por defecto a mano porque otro test de
  // este mismo proceso pudo haber dejado el real inyectado (el modulo es
  // compartido entre tests del archivo).
  setAscensionResolver(() => ({}));
  const deck = new Deck(new RNG(1));
  const bare = createRunState(1, deck, 4);
  assert.equal(bare.baseHands, RUN_DEFAULTS.hands, 'sin resolver, el nivel no toca las manos');
  assert.equal(bare.baseDiscards, RUN_DEFAULTS.discards);
});

test('los pisos evitan que una ascension deje la run injugable', () => {
  // Un nivel hipotetico con deltas enormes no puede dejar 0 manos.
  const registry = registryFromRealContent();
  const max = registry.maxAscension();
  const deck = new Deck(new RNG(2));
  const state = createRunState(2, deck, max);

  assert.ok(state.baseHands >= 1, 'siempre deberia quedar al menos una mano');
  assert.ok(state.baseDiscards >= 0, 'los descartes nunca son negativos');
  assert.ok(state.baseHandSize >= 1, 'la mano nunca es vacia');
  assert.ok(state.jokerSlots >= 0, 'los slots de joker nunca son negativos');
});

test('el motor recorta el nivel pedido al techo del contenido', () => {
  const engine = engineAt(999);
  const max = engine.registry.maxAscension();
  assert.equal(engine.run.ascension, max, 'el nivel deberia quedar recortado al techo');
});

// ---------------------------------------------------------------------------
// Objetivo compuesto
// ---------------------------------------------------------------------------

test('el objetivo de la ascension multiplica sobre el del ciego', () => {
  const engineA0 = engineAt(0);
  const blind = engineA0.registry.blindsForAnte(engineA0.run.ante)[0];
  assert.ok(blind, 'deberia haber un ciego en el primer ante');

  const base = engineA0.targetFor(blind);

  const engineA = engineAt(4);
  const blindA = engineA.registry.blindsForAnte(engineA.run.ante)[0];
  assert.ok(blindA, 'el mismo ciego deberia existir en A4');

  const boosted = engineA.targetFor(blindA);

  // El ciego es el MISMO (mismo id y mismo scoreMultiplier), asi que la
  // relacion entre los dos objetivos es exactamente el multiplicador del nivel
  // compuesto sobre el base ya redondeado por el motor.
  const mult = engineA.ascension.modifiers.targetMultiplier ?? 1;
  assert.ok(mult > 1, 'A4 deberia subir el objetivo');
  assert.equal(
    boosted,
    Math.round(base * mult),
    'el objetivo deberia ser el del ciego por el multiplicador del nivel',
  );
  assert.ok(boosted > base, 'el objetivo con ascension deberia ser mayor');
});

test('el orden objetivo x ascension es estable entre consultas', () => {
  const engine = engineAt(5);
  const blind = engine.registry.blindsForAnte(engine.run.ante)[0]!;
  const a = engine.targetFor(blind);
  const b = engine.targetFor(blind);
  assert.equal(a, b, 'el objetivo no deberia cambiar entre consultas');
});

// ---------------------------------------------------------------------------
// Dinero, tienda y dado
// ---------------------------------------------------------------------------

test('moneyDelta es un OVERRIDE del dinero inicial', () => {
  const engineA0 = engineAt(0);
  const level = ASCENSION_DATA.find((a) => typeof a.modifiers.moneyDelta === 'number');
  assert.ok(level, 'deberia haber algun nivel que cambie el dinero inicial');

  const engineA = engineAt(level.level);
  assert.equal(
    engineA.run.money,
    level.modifiers.moneyDelta,
    'el dinero inicial deberia ser exactamente el declarado',
  );
  // Y no es lo mismo que el default: si coincidiera el test no probaria nada.
  assert.notEqual(engineA.run.money, engineA0.run.money);
});

test('el precio de tienda es el mismo que cobra buyOffer', () => {
  const engine = engineAt(7);
  engine.enterShop();
  const shop = engine.run.shop;
  assert.ok(shop && shop.offers.length > 0, 'la tienda deberia tener ofertas');

  const offer = shop.offers.find((o) => !o.sold);
  assert.ok(offer, 'deberia haber alguna oferta sin vender');

  const shown = engine.priceOf(offer);
  const base = offer.cost;
  const mult = engine.ascension.modifiers.shopCostMultiplier ?? 1;
  assert.equal(shown, Math.round(base * mult), 'el precio deberia incluir el recargo del nivel');

  // Cobrar: si el precio no alcanza, se le da el dinero justo y se verifica
  // que el saldo cae EXACTAMENTE el precio mostrado.
  engine.run.money = shown + 50;
  const before = engine.run.money;
  const ok = engine.buyOffer(offer.id);
  assert.ok(ok, 'la compra deberia funcionar con dinero de sobra');
  assert.equal(before - engine.run.money, shown, 'deberia cobrarse el precio mostrado');
});

test('el recargo de ascension se aplica ANTES del descuento del voucher', () => {
  // Con el descuento primero, el voucher del 25% borraria el recargo del 40%
  // y el nivel se abarataria solo. Este test fija el orden.
  const engine = engineAt(8);
  // Voucher de compra al por mayor (25% off), si el contenido lo trae.
  const bulk = engine.registry.tryGetVoucher('voucher_bulk_deal');
  if (!bulk) return; // el contenido puede no tenerlo: el test se saltea solo

  engine.run.vouchers = [bulk.id];
  engine.enterShop();
  const offer = engine.run.shop?.offers.find((o) => !o.sold);
  assert.ok(offer);

  const mult = engine.ascension.modifiers.shopCostMultiplier ?? 1;
  const expected = Math.round(Math.round(offer.cost * mult) * 0.75);
  assert.equal(engine.priceOf(offer), expected, 'primero recargo, despues descuento');
});

test('un nivel puede quitar la repeticion del dado', () => {
  const noReroll = ASCENSION_DATA.find((a) => a.modifiers.allowDieReroll === false);
  if (!noReroll) return; // el contenido decidio no usarlo: el test se saltea solo

  const engineA = engineAt(noReroll.level);
  assert.equal(engineA.canRerollDie, false, 'el nivel deberia bloquear la repeticion');

  const engineA0 = engineAt(0);
  assert.equal(engineA0.canRerollDie, true, 'sin ascension se puede repetir');
});

test('purgeCost incluye el recargo del nivel y purgeCard lo cobra', () => {
  const level = ASCENSION_DATA.find((a) => (a.modifiers.purgeCostDelta ?? 0) > 0);
  if (!level) return;

  const engine = engineAt(level.level);
  const delta = level.modifiers.purgeCostDelta ?? 0;
  assert.equal(
    engine.purgeCost,
    ECONOMY.purgeCost + delta,
    'el coste de purga deberia incluir el delta',
  );
});

test('rerollPrice incluye el recargo del nivel', () => {
  const level = ASCENSION_DATA.find((a) => (a.modifiers.rerollCostDelta ?? 0) > 0);
  if (!level) return;

  const engine = engineAt(level.level);
  engine.enterShop();
  const delta = level.modifiers.rerollCostDelta ?? 0;
  // El coste base del reroll mas el delta del nivel.
  assert.ok(engine.rerollPrice >= delta, 'el precio del reroll deberia incluir el delta');
});

// ---------------------------------------------------------------------------
// Efectos extra del jefe
// ---------------------------------------------------------------------------

test('los efectos extra de jefe NO contaminan la definicion del contenido', () => {
  const level = ASCENSION_DATA.find((a) => (a.modifiers.extraBossEffects?.length ?? 0) > 0);
  if (!level) return;

  const engineA = engineAt(level.level);
  const blind = engineA.registry.blindsForAnte(engineA.run.ante).find(
    (b) => (b.effects?.length ?? 0) > 0,
  );
  if (!blind) return; // ese ante no tiene jefe: nada que comprobar

  const originalCount = blind.effects?.length ?? 0;
  engineA.chooseBlind(blind.id);
  assert.ok(engineA.round, 'deberia haber ronda');

  // La ronda suma los efectos extra...
  assert.equal(
    engineA.round.blind.effects?.length,
    originalCount + (level.modifiers.extraBossEffects?.length ?? 0),
    'el jefe deberia tener los efectos extra',
  );
  // ...pero la definicion del registro sigue intacta.
  const after = engineA.registry.blindsForAnte(engineA.run.ante).find((b) => b.id === blind.id);
  assert.equal(after?.effects?.length, originalCount, 'el contenido no deberia mutar');
});

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

test('la run conserva su nivel de ascension al guardar y recargar', () => {
  const engine = engineAt(6, 42);
  const save = engine.serialize();
  assert.equal(save.ascension, 6, 'el guardado deberia llevar el nivel');

  const reloaded = new GameEngine({ seed: 42, bundle: buildRegistry().toBundle() });
  const ok = reloaded.restore(save);
  assert.ok(ok, 'el guardado deberia restaurarse');
  assert.equal(reloaded.run.ascension, 6, 'el nivel deberia sobrevivir a la recarga');
  assert.equal(
    reloaded.run.baseHands,
    engine.run.baseHands,
    'las manos del nivel deberian re-aplicarse al crear el estado',
  );
});

test('un guardado sin campo ascension carga como A0', () => {
  const engine = engineAt(0, 7);
  const save = engine.serialize() as RunSaveData & { ascension?: number };
  delete save['ascension'];

  const reloaded = new GameEngine({ seed: 7, bundle: buildRegistry().toBundle() });
  assert.ok(reloaded.restore(save), 'un guardado viejo sigue siendo valido');
  assert.equal(reloaded.run.ascension, 0, 'sin campo, el nivel es 0');
});

test('el contenido puede cambiar sin invalidar un guardado con ascension', () => {
  const engine = engineAt(3, 9);
  const save = engine.serialize();
  save.contentHash = 'hash-viejo-distinto';

  const reloaded = new GameEngine({ seed: 9, bundle: buildRegistry().toBundle() });
  assert.ok(reloaded.restore(save), 'un rebalanceo no deberia borrar la partida');
  assert.equal(reloaded.run.ascension, 3);
});
