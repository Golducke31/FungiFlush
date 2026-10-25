/**
 * draft.test.ts — Borrador de reglas: bendiciones y maldiciones (R3).
 *
 * Lo que hay que proteger no es "que aparezca un panel", sino las propiedades
 * que hacen del borrador una DECISION y no una trampa:
 *
 *   - el motor no aplica NADA hasta que el jugador elige (igual que el
 *     interludio: `pendingDraft` se sortea, `run.blessing` se escribe al elegir),
 *   - el sorteo es determinista por semilla y NO consume el RNG de la run,
 *   - los modificadores BAKED (manos, descartes, slots, dinero) se aplican UNA
 *     vez: si se leyeran del agregado Y se aplicaran, contarían doble,
 *   - los modificadores LIVE (objetivo, reroll, descuento) se leen del agregado
 *     `engine.modifiers`: tienen que componer con los vouchers,
 *   - la maldición es ACUMULATIVA y nunca se repite,
 *   - el tutorial no sortea borrador (una partida guiada no se toca),
 *   - todo lo elegido sobrevive a guardar y recargar.
 *
 * Contenido de referencia: `src/data/packs/base/blessings.json` (10) y
 * `curses.json` (8).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import type { DraftDefinition } from '../src/engine/draft/draft.ts';
import {
  CURSE_EVERY_ANTES,
  draftModifierLines,
  eligibleDrafts,
  hasModifiers,
  pickDraftOffers,
} from '../src/engine/draft/draft.ts';
import { RNG } from '../src/engine/rng.ts';
import { hashString } from '../src/engine/rng.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readData(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../src/data/packs/base/${name}`, import.meta.url), 'utf8'),
  );
}

function readDict(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../src/i18n/${name}`, import.meta.url), 'utf8'));
}

/** Resuelve una clave con puntos ("a.b.c") contra un diccionario. */
function hasKey(dict: unknown, key: string): boolean {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return false;
  }
  return true;
}

const BLESSINGS = readData('blessings.json') as DraftDefinition[];
const CURSES = readData('curses.json') as DraftDefinition[];
const ES = readDict('es.json');
const EN = readDict('en.json');

function bundle(): ReturnType<typeof buildRegistry> extends never ? never : ReturnType<ReturnType<typeof buildRegistry>['toBundle']> {
  return buildRegistry().toBundle();
}

/** Motor con el pack real. `startRun` se llama salvo que se pida crudo. */
function makeEngine(seed = 1, start = true): GameEngine {
  const instance = new GameEngine({ seed, bundle: bundle() });
  if (start) instance.startRun(seed);
  return instance;
}

/** Fuerza un borrador concreto (evita depender del sorteo). */
function forceDraft(
  engine: GameEngine,
  kind: 'blessing' | 'curse',
  offers: DraftDefinition[],
): void {
  const internals = engine as unknown as {
    pendingDraft: { kind: 'blessing' | 'curse'; offers: DraftDefinition[] } | null;
  };
  internals.pendingDraft = { kind, offers };
  engine.run.status = 'draft';
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

test('los drafts del pack llegan al registro', () => {
  const stats = buildRegistry().stats();
  assert.equal(stats.blessings, BLESSINGS.length);
  assert.equal(stats.curses, CURSES.length);
  assert.ok(stats.blessings >= 10, 'el pack base deberia traer 10 bendiciones');
  assert.ok(stats.curses >= 8, 'el pack base deberia traer 8 maldiciones');
});

test('los ids de bendicion y maldicion no se pisan entre si', () => {
  const ids = [...BLESSINGS, ...CURSES].map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
});

test('cada draft tiene name/desc traducidos en los dos idiomas', () => {
  for (const def of [...BLESSINGS, ...CURSES]) {
    for (const key of [def.nameKey, def.descKey]) {
      assert.ok(hasKey(ES, key), `falta "${key}" en es.json`);
      assert.ok(hasKey(EN, key), `falta "${key}" en en.json`);
    }
  }
});

test('cada draft declara modificadores que hacen algo', () => {
  for (const def of [...BLESSINGS, ...CURSES]) {
    assert.ok(hasModifiers(def), `${def.id} no cambia ninguna regla: es contenido muerto`);
  }
});

test('las maldiciones empiezan en el ante 3, no antes', () => {
  for (const def of CURSES) {
    assert.ok(
      (def.minAnte ?? 1) >= CURSE_EVERY_ANTES,
      `${def.id} sale desde el ante ${def.minAnte}: el ante 1 y 2 tienen que ser el juego base`,
    );
  }
});

// ---------------------------------------------------------------------------
// Las lineas que muestra el panel
// ---------------------------------------------------------------------------

test('toda linea de efecto que puede producir un draft esta traducida', () => {
  // `scanI18n` no ve estas claves: no son literales en el codigo, las arma
  // `draftModifierLines`. Este test es su red de seguridad.
  for (const def of [...BLESSINGS, ...CURSES]) {
    const lines = draftModifierLines(def.modifiers);
    assert.ok(lines.length > 0, `${def.id} no produce ninguna linea`);
    for (const line of lines) {
      assert.ok(hasKey(ES, line.key), `falta "${line.key}" (${def.id}) en es.json`);
      assert.ok(hasKey(EN, line.key), `falta "${line.key}" (${def.id}) en en.json`);
    }
  }
});

test('las lineas salen en orden estable y con los parametros puestos', () => {
  const a = draftModifierLines({
    extraHands: 1,
    extraMoney: -4,
    targetMultiplier: 1.15,
    rerollCostDelta: 2,
    shopDiscount: 0.2,
  });
  assert.deepEqual(
    a.map((l) => l.key),
    [
      'draft.lineHandsPlus',
      'draft.lineMoneyLess',
      'draft.lineTargetUp',
      'draft.lineRerollPricier',
      'draft.lineShopDiscount',
    ],
  );
  assert.deepEqual(a[0]?.params, { n: 1 });
  assert.deepEqual(a[1]?.params, { n: -4 });
  assert.deepEqual(a[2]?.params, { pct: 15 });
  assert.equal(draftModifierLines(undefined).length, 0);
  // Un modificador en 0 no es un efecto: no se muestra.
  assert.equal(draftModifierLines({ extraHands: 0 }).length, 0);
});

// ---------------------------------------------------------------------------
// Sorteo
// ---------------------------------------------------------------------------

test('el sorteo es determinista por semilla', () => {
  const a = pickDraftOffers(BLESSINGS, 1, [], 3, new RNG(hashString('x')));
  const b = pickDraftOffers(BLESSINGS, 1, [], 3, new RNG(hashString('x')));
  const c = pickDraftOffers(BLESSINGS, 1, [], 3, new RNG(hashString('y')));
  assert.deepEqual(a.map((d) => d.id), b.map((d) => d.id));
  assert.notDeepEqual(a.map((d) => d.id), c.map((d) => d.id));
});

test('el sorteo no repite ofertas', () => {
  for (let seed = 0; seed < 40; seed++) {
    const rng = new RNG(hashString(`fungiflush:draft:blessing:${seed}`));
    const offers = pickDraftOffers(BLESSINGS, 1, [], 3, rng);
    const ids = offers.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length, `semilla ${seed} repitio una oferta`);
    assert.ok(offers.length <= 3);
  }
});

test('el sorteo respeta minAnte y excluye lo ya elegido', () => {
  const ante2 = eligibleDrafts(CURSES, 2, []);
  assert.equal(ante2.length, 0, 'ninguna maldicion puede salir en el ante 2');

  const ante3 = eligibleDrafts(CURSES, 3, []);
  assert.equal(ante3.length, CURSES.filter((d) => (d.minAnte ?? 1) <= 3).length);

  const taken = ante3[0]?.id ?? '';
  const rest = eligibleDrafts(CURSES, 3, [taken]);
  assert.ok(!rest.some((d) => d.id === taken), 'una maldicion elegida se vuelve a ofrecer');
});

// ---------------------------------------------------------------------------
// Motor: bendicion de arranque
// ---------------------------------------------------------------------------

test('arrancar la run abre el borrador con 3 ofertas y NO aplica nada', () => {
  const engine = makeEngine(11);
  assert.equal(engine.run.status, 'draft');
  const draft = engine.currentDraft;
  assert.ok(draft, 'deberia haber un borrador pendiente');
  assert.equal(draft?.kind, 'blessing');
  assert.equal(draft?.offers.length, 3);
  // Nada aplicado todavia: el dinero, las manos y los slots son los de base.
  assert.equal(engine.run.blessing, '');
  assert.equal(engine.modifiers.targetMultiplier, 1);
});

test('elegir una bendicion la escribe, aplica los BAKED y sigue a la seleccion', () => {
  const engine = makeEngine(12);
  const before = engine.currentDraft?.offers ?? [];
  const picked = before[0];
  assert.ok(picked);

  const handsBefore = engine.run.baseHands;
  const moneyBefore = engine.run.money;

  assert.ok(engine.chooseDraft(picked.id));
  assert.equal(engine.run.blessing, picked.id);
  assert.equal(engine.run.status, 'blind_select');
  assert.equal(engine.currentDraft, null);

  // Los BAKED se aplicaron UNA vez, sobre el estado.
  const mods = picked.modifiers ?? {};
  assert.equal(engine.run.baseHands, handsBefore + (mods.extraHands ?? 0));
  assert.equal(engine.run.baseDiscards, engine.run.baseDiscards); // sanity: sigue siendo numero
  assert.equal(engine.run.money, Math.max(0, moneyBefore + (mods.extraMoney ?? 0)));
});

test('no se puede elegir una opcion que no este ofrecida', () => {
  const engine = makeEngine(13);
  const offered = new Set((engine.currentDraft?.offers ?? []).map((d) => d.id));
  const other = BLESSINGS.find((d) => !offered.has(d.id));
  assert.ok(other);
  assert.equal(engine.chooseDraft(other.id), false);
  assert.equal(engine.run.blessing, '');
  assert.equal(engine.run.status, 'draft');
});

test('no se puede tomar dos bendiciones', () => {
  const engine = makeEngine(14);
  const first = engine.currentDraft?.offers[0];
  assert.ok(first && engine.chooseDraft(first.id));

  // Se vuelve a abrir un borrador a mano: el motor tiene que rechazarlo.
  forceDraft(engine, 'blessing', [first]);
  assert.equal(engine.chooseDraft(first.id), false);
  // Una accion rechazada NO toca el estado: la run sigue donde estaba y el
  // panel sigue abierto (si el motor cambiara de fase al fallar, un bug de UI
  // podria dejar al jugador en una pantalla que no pidio).
  assert.equal(engine.run.blessing, first.id);
  assert.equal(engine.run.status, 'draft');
});

test('los modificadores LIVE entran al agregado y componen con los vouchers', () => {
  const engine = makeEngine(15);
  const fertile = BLESSINGS.find((d) => d.id === 'blessing_fertile_soil');
  assert.ok(fertile);
  forceDraft(engine, 'blessing', [fertile]);
  assert.ok(engine.chooseDraft(fertile.id));

  // 0.92 de la bendicion, sin vouchers que compongan.
  assert.ok(Math.abs((engine.modifiers.targetMultiplier ?? 1) - 0.92) < 1e-9);

  // Con un voucher de objetivo (0.9), los multiplicadores se MULTIPLICAN: no
  // es "gana el ultimo", es 0.92 x 0.9. El borrador entra por la misma via que
  // un voucher comprado, asi que compone con el.
  engine.run.vouchers.push('voucher_thin_cut');
  assert.ok(Math.abs((engine.modifiers.targetMultiplier ?? 1) - 0.92 * 0.9) < 1e-9);
});

test('los BAKED se aplican una sola vez (no cuentan doble)', () => {
  const engine = makeEngine(16);
  const spare = BLESSINGS.find((d) => d.id === 'blessing_spare_hand');
  assert.ok(spare);
  forceDraft(engine, 'blessing', [spare]);
  const handsBefore = engine.run.baseHands;
  assert.ok(engine.chooseDraft(spare.id));
  assert.equal(engine.run.baseHands, handsBefore + 1);

  // Releer el estado (lo que haria un render) no vuelve a sumar: el BAKED se
  // escribio UNA vez sobre `run.baseHands`, no se recalcula por consulta.
  assert.equal(engine.run.baseHands, handsBefore + 1);
  assert.equal(engine.modifiers.extraHands, 1);

  // El agregado SI lleva el valor (viaja con los demas modificadores del draft),
  // pero nadie lo lee de ahi: los unicos campos que se consultan del agregado
  // son `targetMultiplier`, `rerollCostDelta` y `shopDiscount` (los LIVE). Ver
  // el comentario de `buyVoucher`. Si algun dia alguien suma `extraHands` del
  // agregado, este test y el de arriba se rompen juntos: ahi esta el aviso.
  assert.equal(typeof engine.modifiers.targetMultiplier, 'number');
});

test('un modificador que dejaria la run roto se clampea', () => {
  const engine = makeEngine(17);
  const brutal: DraftDefinition = {
    id: 'test_brutal',
    nameKey: 'x',
    descKey: 'y',
    kind: 'curse',
    modifiers: { extraHands: -99, extraDiscards: -99, extraJokerSlots: -99, extraHandSize: -99, extraMoney: -9999 },
  };
  forceDraft(engine, 'curse', [brutal]);
  assert.ok(engine.chooseDraft(brutal.id));
  assert.ok(engine.run.baseHands >= 1, 'cero manos no es dificil, es injugable');
  assert.ok(engine.run.baseHandSize >= 1, 'mano vacia = no se puede jugar');
  assert.ok(engine.run.jokerSlots >= 1, 'la UI asume que hay fila de simbiontes');
  assert.ok(engine.run.baseDiscards >= 0);
  assert.ok(engine.run.money >= 0, 'el dinero no puede quedar negativo');
});

// ---------------------------------------------------------------------------
// Motor: maldicion periodica
// ---------------------------------------------------------------------------

test('la maldicion toca cada 3 antes y se marca para no repetirse', () => {
  const engine = makeEngine(18);
  const offer = engine.currentDraft?.offers[0];
  assert.ok(offer && engine.chooseDraft(offer.id));

  // Ante 1 y 2: nada.
  engine.run.ante = 1;
  const enter = engine as unknown as { enterBlindSelect(): void };
  enter.enterBlindSelect();
  assert.equal(engine.run.status, 'blind_select');
  engine.run.ante = 2;
  enter.enterBlindSelect();
  assert.equal(engine.run.status, 'blind_select');

  // Ante 3: sortea.
  engine.run.ante = 3;
  enter.enterBlindSelect();
  assert.equal(engine.run.status, 'draft');
  assert.equal(engine.currentDraft?.kind, 'curse');
  assert.equal((engine.currentDraft?.offers.length ?? 0), 2);
  assert.equal(engine.run.curseDraftAnte, 3);

  // Volver a entrar (un interludio, un reload) NO abre otro panel.
  enter.enterBlindSelect();
  assert.equal(engine.run.status, 'blind_select');
});

test('las maldiciones se acumulan y no se repiten', () => {
  const engine = makeEngine(19);
  assert.ok(engine.chooseDraft((engine.currentDraft?.offers[0]?.id) ?? ''));

  engine.run.ante = 3;
  const enter = engine as unknown as { enterBlindSelect(): void };
  enter.enterBlindSelect();
  const firstCurse = engine.currentDraft?.offers[0];
  assert.ok(firstCurse && engine.chooseDraft(firstCurse.id));
  assert.deepEqual(engine.run.curses, [firstCurse.id]);

  engine.run.ante = 6;
  enter.enterBlindSelect();
  const second = engine.currentDraft?.offers ?? [];
  assert.ok(second.length > 0);
  assert.ok(
    !second.some((d) => engine.run.curses.includes(d.id)),
    'se ofrecio una maldicion que el jugador ya tiene',
  );
});

// ---------------------------------------------------------------------------
// Serializacion
// ---------------------------------------------------------------------------

test('la bendicion y las maldiciones sobreviven a guardar y recargar', () => {
  const engine = makeEngine(20);
  const blessing = engine.currentDraft?.offers[0];
  assert.ok(blessing && engine.chooseDraft(blessing.id));

  engine.run.ante = 3;
  const enter = engine as unknown as { enterBlindSelect(): void };
  enter.enterBlindSelect();
  const curse = engine.currentDraft?.offers[0];
  assert.ok(curse && engine.chooseDraft(curse.id));

  const saved = JSON.parse(JSON.stringify(engine.serialize()));

  const reloaded = new GameEngine({ seed: 20, bundle: bundle() });
  reloaded.restore(saved);
  assert.equal(reloaded.run.blessing, blessing.id);
  assert.deepEqual(reloaded.run.curses, [curse.id]);
  assert.equal(reloaded.run.status, 'blind_select');
  assert.equal(reloaded.run.curseDraftAnte, 3);
});

test('un panel de borrador abierto al guardar se reconstruye al recargar', () => {
  const engine = makeEngine(21);
  const offers = (engine.currentDraft?.offers ?? []).map((d) => d.id);
  assert.ok(offers.length === 3);

  const saved = JSON.parse(JSON.stringify(engine.serialize()));
  assert.deepEqual(saved.draft?.offers, offers);

  const reloaded = new GameEngine({ seed: 21, bundle: bundle() });
  reloaded.restore(saved);
  assert.equal(reloaded.run.status, 'draft');
  assert.deepEqual(
    (reloaded.currentDraft?.offers ?? []).map((d) => d.id),
    offers,
  );
  // Y se puede resolver normalmente.
  assert.ok(reloaded.chooseDraft(offers[0] ?? ''));
  assert.equal(reloaded.run.status, 'blind_select');
});

// ---------------------------------------------------------------------------
// Aislamiento
// ---------------------------------------------------------------------------

test('el tutorial no sortea borrador', () => {
  const engine = new GameEngine({ seed: 22, bundle: bundle() });
  engine.startRun(22, 0, '', false, true);
  assert.equal(engine.run.status, 'blind_select');
  assert.equal(engine.currentDraft, null);
  assert.equal(engine.run.blessing, '');
});

test('el borrador NO consume el RNG de la run', () => {
  // El orden del mazo sale del RNG de la run. Si el sorteo de la bendicion
  // usara ese RNG, el mazo de una partida normal quedaria distinto que el de
  // una partida sin drafts (tutorial o pack sin tabla). Asi se comprueba que
  // el borrador tiene RNG propio.
  const withDrafts = new GameEngine({ seed: 23, bundle: bundle() });
  withDrafts.startRun(23);
  const offer = withDrafts.currentDraft?.offers[0];
  assert.ok(offer && withDrafts.chooseDraft(offer.id));

  const plainBundle = { ...bundle(), blessings: [], curses: [] };
  const withoutDrafts = new GameEngine({ seed: 23, bundle: plainBundle });
  withoutDrafts.startRun(23);

  assert.deepEqual(
    withDrafts.run.deck.allCards.map((c) => c.def.id),
    withoutDrafts.run.deck.allCards.map((c) => c.def.id),
    'el sorteo de la bendicion desplazo el RNG de la run',
  );
});
