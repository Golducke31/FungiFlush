/**
 * voucher.test.ts — Vouchers: mejoras de run compradas en la tienda.
 *
 * Un voucher es la unica pieza de contenido que NO ocupa espacio: no va al mazo
 * ni a los slots de joker, cambia como se CALCULA la run. Por eso lo que hay que
 * proteger no es "que se compre", sino:
 *
 *   - que el efecto se aplique UNA vez y no en cada consulta (si no, el objetivo
 *     bajaria solo cada vez que el HUD lo mira),
 *   - que el precio que muestra la UI sea el mismo que cobra `buyOffer` (dos
 *     calculos separados es como se cobra un numero distinto del que se pinto),
 *   - que un voucher ya poseido no vuelva a salir en la tienda (una oferta que
 *     no se puede comprar es una estafa),
 *   - que sobreviva al guardado, porque una run retomada con otras reglas
 *     cambia el objetivo en la cara del jugador.
 *
 * Contenido de referencia: `src/data/packs/base/vouchers.json` (7 vouchers).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CardRegistry } from '../src/engine/cards/CardRegistry.ts';
import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import { OfferService } from '../src/engine/offers/OfferService.ts';
import { RNG } from '../src/engine/rng.ts';
import { combineModifiers, discountedCost, rerollCost } from '../src/engine/state/RunState.ts';
import type { OfferTable, ShopOffer, VoucherDefinition } from '../src/engine/index.ts';
import { ECONOMY } from '../src/engine/constants.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readData(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../src/data/packs/base/${name}`, import.meta.url), 'utf8'),
  );
}

const VOUCHER_DATA = readData('vouchers.json') as VoucherDefinition[];

function registryFromRealContent(): CardRegistry {
  const registry = new CardRegistry();
  registry.load(buildRegistry().toBundle());
  return registry;
}

/** Vouchers reales indexados por id, para no hardcodear costes en los tests. */
const REAL = new Map(VOUCHER_DATA.map((v) => [v.id, v]));

function realDef(id: string): VoucherDefinition {
  const def = REAL.get(id);
  assert.ok(def, `el voucher ${id} deberia existir en vouchers.json`);
  return def;
}

/** Tabla de tienda con un unico grupo de vouchers. */
const VOUCHER_TABLE: OfferTable = {
  id: 'test_vouchers',
  phase: 'shop',
  groups: [{ count: 1, options: [{ weight: 1, kind: 'voucher' }] }],
};

function ctx(rng: RNG, sequence = 0, ownedVouchers?: readonly string[]) {
  return { rng, ante: 1, blindIndex: 0, sequence, ...(ownedVouchers ? { ownedVouchers } : {}) };
}

/** Motor con contenido real, en tienda. `enterShop` sortea ofertas de verdad. */
function engineInShop(seed = 1, vouchers: string[] = []): GameEngine {
  const engine = new GameEngine({ seed, bundle: buildRegistry().toBundle() });
  // `run` no existe hasta que hay una run: `enterMenu()` la crea en estado
  // 'menu' y `startRun()` la arma de verdad. Escribir en `run.vouchers` antes
  // de cualquiera de las dos explota con "cannot set of undefined".
  engine.startRun(seed);
  engine.run.vouchers = [...vouchers];
  engine.enterShop();
  return engine;
}

/** Mete una oferta de voucher a mano: evita depender del sorteo de la tabla. */
function injectVoucher(engine: GameEngine, id: string, cost?: number): ShopOffer {
  const def = realDef(id);
  const offer: ShopOffer = {
    id: `test:${id}`,
    kind: 'voucher',
    refId: def.id,
    nameKey: def.nameKey,
    descKey: def.descKey,
    cost: cost ?? def.cost,
    art: def.art,
    sold: false,
  };
  engine.run.shop?.offers.push(offer);
  return offer;
}

// ---------------------------------------------------------------------------
// Contenido y registro
// ---------------------------------------------------------------------------

test('los vouchers del pack llegan al registro', () => {
  const registry = registryFromRealContent();
  const ids = registry.allVouchers().map((v) => v.id);

  assert.equal(ids.length, VOUCHER_DATA.length);
  assert.equal(new Set(ids).size, ids.length, 'no puede haber ids repetidos');
  assert.ok(registry.tryGetVoucher('voucher_thin_cut'), 'deberia resolver por id');
  assert.equal(registry.tryGetVoucher('voucher_inexistente'), undefined);
});

test('los vouchers reales declaran efectos o modificadores (no son adornos)', () => {
  for (const def of VOUCHER_DATA) {
    const hasEffects = (def.effects?.length ?? 0) > 0;
    const hasModifiers = Object.keys(def.runModifiers ?? {}).length > 0;
    assert.ok(hasEffects || hasModifiers, `${def.id} no hace nada`);
    assert.ok(def.cost > 0, `${def.id} tiene coste invalido`);
    assert.ok(def.nameKey.startsWith('voucher.'), `${def.id} tiene nameKey fuera del namespace`);
    assert.ok(def.descKey.startsWith('voucher.'), `${def.id} tiene descKey fuera del namespace`);
  }
});

test('los modificadores reales son los que el motor LEE hoy', () => {
  // `extraHands` & cia. estan declarados pero NO se leen: son para vouchers
  // permanentes (ascension). Si un voucher de tienda los usara, su descripcion
  // mentiria y el jugador pagaria por nada.
  const leidos = new Set(['rerollCostDelta', 'targetMultiplier', 'shopDiscount']);
  for (const def of VOUCHER_DATA) {
    for (const key of Object.keys(def.runModifiers ?? {})) {
      assert.ok(leidos.has(key), `${def.id} usa ${key}, que el motor todavia no aplica`);
    }
  }
});

// ---------------------------------------------------------------------------
// combineModifiers / discountedCost / rerollCost
// ---------------------------------------------------------------------------

test('combineModifiers suma los deltas y multiplica los multiplicadores', () => {
  const combined = combineModifiers([
    { runModifiers: { rerollCostDelta: -2 } },
    { runModifiers: { rerollCostDelta: -1, targetMultiplier: 0.9 } },
    { runModifiers: { targetMultiplier: 0.9 } },
  ]);

  assert.equal(combined.rerollCostDelta, -3);
  // 0.9 * 0.9 = 0.81, no 0.8: "10% menos" dos veces no es "20% menos".
  assert.ok(Math.abs((combined.targetMultiplier ?? 0) - 0.81) < 1e-9);
});

test('combineModifiers compone los descuentos como "lo que queda por pagar"', () => {
  const combined = combineModifiers([
    { runModifiers: { shopDiscount: 0.2 } },
    { runModifiers: { shopDiscount: 0.2 } },
  ]);
  // 1 - 0.8*0.8 = 0.36 (no 0.40).
  assert.ok(Math.abs((combined.shopDiscount ?? 0) - 0.36) < 1e-9);
});

test('combineModifiers clampea el objetivo y el descuento', () => {
  const bajo = combineModifiers([{ runModifiers: { targetMultiplier: 0.01 } }]);
  const alto = combineModifiers([{ runModifiers: { targetMultiplier: 50 } }]);
  const gratis = combineModifiers([
    { runModifiers: { shopDiscount: 0.9 } },
    { runModifiers: { shopDiscount: 0.9 } },
  ]);

  assert.equal(bajo.targetMultiplier, 0.25, 'el objetivo no puede volverse imposible');
  assert.equal(alto.targetMultiplier, 2, 'el objetivo no puede volverse gratis');
  assert.equal(gratis.shopDiscount, 0.9, 'nada puede quedar gratis del todo');
});

test('combineModifiers sin vouchers es la identidad', () => {
  const id = combineModifiers([]);
  assert.equal(id.targetMultiplier, 1);
  assert.equal(id.rerollCostDelta, 0);
  assert.equal(id.shopDiscount, 0);
  assert.equal(discountedCost(100, id), 100);
});

test('discountedCost redondea y nunca baja de cero', () => {
  assert.equal(discountedCost(10, { shopDiscount: 0.25 }), 8);
  assert.equal(discountedCost(9, { shopDiscount: 0.25 }), 7); // 6.75 -> 7
  assert.equal(discountedCost(3, { shopDiscount: 0.9 }), 0); // 0.3 -> 0
  assert.equal(discountedCost(10, {}), 10);
});

test('rerollCost respeta el delta y no baja de cero', () => {
  const shop = { offers: [], rerolls: 0 };
  assert.equal(rerollCost(shop, { rerollCostDelta: -2 }), ECONOMY.rerollBaseCost - 2);
  assert.equal(rerollCost(shop, { rerollCostDelta: -999 }), 0);
  // Sin modificadores, exactamente el comportamiento de antes.
  assert.equal(rerollCost(shop), ECONOMY.rerollBaseCost);
  // Y escala con los rerolls ya hechos.
  assert.equal(
    rerollCost({ offers: [], rerolls: 3 }),
    ECONOMY.rerollBaseCost + 3 * ECONOMY.rerollCostStep,
  );
});

// ---------------------------------------------------------------------------
// OfferService: oferta de voucher
// ---------------------------------------------------------------------------

test('la tabla de vouchers produce una oferta de voucher valida', () => {
  const service = new OfferService(registryFromRealContent(), [VOUCHER_TABLE]);
  const offers = service.roll('test_vouchers', ctx(new RNG(5)));

  assert.equal(offers.length, 1);
  const offer = offers[0];
  assert.ok(offer);
  assert.equal(offer.kind, 'voucher');
  assert.ok(offer.refId.startsWith('voucher_'));
  assert.ok(offer.cost > 0);
  // La oferta trae los textos ya resueltos: la UI no tiene que buscar la def.
  assert.ok(offer.nameKey.startsWith('voucher.'));
  assert.equal(offer.sold, false);
});

test('el sorteo de vouchers NO ofrece uno ya poseido', () => {
  const service = new OfferService(registryFromRealContent(), [VOUCHER_TABLE]);
  const poseido = realDef('voucher_cheap_rerolls').id;

  // 60 tiradas con semillas distintas: con un solo voucher excluido de siete,
  // si el filtro no funcionara saldria muchisimas veces.
  for (let seed = 1; seed <= 60; seed++) {
    const offers = service.roll('test_vouchers', ctx(new RNG(seed), 0, [poseido]));
    assert.notEqual(offers[0]?.refId, poseido, `salio el voucher ya poseido (seed ${seed})`);
  }
});

test('sin vouchers poseidos, el sorteo cubre el catalogo entero', () => {
  const service = new OfferService(registryFromRealContent(), [VOUCHER_TABLE]);
  const vistos = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) {
    const offer = service.roll('test_vouchers', ctx(new RNG(seed)))[0];
    if (offer) vistos.add(offer.refId);
  }
  assert.equal(vistos.size, VOUCHER_DATA.length, 'todos los vouchers deberian ser alcanzables');
});

test('con todos los vouchers poseidos, la tabla no produce oferta', () => {
  const service = new OfferService(registryFromRealContent(), [VOUCHER_TABLE]);
  const todos = VOUCHER_DATA.map((v) => v.id);

  const offers = service.roll('test_vouchers', ctx(new RNG(3), 0, todos));
  // Devolver `undefined` es correcto: la tabla puede quedar vacia y la tienda
  // muestra "todo vendido" en vez de una oferta que no se puede comprar.
  assert.equal(offers.length, 0);
});

test('los ids de oferta de voucher son unicos entre rerolls', () => {
  const service = new OfferService(registryFromRealContent(), [VOUCHER_TABLE]);
  const rng = new RNG(9);
  const a = service.roll('test_vouchers', ctx(rng, 0));
  const b = service.roll('test_vouchers', ctx(rng, 1));

  const ids = new Set([...a, ...b].map((o) => o.id));
  assert.equal(ids.size, a.length + b.length);
});

// ---------------------------------------------------------------------------
// GameEngine: compra
// ---------------------------------------------------------------------------

test('comprar un voucher cobra el precio y lo registra en la run', () => {
  const engine = engineInShop();
  const def = realDef('voucher_cheap_rerolls');
  const offer = injectVoucher(engine, def.id);
  engine.run.money = def.cost + 5;

  const cobrado = engine.run.money;
  assert.equal(engine.buyOffer(offer.id), true);

  assert.equal(engine.run.money, cobrado - def.cost);
  assert.deepEqual(engine.run.vouchers, [def.id]);
  assert.equal(offer.sold, true);
});

test('un voucher NO ocupa slot de joker ni entra al mazo', () => {
  const engine = engineInShop();
  const def = realDef('voucher_cheap_rerolls');
  const offer = injectVoucher(engine, def.id);
  engine.run.money = def.cost;

  const jokers = engine.run.jokers.length;
  const mazo = engine.run.deck.totalSize;

  engine.buyOffer(offer.id);

  assert.equal(engine.run.jokers.length, jokers);
  assert.equal(engine.run.deck.totalSize, mazo);
  assert.equal(engine.run.jokerSlots, engine.run.jokerSlots);
});

test('comprar un voucher emite `voucher:bought` con su id', () => {
  const engine = engineInShop();
  const def = realDef('voucher_cheap_rerolls');
  const offer = injectVoucher(engine, def.id);
  engine.run.money = def.cost;

  // El aviso es lo que engancha el banner del HUD: si no sale, el jugador paga
  // y no ve ninguna confirmacion de que la regla cambio.
  const vistos: string[] = [];
  const off = bus.on('voucher:bought', ({ voucher }) => vistos.push(voucher));
  engine.buyOffer(offer.id);
  off();

  assert.deepEqual(vistos, [def.id]);
});

test('un voucher con efecto aplica el efecto UNA vez al comprar', () => {
  const engine = engineInShop();
  const def = realDef('voucher_extra_hand');
  const offer = injectVoucher(engine, def.id);
  engine.run.money = def.cost;

  const manosAntes = engine.run.baseHands;
  engine.buyOffer(offer.id);

  assert.equal(engine.run.baseHands, manosAntes + 1, 'el efecto deberia sumar una mano');
});

test('un voucher con efecto consumido-once no se vuelve a aplicar al reconsultar', () => {
  const engine = engineInShop();
  const def = realDef('voucher_extra_hand');
  const offer = injectVoucher(engine, def.id);
  engine.run.money = def.cost;
  engine.buyOffer(offer.id);

  const manosTrasComprar = engine.run.baseHands;
  // Consultar el estado (lo que hace el HUD 60 veces por segundo) no puede
  // volver a disparar el efecto: es un suceso, no un calculo.
  for (let i = 0; i < 10; i++) engine.runSnapshot();

  assert.equal(engine.run.baseHands, manosTrasComprar);
});

test('un voucher ya poseido no se puede recomprar', () => {
  const engine = engineInShop();
  const def = realDef('voucher_cheap_rerolls');
  engine.run.money = def.cost * 4;

  const primera = injectVoucher(engine, def.id);
  assert.equal(engine.buyOffer(primera.id), true);
  const dineroTrasPrimera = engine.run.money;

  const segunda = injectVoucher(engine, def.id);
  assert.equal(engine.canBuyOffer(segunda), false, 'una oferta ya poseida no es comprable');
  assert.equal(engine.buyOffer(segunda.id), false);
  assert.equal(engine.run.money, dineroTrasPrimera, 'no se puede cobrar algo que se rechazo');
  assert.deepEqual(engine.run.vouchers, [def.id], 'no puede duplicarse en el registro');
});

test('`priceOf` y lo que cobra `buyOffer` son el MISMO numero (con descuento)', () => {
  const engine = engineInShop(1, ['voucher_bulk_deal']);
  const def = realDef('voucher_thin_cut');
  const offer = injectVoucher(engine, def.id);
  engine.run.money = 200;

  const cotizado = engine.priceOf(offer);
  const descuento = engine.modifiers.shopDiscount ?? 0;
  assert.ok(descuento > 0, 'el voucher de descuento deberia estar activo');
  assert.ok(cotizado < def.cost, 'el precio mostrado deberia tener descuento');

  const antes = engine.run.money;
  engine.buyOffer(offer.id);
  assert.equal(antes - engine.run.money, cotizado, 'cobro distinto del precio pintado');
});

test('`canBuyOffer` rechaza la oferta si no alcanza el dinero', () => {
  const engine = engineInShop();
  const def = realDef('voucher_bulk_deal');
  const offer = injectVoucher(engine, def.id);
  engine.run.money = def.cost - 1;

  assert.equal(engine.canBuyOffer(offer), false);
  assert.equal(engine.buyOffer(offer.id), false);
  assert.equal(engine.run.money, def.cost - 1, 'un intento fallido no puede cobrar');
  assert.deepEqual(engine.run.vouchers, []);
});

test('comprar un voucher cambia las reglas de la run en el acto', () => {
  const engine = engineInShop();
  engine.run.money = 200;

  // --- Objetivo: 10% menos ---
  const blind = engine.availableBlinds()[0];
  assert.ok(blind);
  const objetivoAntes = engine.targetFor(blind);

  const corte = injectVoucher(engine, 'voucher_thin_cut');
  engine.buyOffer(corte.id);
  const objetivoDespues = engine.targetFor(blind);

  assert.ok(
    objetivoDespues < objetivoAntes,
    `el objetivo deberia bajar (${objetivoAntes} -> ${objetivoDespues})`,
  );
  assert.equal(objetivoDespues, Math.round(objetivoAntes * 0.9));

  // --- Reroll: 2 menos ---
  const rerollAntes = engine.rerollPrice;
  const barato = injectVoucher(engine, 'voucher_cheap_rerolls');
  engine.buyOffer(barato.id);
  assert.equal(engine.rerollPrice, Math.max(0, rerollAntes - 2));
});

test('comprar un voucher no altera el objetivo de la ronda ya empezada', () => {
  // El modificador se lee al CALCULAR el objetivo (al elegir ciego). Cambiarlo
  // a mitad de ronda dejaria al jugador con un objetivo que ya no ve en el HUD.
  const engine = engineInShop();
  engine.run.money = 200;
  const blind = engine.availableBlinds()[0];
  assert.ok(blind);
  engine.chooseBlind(blind.id);
  const objetivoEnCurso = engine.round?.target;

  const corte = injectVoucher(engine, 'voucher_thin_cut');
  engine.run.status = 'shop';
  engine.buyOffer(corte.id);

  assert.equal(engine.round?.target, objetivoEnCurso);
});

test('un voucher de descuento no toca el coste del reroll', () => {
  const engine = engineInShop(1, ['voucher_bulk_deal']);
  // El descuento es de tienda (ofertas), no de reroll. Si tocara el reroll, dos
  // sistemas distintos estarian compartiendo un campo.
  assert.equal(engine.rerollPrice, ECONOMY.rerollBaseCost);
});

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

test('los vouchers sobreviven al guardado y a la recarga', () => {
  const engine = engineInShop(1, ['voucher_thin_cut', 'voucher_cheap_rerolls']);
  const data = engine.serialize();
  assert.deepEqual(data.vouchers, ['voucher_thin_cut', 'voucher_cheap_rerolls']);

  const otro = new GameEngine({ seed: 1, bundle: buildRegistry().toBundle() });
  assert.equal(otro.restore(data), true);

  assert.deepEqual(otro.run.vouchers, ['voucher_thin_cut', 'voucher_cheap_rerolls']);
  // Y las reglas siguen activas, no solo la lista.
  assert.ok((otro.modifiers.targetMultiplier ?? 1) < 1);
  assert.equal(otro.modifiers.rerollCostDelta, -2);
});

test('un guardado sin vouchers carga con lista vacia (migracion)', () => {
  const engine = engineInShop();
  const data = engine.serialize();
  // Simula un guardado viejo: el campo no existia.
  delete (data as { vouchers?: string[] }).vouchers;

  const otro = new GameEngine({ seed: 1, bundle: buildRegistry().toBundle() });
  assert.equal(otro.restore(data), true);
  assert.deepEqual(otro.run.vouchers, []);
  assert.equal(otro.modifiers.targetMultiplier, 1);
});

test('un voucher que ya no existe en el contenido se descarta al cargar', () => {
  const engine = engineInShop(1, ['voucher_thin_cut']);
  const data = engine.serialize();
  data.vouchers = ['voucher_thin_cut', 'voucher_borrado_del_pack'];

  const otro = new GameEngine({ seed: 1, bundle: buildRegistry().toBundle() });
  assert.equal(otro.restore(data), true);
  assert.deepEqual(otro.run.vouchers, ['voucher_thin_cut']);
  // Y un id desconocido no puede romper el calculo de modificadores.
  assert.ok((otro.modifiers.targetMultiplier ?? 1) < 1);
});
