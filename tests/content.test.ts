/**
 * content.test.ts — Reglas de merge de packs, gating y determinismo.
 *
 * Son las reglas que sostienen la escalabilidad: si el merge dejara de ser
 * deterministico, un update de contenido cambiaria las partidas de la gente.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ContentRegistry } from '../src/content/ContentRegistry.ts';
import { parsePack } from '../src/content/parse.ts';
import { EntitlementStore } from '../src/meta/EntitlementStore.ts';
import { PackGate } from '../src/meta/PackGate.ts';
import type { CardDefinition, Rarity } from '../src/engine/index.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

function card(id: string, rarity: Rarity = 'common'): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity,
    baseSubstrate: 10,
    baseSpores: 2,
    cost: 3,
    art: { hue: 120, pattern: 'radial' },
  };
}

function pack(id: string, cards: CardDefinition[], overrides: Record<string, unknown> = {}) {
  return parsePack({
    manifest: {
      id,
      version: 1,
      kind: id === 'base' ? 'base' : 'expansion',
      priority: 0,
      titleKey: `pack.${id}.title`,
      contents: { cards: ['cards.json'], antes: ['antes.json'] },
      ...overrides,
    } as never,
    files: {
      'cards.json': cards,
      'antes.json': [{ ante: 1, baseTarget: 100 }],
    },
    origin: 'bundled',
  });
}

test('el merge respeta el orden: base antes que expansion', () => {
  const registry = new ContentRegistry('1.0.0');
  // Se cargan "en desorden" a proposito: el merge NO debe depender de esto.
  registry.add(pack('expansion_a', [card('a_card')]));
  registry.add(pack('base', [card('b_card')]));

  const ids = registry.toBundle().cards.map((c) => c.id);
  assert.deepEqual(ids, ['b_card', 'a_card']);
});

test('ante una colision de id gana el primero (base), y se reporta', () => {
  const registry = new ContentRegistry('1.0.0');
  registry.add(pack('base', [card('shared')]));
  registry.add(pack('expansion_a', [card('shared')]));

  const bundled = registry.toBundle();
  assert.equal(bundled.cards.filter((c) => c.id === 'shared').length, 1);
  const cardCollision = registry.collisions.filter((c) => c.kind === 'card');
  assert.equal(cardCollision.length, 1);
  assert.equal(cardCollision[0]?.winner, 'base');
  assert.equal(cardCollision[0]?.loser, 'expansion_a');
  assert.equal(registry.packOf('shared'), 'base');
});

test('allowOverride + version mayor si puede pisar', () => {
  const registry = new ContentRegistry('1.0.0');
  registry.add(pack('base', [card('shared')]));
  registry.add(
    pack('expansion_a', [card('shared')], {
      version: 2,
      gating: { allowOverride: true },
    }),
  );

  assert.equal(registry.packOf('shared'), 'expansion_a');
});

test('un pack que pide mas version de app se omite, no rompe', () => {
  const registry = new ContentRegistry('1.0.0');
  registry.add(pack('base', [card('b_card')]));
  registry.add(
    pack('expansion_a', [card('a_card')], { requires: { appMin: '2.0.0' } }),
  );

  assert.equal(registry.toBundle().cards.length, 1);
  assert.equal(registry.skipped.length, 1);
  assert.match(registry.skipped[0]?.reason ?? '', /requires app/);
});

test('un pack con dependencia faltante se omite', () => {
  const registry = new ContentRegistry('1.0.0');
  registry.add(pack('base', [card('b_card')]));
  registry.add(pack('expansion_a', [card('a_card')], { requires: { packs: ['base', 'nope'] } }));

  assert.equal(registry.skipped.some((s) => s.id === 'expansion_a'), true);
});

test('poolOf es estable: ordenado por id, no por orden de carga', () => {
  const a = new ContentRegistry('1.0.0');
  a.add(pack('base', [card('z_card'), card('a_card')]));

  const b = new ContentRegistry('1.0.0');
  b.add(pack('base', [card('a_card'), card('z_card')]));

  assert.deepEqual(
    a.poolOf('card').map((c) => c.id),
    b.poolOf('card').map((c) => c.id),
  );
  assert.deepEqual(a.poolOf('card').map((c) => c.id), ['a_card', 'z_card']);
});

test('el hash de contenido es estable y cambia con el contenido', () => {
  const a = new ContentRegistry('1.0.0');
  a.add(pack('base', [card('b_card')]));
  const b = new ContentRegistry('1.0.0');
  b.add(pack('base', [card('b_card')]));
  const c = new ContentRegistry('1.0.0');
  c.add(pack('base', [card('b_card'), card('c_card')]));

  assert.equal(a.contentHash(), b.contentHash());
  assert.notEqual(a.contentHash(), c.contentHash());
});

test('PackGate: el contenido sin entitlement no entra al bundle', () => {
  const registry = new ContentRegistry('1.0.0');
  registry.add(pack('base', [card('b_card')]));
  registry.add(pack('expansion_rotwood', [card('r_card')]));

  const owner = new EntitlementStore({ owned: ['pack.base'] });
  const gate = new PackGate(owner, registry);
  const bundle = registry.toBundle(gate);

  assert.deepEqual(bundle.cards.map((c) => c.id), ['b_card']);
  assert.equal(gate.contentState('r_card'), 'locked');

  // Contenido bloqueado pero VISIBLE: es la superficie de venta.
  const locked = gate.lockedContent();
  assert.equal(locked.length, 1);
  assert.equal(locked[0]?.packId, 'expansion_rotwood');

  owner.grant('pack.expansion_rotwood');
  assert.equal(gate.contentState('r_card'), 'allowed');
  assert.equal(registry.toBundle(gate).cards.length, 2);
});

test('PackGate: lockedVisibility hidden lo saca tambien de la lista', () => {
  const registry = new ContentRegistry('1.0.0');
  registry.add(pack('base', [card('b_card')]));
  registry.add(
    pack('expansion_secret', [card('s_card')], {
      gating: { lockedVisibility: 'hidden' },
    }),
  );

  const gate = new PackGate(new EntitlementStore({ owned: ['pack.base'] }), registry);
  assert.equal(gate.contentState('s_card'), 'hidden');
  assert.equal(gate.lockedContent().length, 0);
});

test('la tabla de antes es data-driven y extrapola', () => {
  const registry = new ContentRegistry('1.0.0');
  registry.add(pack('base', [card('b_card')]));
  assert.equal(registry.anteTarget(1), 100);
  // Definido hasta 1: el 2 se extrapola x2.4.
  assert.equal(registry.anteTarget(2), 240);
  assert.equal(registry.maxAnte(), 1);
});

test('el pack base real carga con el contenido esperado', () => {
  const registry = buildRegistry();
  const bundle = registry.toBundle();
  // 34 cartas base + 5 formas evolucionadas (solo obtenibles evolucionando)
  // + 10 cartas de arquetipo (puente, motores por elemento y comodin)
  // + 16 cartas puente que cruzan elemento y familia (el eje que antes era 1:1).
  assert.equal(bundle.cards.length, 65);
  assert.equal(bundle.cards.filter((c) => (c.tags ?? []).includes('evolved')).length, 5);
  assert.equal(bundle.blinds.length, 24);
  // 18 + el legendario del dado (`joker_loaded_die`).
  assert.equal(bundle.jokers.length, 25);
  assert.equal(bundle.upgrades?.length, 1);
  assert.equal(bundle.evolutions?.length, 5);
  assert.equal(registry.anteTarget(8), 180000);
  assert.equal(registry.maxAnte(), 8);
  assert.equal(registry.validate().filter((i) => i.level === 'error').length, 0);
});
