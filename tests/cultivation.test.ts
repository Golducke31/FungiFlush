/**
 * cultivation.test.ts — Mejoras ilimitadas y cartas evolutivas.
 *
 * El test mas importante de este archivo es el de REGRESION de `LEVEL_UP_CARD`:
 * la version anterior mutaba la carta dentro del handler, y como el HUD llama a
 * `previewSelection()` (que corre en dryRun) en cada cambio de estado, una carta
 * con ese efecto se mejoraba sola con solo pasar el mouse por encima.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { CardRegistry } from '../src/engine/cards/CardRegistry.ts';
import { EvolutionService } from '../src/engine/evolution/EvolutionService.ts';
import { UpgradeService } from '../src/engine/upgrades/UpgradeService.ts';
import { RNG } from '../src/engine/rng.ts';
import type {
  CardDefinition,
  CardInstance,
  ContentBundle,
  EvolutionRule,
  UpgradeTrack,
} from '../src/engine/index.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRACK: UpgradeTrack = {
  id: 'test_track',
  baseCost: 4,
  growth: 1.5,
  maxLevel: 0,
  substratePerLevel: 3,
  sporesPerLevel: 1,
  levelScaling: true,
  rarityCostMultiplier: { common: 1, rare: 2 },
};

function card(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    nameKey: `card.${id}.name`,
    descKey: `card.${id}.desc`,
    element: 'neutral',
    family: 'agaricaceae',
    rarity: 'common',
    baseSubstrate: 5,
    baseSpores: 1,
    cost: 3,
    art: { hue: 100, pattern: 'radial' },
    ...overrides,
  };
}

function instance(def: CardDefinition, registry: CardRegistry): CardInstance {
  return registry.instantiateFrom(def);
}

function registryWith(cards: CardDefinition[]): CardRegistry {
  const registry = new CardRegistry();
  registry.load({ cards, jokers: [], blinds: [] });
  return registry;
}

// ---------------------------------------------------------------------------
// UpgradeService
// ---------------------------------------------------------------------------

test('el coste arranca en baseCost y crece geometricamente', () => {
  const service = new UpgradeService([TRACK]);
  const registry = registryWith([card('a')]);
  const target = instance(registry.getCard('a'), registry);

  const costs: number[] = [];
  for (let level = 1; level <= 6; level++) {
    target.level = level;
    costs.push(service.costFor(target));
  }

  assert.deepEqual(costs, [4, 6, 9, 14, 21, 31]);
  // Estrictamente creciente: nunca hay un nivel que salga "gratis".
  for (let i = 1; i < costs.length; i++) {
    assert.ok((costs[i] ?? 0) > (costs[i - 1] ?? 0));
  }
});

test('la rareza encarece la mejora', () => {
  const service = new UpgradeService([TRACK]);
  const registry = registryWith([card('comun'), card('rara', { rarity: 'rare' })]);
  const comun = instance(registry.getCard('comun'), registry);
  const rara = instance(registry.getCard('rara'), registry);

  assert.equal(service.costFor(comun), 4);
  assert.equal(service.costFor(rara), 8);
});

test('maxLevel 0 significa sin techo; un maxLevel explicito corta', () => {
  const unlimited = new UpgradeService([TRACK]);
  const capped = new UpgradeService([{ ...TRACK, maxLevel: 3 }]);
  const registry = registryWith([card('a')]);
  const target = instance(registry.getCard('a'), registry);

  target.level = 50;
  assert.equal(unlimited.quote(target)?.atMaxLevel, false);

  target.level = 3;
  assert.equal(capped.quote(target)?.atMaxLevel, true);
  assert.equal(capped.quote(target)?.cost, 0);
});

test('levelScaling hace que cada nivel valga mas que el anterior', () => {
  const service = new UpgradeService([TRACK]);
  const registry = registryWith([card('a')]);
  const target = instance(registry.getCard('a'), registry);

  target.level = 1;
  assert.equal(service.gains(target, 1).substrate, 3 + 2);
  target.level = 5;
  assert.equal(service.gains(target, 1).substrate, 3 + 6);
  assert.equal(service.gains(target, 2).substrate, 3 + 6 + 3 + 7);
});

test('apply muta la carta una sola vez por nivel pedido', () => {
  const service = new UpgradeService([TRACK]);
  const registry = registryWith([card('a')]);
  const target = instance(registry.getCard('a'), registry);

  service.apply(target, 3);
  assert.equal(target.level, 4);
  // 1->2: +5, 2->3: +6, 3->4: +7
  assert.equal(target.bonusSubstrate, 5 + 6 + 7);
  assert.equal(target.bonusSpores, 3);
});

// ---------------------------------------------------------------------------
// EvolutionService
// ---------------------------------------------------------------------------

const EVOLUTION: EvolutionRule = {
  id: 'evo_test',
  from: 'base_card',
  to: 'evolved_card',
  require: { type: 'level', value: 3 },
  keep: { bonuses: true, level: 'carry', statuses: true },
};

function evolutionFixture() {
  const registry = registryWith([
    card('base_card'),
    card('evolved_card', { rarity: 'uncommon', baseSubstrate: 12 }),
    card('other_card'),
  ]);
  const service = new EvolutionService([EVOLUTION], registry);
  return { registry, service };
}

test('la evolucion no esta disponible hasta cumplir el requisito', () => {
  const { registry, service } = evolutionFixture();
  const target = instance(registry.getCard('base_card'), registry);

  target.level = 2;
  assert.equal(service.availableFor(target), null);

  target.level = 3;
  assert.equal(service.availableFor(target)?.rule.id, 'evo_test');
});

test('los requisitos compuestos (all / any) se evaluan bien', () => {
  const registry = registryWith([card('base_card'), card('evolved_card')]);
  const both = new EvolutionService(
    [{ ...EVOLUTION, require: { type: 'all', conds: [{ type: 'level', value: 3 }, { type: 'plays', value: 5 }] } }],
    registry,
  );
  const either = new EvolutionService(
    [{ ...EVOLUTION, require: { type: 'any', conds: [{ type: 'level', value: 3 }, { type: 'plays', value: 5 }] } }],
    registry,
  );

  const target = instance(registry.getCard('base_card'), registry);
  target.level = 3;
  target.plays = 1;

  assert.equal(both.availableFor(target), null, 'all: falta plays');
  assert.equal(either.availableFor(target)?.rule.id, 'evo_test', 'any: alcanza el nivel');
});

test('evolucionar conserva el uid y el nivel (uid = identidad en el mazo)', () => {
  const { registry, service } = evolutionFixture();
  const target = instance(registry.getCard('base_card'), registry);
  target.level = 4;
  target.bonusSubstrate = 20;
  const uid = target.uid;

  const previousId = service.apply(target, EVOLUTION);

  assert.equal(previousId, 'base_card');
  assert.equal(target.uid, uid);
  assert.equal(target.def.id, 'evolved_card');
  assert.equal(target.level, 4);
  assert.equal(target.bonusSubstrate, 20);
  assert.equal(target.evolvedFrom, 'base_card');
});

test('keep.level reset y statuses false se respetan', () => {
  const registry = registryWith([card('base_card'), card('evolved_card')]);
  const resetRule: EvolutionRule = {
    ...EVOLUTION,
    keep: { level: 'reset', statuses: false, bonuses: false },
  };
  const service = new EvolutionService([resetRule], registry);
  const target = instance(registry.getCard('base_card'), registry);
  target.level = 5;
  target.bonusSpores = 9;
  target.statuses = [{ type: 'decay', value: 1, turnsLeft: -1 }];

  service.apply(target, resetRule);

  assert.equal(target.level, 1);
  assert.equal(target.bonusSpores, 0);
  assert.deepEqual(target.statuses, []);
});

test('una evolucion a una carta inexistente se ignora, no rompe', () => {
  const registry = registryWith([card('base_card')]);
  const service = new EvolutionService([EVOLUTION], registry);
  const target = instance(registry.getCard('base_card'), registry);
  target.level = 9;

  assert.deepEqual(service.optionsFor(target), []);
  assert.equal(service.availableFor(target), null);
  assert.equal(service.apply(target, EVOLUTION), null);
  assert.equal(target.def.id, 'base_card');
});

// ---------------------------------------------------------------------------
// Integracion con el motor
// ---------------------------------------------------------------------------

function engineFixture() {
  const cards: CardDefinition[] = [
    card('upgrader', {
      tags: ['starter'],
      copies: 6,
      effects: [
        {
          id: 'self_grow',
          trigger: 'ON_PLAY',
          actions: [{ type: 'LEVEL_UP_CARD', value: 1 }],
        },
      ],
    }),
    card('filler', { tags: ['starter'], copies: 6 }),
    card('evolved_card', { rarity: 'uncommon', baseSubstrate: 12, tags: ['evolved'] }),
  ];

  const bundle: ContentBundle = {
    cards,
    jokers: [],
    blinds: [
      { id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 },
      { id: 'b2', nameKey: 'blind.b2.name', descKey: 'blind.b2.desc', ante: 1, scoreMultiplier: 1.5, reward: 4 },
      { id: 'b3', nameKey: 'blind.b3.name', descKey: 'blind.b3.desc', ante: 1, scoreMultiplier: 2, reward: 5 },
    ],
    anteTargets: { 1: 100 },
    upgrades: [TRACK],
    // La regla tiene que salir de la carta que existe en ESTE fixture
    // ("upgrader"), no de la del fixture de EvolutionService.
    evolutions: [
      {
        id: 'evo_upgrader',
        from: 'upgrader',
        to: 'evolved_card',
        require: { type: 'level', value: 3 },
        keep: { bonuses: true, level: 'carry', statuses: true },
      },
    ],
    offers: [
      {
        id: 'test_shop',
        phase: 'shop',
        groups: [
          {
            count: 3,
            options: [{ weight: 1, kind: 'card', excludeTag: 'evolved' }],
          },
        ],
      },
    ],
  };

  const engine = new GameEngine({ seed: 7, bundle });
  return engine;
}

test('REGRESION: previsualizar el score NO mejora la carta', () => {
  const engine = engineFixture();
  engine.startRun(7);
  engine.chooseBlind('b1');

  const hand = engine.round?.hand ?? [];
  const upgrader = hand.find((c) => c.def.id === 'upgrader');
  assert.ok(upgrader, 'la mano deberia tener la carta que se mejora sola');

  const levelBefore = upgrader.level;

  // El HUD hace exactamente esto en cada cambio de estado.
  for (let i = 0; i < 5; i++) engine.previewSelection();

  assert.equal(upgrader.level, levelBefore, 'un dryRun no puede mutar la carta');
});

test('jugar la mano SI mejora la carta', () => {
  const engine = engineFixture();
  engine.startRun(7);
  engine.chooseBlind('b1');

  const hand = engine.round?.hand ?? [];
  const upgrader = hand.find((c) => c.def.id === 'upgrader');
  assert.ok(upgrader);

  const levelBefore = upgrader.level;
  const substrateBefore = upgrader.bonusSubstrate;

  engine.toggleSelect(upgrader.uid);
  engine.playHand();

  assert.equal(upgrader.level, levelBefore + 1);
  assert.ok(upgrader.bonusSubstrate > substrateBefore);
  assert.equal(engine.run.stats.cardsUpgraded, 1);
});

test('mejorar y evolucionar solo se permiten entre blinds o en la tienda', () => {
  const engine = engineFixture();
  engine.startRun(7);
  engine.chooseBlind('b1');

  const card = engine.run.deck.allCards[0];
  assert.ok(card);

  // En plena mano no se edita el mazo.
  assert.equal(engine.canEditDeck(), false);
  assert.equal(engine.upgradeCard(card.uid), false);
  assert.equal(engine.evolveCard(card.uid), false);
});

test('el contador de jugadas alimenta las evoluciones por uso', () => {
  const engine = engineFixture();
  engine.startRun(7);
  engine.chooseBlind('b1');

  const filler = engine.round?.hand.find((c) => c.def.id === 'filler');
  assert.ok(filler);
  assert.equal(filler.plays ?? 0, 0);

  engine.toggleSelect(filler.uid);
  engine.playHand();

  assert.equal(filler.plays, 1);
});

test('la tienda nunca ofrece cartas evolucionadas', () => {
  const engine = engineFixture();
  engine.startRun(7);
  engine.chooseBlind('b1');
  engine.enterShop();

  const offers = engine.run.shop?.offers ?? [];
  assert.ok(offers.length > 0, 'la tienda deberia tener ofertas');
  assert.equal(
    offers.some((o) => o.refId === 'evolved_card'),
    false,
    'una carta evolucionada solo se consigue evolucionando',
  );
});

test('la evolucion esta lista cuando la carta alcanza el nivel', () => {
  const engine = engineFixture();
  engine.startRun(7);
  engine.chooseBlind('b1');

  const base = engine.run.deck.allCards.find((c) => c.def.id === 'upgrader');
  assert.ok(base);

  base.level = 2;
  assert.equal(engine.evolutionReady().length, 0);

  base.level = 3;
  assert.equal(engine.evolutionReady().length, 1);
});

test('un RNG fijo hace reproducible la evolucion (uid y resultado)', () => {
  const a = engineFixture();
  const b = engineFixture();
  for (const engine of [a, b]) {
    engine.startRun(7);
    engine.chooseBlind('b1');
    // Editar el mazo solo se permite entre blinds o en la tienda.
    engine.enterShop();
  }

  const cardA = a.run.deck.allCards.find((c) => c.def.id === 'upgrader');
  const cardB = b.run.deck.allCards.find((c) => c.def.id === 'upgrader');
  assert.ok(cardA && cardB);

  cardA.level = 3;
  cardB.level = 3;
  assert.equal(a.evolveCard(cardA.uid), true);
  assert.equal(b.evolveCard(cardB.uid), true);
  assert.equal(cardA.def.id, cardB.def.id);
  assert.equal(cardA.uid, cardB.uid);
  assert.equal(new RNG(1).int(0, 10), new RNG(1).int(0, 10));
});
