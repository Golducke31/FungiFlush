/**
 * offers.test.ts — Sorteo de ofertas: determinismo e ids.
 *
 * Lo que se protege aca:
 *   - el sorteo es reproducible desde la semilla (si no, una partida guardada
 *     no se puede reanudar ni depurar),
 *   - los ids son unicos entre rerolls (si no, `buyOffer` compraria la oferta
 *     equivocada),
 *   - una fase sin tabla no rompe el juego.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CardRegistry } from '../src/engine/cards/CardRegistry.ts';
import { OfferService } from '../src/engine/offers/OfferService.ts';
import { RNG } from '../src/engine/rng.ts';
import type { CardDefinition, OfferTable, Rarity } from '../src/engine/index.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

const SHOP_TABLE: OfferTable = {
  id: 'test_shop',
  phase: 'shop',
  groups: [
    { count: 1, options: [{ weight: 1, kind: 'card' }] },
    {
      count: 1,
      options: [
        { weight: 1, kind: 'card' },
        { weight: 1, kind: 'joker' },
      ],
    },
    { count: 1, options: [{ weight: 1, kind: 'mutation' }] },
  ],
};

const REWARD_TABLE: OfferTable = {
  id: 'test_reward',
  phase: 'reward',
  groups: [{ count: 3, options: [{ weight: 1, kind: 'card' }] }],
  pick: 1,
  allowSkip: true,
};

function registryFromRealContent(): CardRegistry {
  const registry = new CardRegistry();
  registry.load(buildRegistry().toBundle());
  return registry;
}

function ctx(rng: RNG, sequence = 0) {
  return { rng, ante: 1, blindIndex: 0, sequence };
}

test('la tienda produce exactamente 3 ofertas con la tabla declarada', () => {
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  const offers = service.roll('test_shop', ctx(new RNG(1)));

  assert.equal(offers.length, 3);
  assert.equal(offers[0]?.kind, 'card');
  assert.equal(offers[2]?.kind, 'mutation');
  assert.ok(offers[1]?.kind === 'card' || offers[1]?.kind === 'joker');
});

test('el mismo seed produce la misma tienda (reproducibilidad)', () => {
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  const a = service.roll('test_shop', ctx(new RNG(4242)));
  const b = service.roll('test_shop', ctx(new RNG(4242)));

  assert.deepEqual(
    a.map((o) => `${o.kind}:${o.refId}`),
    b.map((o) => `${o.kind}:${o.refId}`),
  );
});

test('seeds distintos producen tiendas distintas (el sorteo no esta fijo)', () => {
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  const seen = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    const offers = service.roll('test_shop', ctx(new RNG(seed)));
    seen.add(offers.map((o) => `${o.kind}:${o.refId}`).join('|'));
  }
  assert.ok(seen.size > 5, `se esperaban tiendas variadas, hubo ${seen.size}`);
});

test('los ids son unicos entre rerolls de la misma tienda', () => {
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  const rng = new RNG(7);

  const first = service.roll('test_shop', ctx(rng, 0));
  const second = service.roll('test_shop', ctx(rng, 1));

  const ids = new Set([...first, ...second].map((o) => o.id));
  assert.equal(ids.size, first.length + second.length);
});

test('los ids no dependen del RNG (son deterministas)', () => {
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  const a = service.roll('test_shop', ctx(new RNG(11), 2));
  const b = service.roll('test_shop', ctx(new RNG(999), 2));

  assert.deepEqual(
    a.map((o) => o.id),
    b.map((o) => o.id),
  );
});

test('el draft de recompensa trae 3 cartas distintas', () => {
  const service = new OfferService(registryFromRealContent(), [REWARD_TABLE]);
  const offers = service.roll('test_reward', ctx(new RNG(3)));

  assert.equal(offers.length, 3);
  const ids = new Set(offers.map((o) => o.refId));
  assert.equal(ids.size, 3, 'el draft no deberia repetir carta');
});

test('una tabla con minAnte respeta el ante', () => {
  const table: OfferTable = {
    id: 'late_shop',
    phase: 'shop',
    groups: [{ count: 1, options: [{ weight: 1, kind: 'card', minAnte: 5 }] }],
  };
  const service = new OfferService(registryFromRealContent(), [table]);

  assert.equal(service.roll('late_shop', { ...ctx(new RNG(1)), ante: 1 }).length, 0);
  assert.equal(service.roll('late_shop', { ...ctx(new RNG(1)), ante: 5 }).length, 1);
});

test('una fase sin tabla devuelve vacio en vez de explotar', () => {
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  assert.deepEqual(service.rollPhase('reward', ctx(new RNG(1))), []);
  assert.equal(service.hasRewardTable, false);
});

test('una tabla inexistente devuelve vacio', () => {
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  assert.deepEqual(service.roll('no_existe', ctx(new RNG(1))), []);
});

test('el filtro de contenido se respeta en los sorteos', () => {
  // Con un filtro que rechaza todo, no hay cartas posibles: la tienda queda
  // sin la oferta de carta pero no explota.
  const service = new OfferService(registryFromRealContent(), [SHOP_TABLE]);
  const offers = service.roll('test_shop', {
    ...ctx(new RNG(5)),
    cardFilter: () => false,
  });

  assert.equal(offers.filter((o) => o.kind === 'card').length, 0);
});

test('rarityWeights de una opcion se aplica al sorteo', () => {
  const registry = new CardRegistry();
  const cards: CardDefinition[] = (['common', 'uncommon', 'rare'] as Rarity[]).map((rarity) => ({
    id: `t_${rarity}`,
    nameKey: `card.t_${rarity}.name`,
    descKey: `card.t_${rarity}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity,
    baseSubstrate: 10,
    baseSpores: 2,
    cost: 3,
    art: { hue: 100, pattern: 'radial' },
  }));
  registry.load({ cards, jokers: [], blinds: [] });

  const table: OfferTable = {
    id: 'rare_only',
    phase: 'reward',
    groups: [
      {
        count: 1,
        options: [
          { weight: 1, kind: 'card', rarityWeights: { common: 0, uncommon: 0, rare: 1 } },
        ],
      },
    ],
  };
  const service = new OfferService(registry, [table]);

  for (let seed = 1; seed <= 10; seed++) {
    const offers = service.roll('rare_only', ctx(new RNG(seed)));
    assert.equal(offers[0]?.refId, 't_rare');
  }
});

// ---------------------------------------------------------------------------
// Seleccion de tabla por ante (R4c)
// ---------------------------------------------------------------------------
//
// Una fase puede declarar VARIAS tablas con ventanas de ante que se solapan.
// `rollPhase` tiene que elegir la MAS ESPECIFICA que contenga el ante actual: la
// de ventana mas angosta. Sin esto, la tienda del ante 7 ofrecia lo mismo que la
// del ante 1 y el late-game no escalaba.

/** Tabla minima de una sola oferta de carta, para aislar la seleccion. */
function tableWithWindow(id: string, phase: 'shop' | 'reward', minAnte?: number, maxAnte?: number): OfferTable {
  return {
    id,
    phase,
    groups: [{ count: 1, options: [{ weight: 1, kind: 'card' }] }],
    ...(minAnte !== undefined ? { minAnte } : {}),
    ...(maxAnte !== undefined ? { maxAnte } : {}),
  };
}

test('rollPhase elige la tabla especifica del ante, no la primera', () => {
  const general = tableWithWindow('general', 'shop');
  const late = tableWithWindow('late', 'shop', 5);
  // A proposito la general va PRIMERO: si la seleccion fuera "la primera", el
  // test fallaria con el orden natural del contenido.
  const service = new OfferService(registryFromRealContent(), [general, late]);

  assert.equal(service.tableForPhase('shop', 1)?.id, 'general');
  assert.equal(service.tableForPhase('shop', 4)?.id, 'general');
  assert.equal(service.tableForPhase('shop', 5)?.id, 'late');
  assert.equal(service.tableForPhase('shop', 8)?.id, 'late');
});

test('gana la ventana mas angosta cuando dos tablas se solapan', () => {
  const broad = tableWithWindow('broad', 'shop', 1, 8);
  const narrow = tableWithWindow('narrow', 'shop', 6, 8);
  const service = new OfferService(registryFromRealContent(), [broad, narrow]);

  assert.equal(service.tableForPhase('shop', 3)?.id, 'broad');
  assert.equal(service.tableForPhase('shop', 6)?.id, 'narrow');
  assert.equal(service.tableForPhase('shop', 8)?.id, 'narrow');
});

test('una fase sin tabla aplicable devuelve null y no explota', () => {
  const soloLate = tableWithWindow('late_only', 'reward', 5);
  const service = new OfferService(registryFromRealContent(), [soloLate]);

  assert.equal(service.tableForPhase('reward', 1), null);
  assert.deepEqual(service.rollPhase('reward', ctx(new RNG(1), 0)), []);
  assert.equal(service.tableForPhase('shop', 1), null);
});

test('el contenido real trae una tabla de tienda de late-game', () => {
  const registry = registryFromRealContent();
  const service = new OfferService(registry, buildRegistry().toBundle().offers ?? []);

  const early = service.tableForPhase('shop', 1);
  const late = service.tableForPhase('shop', 7);
  assert.ok(early && late);
  assert.notEqual(early.id, late.id, 'el ante 7 no puede usar la tabla del ante 1');
});
