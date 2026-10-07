/**
 * packs.test.ts — Sorteo de sobres y su inventario.
 *
 * La regla que estos tests protegen: un sobre es DETERMINISTA con la misma
 * semilla (todo el azar sale del `RNG` que entra), no repite carta si el pool
 * alcanza, y las rarezas salen del conjunto ponderado esperado. Si eso se
 * rompe, la economia meta deja de ser reproducible y la coleccion se vuelve
 * injusta (dos jugadores con la misma semilla sacan cosas distintas).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RNG } from '../src/engine/rng.ts';
import {
  BOSS_PACK_DROP_CHANCE,
  DEFAULT_CARDS_PER_PACK,
  PACK_PITY_AFTER,
  PACK_RARITY_ORDER,
  PACK_RARITY_WEIGHTS,
  consumeExpansionPack,
  consumePack,
  defaultPackInventory,
  drawPack,
  grantExpansionPack,
  grantPack,
  rollPackDrop,
  rollPackKind,
} from '../src/meta/Packs.ts';

const POOL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

test('los pesos de rareza suman 100', () => {
  const total = PACK_RARITY_ORDER.reduce((sum, rarity) => sum + PACK_RARITY_WEIGHTS[rarity], 0);
  assert.equal(total, 100);
  // El orden va de comun a epica, y la comun pesa mas que la epica.
  assert.deepEqual(PACK_RARITY_ORDER, ['comun', 'rara', 'epica']);
  assert.ok(PACK_RARITY_WEIGHTS.comun > PACK_RARITY_WEIGHTS.rara);
  assert.ok(PACK_RARITY_WEIGHTS.rara > PACK_RARITY_WEIGHTS.epica);
});

test('drawPack es determinista con la misma semilla', () => {
  const first = drawPack(new RNG(1234), POOL);
  const second = drawPack(new RNG(1234), POOL);
  assert.deepEqual(first, second);

  // Y una semilla distinta (casi siempre) da otro sobre: si no, la semilla no
  // estaria haciendo nada.
  const other = drawPack(new RNG(5678), POOL);
  assert.notDeepEqual(first, other);
});

test('drawPack sortea la cantidad pedida (default 5)', () => {
  assert.equal(drawPack(new RNG(1), POOL).length, DEFAULT_CARDS_PER_PACK);
  assert.equal(drawPack(new RNG(1), POOL, 3).length, 3);
  assert.equal(drawPack(new RNG(1), POOL, 0).length, 0);
});

test('drawPack no repite cartas si el pool alcanza', () => {
  const cards = drawPack(new RNG(42), POOL, DEFAULT_CARDS_PER_PACK);
  const ids = cards.map((card) => card.cardId);
  assert.equal(new Set(ids).size, ids.length, 'no debe haber cardIds repetidos');

  // Un pool chico: entrega lo que hay, sin inventar repetidos.
  const small = drawPack(new RNG(42), ['x', 'y'], 5);
  assert.equal(small.length, 2);
  assert.deepEqual(new Set(small.map((card) => card.cardId)), new Set(['x', 'y']));
});

test('un pool vacio devuelve un sobre vacio', () => {
  assert.deepEqual(drawPack(new RNG(7), []), []);
  // Sin pool no se gasta azar: la semilla queda intacta para el proximo uso.
  const rng = new RNG(7);
  drawPack(rng, []);
  assert.equal(rng.getSeed(), new RNG(7).getSeed());
});

test('las rarezas sorteadas pertenecen al conjunto esperado', () => {
  const rng = new RNG(2026);
  for (let pack = 0; pack < 50; pack++) {
    for (const card of drawPack(rng, POOL)) {
      assert.ok(PACK_RARITY_ORDER.includes(card.rarity), `rareza inesperada: ${card.rarity}`);
      assert.ok(POOL.includes(card.cardId), `cardId fuera del pool: ${card.cardId}`);
    }
  }
});

test('todas las rarezas aparecen en una muestra grande', () => {
  // Con 70/22/8, 2000 cartas hacen practicamente imposible perder una rareza.
  const rng = new RNG(99);
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    for (const card of drawPack(rng, POOL)) seen.add(card.rarity);
  }
  for (const rarity of PACK_RARITY_ORDER) {
    assert.ok(seen.has(rarity), `nunca salio la rareza ${rarity}`);
  }
});

test('grantPack suma pendientes y devuelve el total', () => {
  const inv = defaultPackInventory();
  assert.equal(inv.pending, 0);
  assert.equal(inv.opened, 0);

  assert.equal(grantPack(inv), 1);
  assert.equal(inv.pending, 1);
  assert.equal(grantPack(inv, 3), 4);
  assert.equal(inv.pending, 4);
  // Un conteo no positivo no rompe el inventario.
  assert.equal(grantPack(inv, 0), 4);
  assert.equal(grantPack(inv, -5), 4);
});

test('consumePack descuenta y cuenta los abiertos; sin pendientes falla', () => {
  const inv = defaultPackInventory();
  // Sin pendientes no hay nada que abrir.
  assert.equal(consumePack(inv), false);
  assert.equal(inv.pending, 0);
  assert.equal(inv.opened, 0);

  grantPack(inv, 2);
  assert.equal(consumePack(inv), true);
  assert.equal(inv.pending, 1);
  assert.equal(inv.opened, 1);

  assert.equal(consumePack(inv), true);
  assert.equal(inv.pending, 0);
  // `opened` es de por vida: no se resta al gastar pendientes.
  assert.equal(inv.opened, 2);

  assert.equal(consumePack(inv), false);
  assert.equal(inv.opened, 2);
});

// ---------------------------------------------------------------------------
// Drop de Jefes (rollPackDrop) — los sobres ya no caen en cualquier ciego
// ---------------------------------------------------------------------------

test('rollPackDrop es determinista con la misma semilla', () => {
  const a = rollPackDrop(new RNG(99), 0);
  const b = rollPackDrop(new RNG(99), 0);
  assert.deepEqual(a, b);
});

test('rollPackDrop: con chance 0 nunca cae y acumula fallos', () => {
  const rng = new RNG(1);
  let misses = 0;
  for (let i = 0; i < 5; i++) {
    const roll = rollPackDrop(rng, misses, 0, 99);
    assert.equal(roll.drop, false);
    misses = roll.misses;
  }
  assert.equal(misses, 5);
});

test('rollPackDrop: con chance 1 siempre cae y resetea el contador', () => {
  const rng = new RNG(1);
  const roll = rollPackDrop(rng, 3, 1, 99);
  assert.equal(roll.drop, true);
  assert.equal(roll.misses, 0);
});

test('rollPackDrop: el pity garantiza el sobre tras PACK_PITY_AFTER fallos', () => {
  const rng = new RNG(7);
  // Con chance 0 solo el pity puede entregarlo.
  assert.equal(rollPackDrop(rng, 0, 0, PACK_PITY_AFTER).drop, false);
  assert.equal(rollPackDrop(rng, 1, 0, PACK_PITY_AFTER).drop, false);
  const pity = rollPackDrop(rng, PACK_PITY_AFTER, 0, PACK_PITY_AFTER);
  assert.equal(pity.drop, true);
  // Al caer, el contador vuelve a cero.
  assert.equal(pity.misses, 0);
});

test('rollPackDrop: un contador basura se trata como cero', () => {
  const roll = rollPackDrop(new RNG(3), -4, 1, PACK_PITY_AFTER);
  assert.equal(roll.drop, true);
  assert.equal(roll.misses, 0);
});

test('BOSS_PACK_DROP_CHANCE y el pity tienen los valores calibrados', () => {
  assert.equal(BOSS_PACK_DROP_CHANCE, 0.5);
  assert.equal(PACK_PITY_AFTER, 2);
});

test('rollPackKind: con expansionShare 1 es expansion; con 0 es base', () => {
  assert.equal(rollPackKind(new RNG(5), 1), 'expansion');
  assert.equal(rollPackKind(new RNG(5), 0), 'base');
});

// ---------------------------------------------------------------------------
// Sobre de expansion: inventario propio
// ---------------------------------------------------------------------------

test('el inventario arranca con los dos tipos de sobre y el pity en cero', () => {
  assert.deepEqual(defaultPackInventory(), {
    pending: 0,
    opened: 0,
    expansionPending: 0,
    expansionOpened: 0,
    bossMisses: 0,
  });
});

test('grant/consume del sobre de expansion es independiente del base', () => {
  const inv = defaultPackInventory();
  grantExpansionPack(inv, 2);
  assert.equal(inv.expansionPending, 2);
  // No toca el contador base.
  assert.equal(inv.pending, 0);
  assert.equal(consumeExpansionPack(inv), true);
  assert.equal(inv.expansionPending, 1);
  assert.equal(inv.expansionOpened, 1);
  assert.equal(consumeExpansionPack(inv), true);
  assert.equal(consumeExpansionPack(inv), false);
  assert.equal(inv.expansionOpened, 2);
  assert.equal(inv.opened, 0);
});
