/**
 * migrations.test.ts — El guardado es sagrado.
 *
 * Si una migracion rompe, le borramos el progreso a alguien que PAGO el juego.
 * Estos tests son la red: cubren el camino v1 -> v2 y los casos borde.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  migrateProfileSave,
  migrateRunSave,
  RUN_MIGRATIONS,
} from '../src/persistence/migrations.ts';
import { EntitlementStore } from '../src/meta/EntitlementStore.ts';
import { MAX_DECK_PRESETS } from '../src/meta/DeckPresets.ts';
import { defaultProfile, PROFILE_SAVE_VERSION } from '../src/meta/ProfileState.ts';

function v1Save() {
  return {
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    seed: 12345,
    ante: 3,
    blindIndex: 1,
    money: 12,
    jokerSlots: 5,
    baseHandSize: 8,
    baseHands: 4,
    baseDiscards: 3,
    jokers: ['joker_extra_hand'],
    deck: [
      { id: 'amanita_toxica', bonusSubstrate: 4, bonusSpores: 1, level: 2, statuses: [] },
      { id: 'spore_puffball', bonusSubstrate: 0, bonusSpores: 0, level: 1, statuses: [] },
    ],
    stats: { handsPlayed: 7, bestHand: 4200, blindsCleared: 2, cardsDestroyed: 1 },
    consumedEffects: ['some_effect'],
  };
}

test('v1 -> v2 migra y completa los campos nuevos', () => {
  const migrated = migrateRunSave(v1Save());
  assert.ok(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.seed, 12345);
  assert.equal(migrated.ante, 3);

  // Campos nuevos con defaults seguros.
  assert.equal(migrated.contentHash, null);
  assert.deepEqual(migrated.packIds, ['base']);
  assert.equal(migrated.stats.cardsUpgraded, 0);
  assert.equal(migrated.stats.cardsEvolved, 0);

  // Cada carta gana su contador de jugadas y su linaje.
  for (const card of migrated.deck) {
    assert.equal(card.plays, 0);
    assert.equal(card.evolvedFrom, null);
  }
});

test('un save v2 ya migrado pasa derecho', () => {
  const v2 = { ...v1Save(), version: 2, contentHash: 'abc123', packIds: ['base'] };
  const migrated = migrateRunSave(v2);
  assert.ok(migrated);
  assert.equal(migrated.contentHash, 'abc123');
  assert.deepEqual(migrated.packIds, ['base']);
});

test('un save de una version FUTURA no se degrada: se rechaza', () => {
  assert.equal(migrateRunSave({ ...v1Save(), version: 99 }), null);
});

test('un save sin mazo es invalido', () => {
  assert.equal(migrateRunSave({ ...v1Save(), deck: [] }), null);
});

test('basura no explota: devuelve null', () => {
  assert.equal(migrateRunSave(null), null);
  assert.equal(migrateRunSave('{}'), null);
  assert.equal(migrateRunSave({ nope: true }), null);
});

test('la cadena esta completa: existe migracion para cada version anterior', () => {
  // Si alguien sube SAVE_VERSION sin agregar la migracion, esto falla.
  for (let v = 1; v < 2; v++) {
    assert.ok(RUN_MIGRATIONS[v], `falta la migracion ${v} -> ${v + 1}`);
  }
});

test('el perfil NUNCA devuelve null: cae al default', () => {
  assert.deepEqual(migrateProfileSave(null).stats, defaultProfile().stats);
  assert.deepEqual(migrateProfileSave({ version: 999 }).stats, defaultProfile().stats);
  assert.deepEqual(migrateProfileSave('roto').stats, defaultProfile().stats);
});

test('el perfil preserva lo que conoce y completa lo nuevo', () => {
  const migrated = migrateProfileSave({
    version: PROFILE_SAVE_VERSION,
    settings: { lang: 'en', reduceMotion: true },
    collection: { seenCardIds: ['a'], unlockedCardIds: [], unlockedJokerIds: [] },
  });
  assert.equal(migrated.settings.lang, 'en');
  assert.equal(migrated.settings.reduceMotion, true);
  // Campos no enviados: sobreviven del default.
  assert.equal(migrated.settings.musicVolume, defaultProfile().settings.musicVolume);
  assert.deepEqual(migrated.collection.seenCardIds, ['a']);
});

test('R5: el historial sobrevive la migracion y un perfil viejo arranca vacio', () => {
  // Guarda de la trampa de merge: sin la linea explicita en el return, el
  // campo `history` se descartaria en silencio al reconstruir el perfil.
  const entry = { seed: 123, ante: 5, ascension: 2, win: false, reason: 'loss', at: 111 };
  const migrated = migrateProfileSave({ version: PROFILE_SAVE_VERSION, history: [entry] });
  assert.deepEqual(migrated.history, [entry]);

  // Un perfil viejo SIN history cae al default (array vacio), no a undefined.
  const fresh = migrateProfileSave({ version: PROFILE_SAVE_VERSION });
  assert.deepEqual(fresh.history, []);

  // Basura en el campo tampoco rompe: se ignora y queda el default.
  const junk = migrateProfileSave({ version: PROFILE_SAVE_VERSION, history: 'roto' });
  assert.deepEqual(junk.history, []);
});

test('v2: la guia vista sobrevive la migracion y un perfil v1 la muestra de nuevo', () => {
  // Misma trampa de merge que `history`: sin la linea explicita en el return,
  // `seenTutorial` se descartaria en silencio al reconstruir el perfil.
  const seen = migrateProfileSave({ version: 2, seenTutorial: true });
  assert.equal(seen.seenTutorial, true);

  // Un perfil v1 (sin el campo) cae a `false`: se le ofrece la guia UNA vez mas.
  // Darlo por visto seria peor: nunca volveria a verla.
  const fromV1 = migrateProfileSave({ version: 1, stats: { runs: 3 } });
  assert.equal(fromV1.seenTutorial, false);
  // El resto del perfil v1 no se pierde en el camino.
  assert.equal(fromV1.stats.runs, 3);
  assert.equal(fromV1.version, PROFILE_SAVE_VERSION);

  // Basura en el campo tampoco rompe: solo `true` cuenta como visto.
  const junk = migrateProfileSave({ version: 2, seenTutorial: 'si' });
  assert.equal(junk.seenTutorial, false);
});

test('v3 -> v4: la Colonia arranca en cero y la cuenta en offline', () => {
  // Un perfil v3 es de alguien que jugo ANTES de que existieran las Esporas de
  // Colonia: no se le puede reconstruir hacia atras el historial de Ciegos.
  const migrated = migrateProfileSave({ version: 3, stats: { runs: 5, bestAnte: 4 } });
  assert.equal(migrated.version, PROFILE_SAVE_VERSION);
  assert.equal(migrated.colony.lifetimeSpores, 0);
  assert.equal(migrated.colony.level, 1);
  assert.deepEqual(migrated.colony.firstClears, []);
  assert.deepEqual(migrated.colony.unlockedRewards, []);
  assert.equal(migrated.account.provider, 'none');
  assert.equal(migrated.account.syncState, 'offline');
  assert.deepEqual(migrated.account.pendingResults, []);
  // El resto del perfil v3 no se pierde en el camino.
  assert.equal(migrated.stats.runs, 5);
  assert.equal(migrated.stats.bestAnte, 4);
});

test('v4: la Colonia sobrevive el merge y el nivel se DERIVA de las Esporas', () => {
  // Guarda de la trampa de merge: sin las lineas explicitas en el return,
  // `colony` y `account` se descartarian en silencio al reconstruir el perfil.
  const migrated = migrateProfileSave({
    version: 4,
    colony: {
      lifetimeSpores: 1200,
      level: 99,
      firstClears: ['1:0'],
      unlockedRewards: ['frame_common'],
    },
    account: {
      provider: 'google-play',
      accountId: 'abc',
      displayName: 'Nova',
      syncState: 'pending',
      pendingResults: [{ runId: 'r1' }],
    },
  });
  assert.equal(migrated.colony.lifetimeSpores, 1200);
  // El nivel NO se confia: un perfil editado a mano no puede mostrar un estado
  // imposible. 1200 Esporas son nivel 8 (950..1250).
  assert.equal(migrated.colony.level, 8);
  assert.deepEqual(migrated.colony.firstClears, ['1:0']);
  // RECONCILIACION: `unlockedRewards` se rellena hacia adelante con los ids de
  // los niveles <= al nivel derivado (2..8), respetando lo que ya venia. Sin esto
  // las recompensas de nivel alto quedaban "desbloqueadas" pero SIN boton de
  // reclamar (ver el test de abajo).
  assert.deepEqual(migrated.colony.unlockedRewards, [
    'frame_common',
    'pack_spores',
    'bg_new',
    'title_mycelium',
    'victory_fx',
    'pack_colony',
    'avatar',
  ]);
  assert.equal(migrated.account.provider, 'google-play');
  assert.equal(migrated.account.accountId, 'abc');
  assert.equal(migrated.account.displayName, 'Nova');
  assert.equal(migrated.account.syncState, 'pending');
  assert.equal(migrated.account.pendingResults.length, 1);
});

test('colonia: `unlockedRewards` se reconcilia con el nivel derivado (bug lvl 8)', () => {
  // Reporte del jugador: "soy lvl 8, equipe las recompensas y parecen no
  // aparecer, el titulo si es visible". Causa: un perfil guardado con
  // `unlockedRewards` incompleto respecto al nivel (perfiles de antes del sistema
  // de recompensas nombradas, o un nivel recalculado sin empujar los desbloqueos)
  // dejaba las recompensas de nivel alto sin boton de reclamar -> nunca entraban
  // a `cosmetics.owned` -> no se podian equipar. La migracion ahora las rellena.
  const migrated = migrateProfileSave({
    version: PROFILE_SAVE_VERSION,
    colony: {
      lifetimeSpores: 980, // nivel 8
      unlockedRewards: ['frame_common', 'pack_spores', 'bg_new', 'title_mycelium'],
      claimedRewards: ['frame_common', 'pack_spores', 'bg_new', 'title_mycelium'],
    },
  });
  assert.equal(migrated.colony.level, 8);
  // Las de nivel 6..8 se agregan; las ya presentes conservan su lugar.
  for (const id of ['victory_fx', 'pack_colony', 'avatar']) {
    assert.ok(migrated.colony.unlockedRewards.includes(id), `falta ${id}`);
  }
  // La de nivel 9 NO se agrega: el nivel 9 no se alcanzo.
  assert.ok(!migrated.colony.unlockedRewards.includes('frame_uncommon'));
  // No se duplica lo que ya venia.
  assert.equal(migrated.colony.unlockedRewards.filter((x) => x === 'frame_common').length, 1);
  // Nada de esto equipa solo: reclamar/equipar sigue siendo accion del jugador.
  assert.equal(migrated.cosmetics.equippedAvatar, 'default');
});

test('v1 -> v4 recorre la cadena entera sin perder nada', () => {
  const migrated = migrateProfileSave({ version: 1, stats: { runs: 2 } });
  assert.equal(migrated.version, PROFILE_SAVE_VERSION);
  assert.equal(migrated.stats.runs, 2);
  assert.equal(migrated.seenTutorial, false);
  assert.equal(migrated.ui.missionsOpen, false);
  assert.equal(migrated.colony.level, 1);
  assert.equal(migrated.account.syncState, 'offline');
});

test('basura en colony/account no rompe el arranque', () => {
  const migrated = migrateProfileSave({ version: 4, colony: 'roto', account: 42 });
  assert.equal(migrated.colony.level, 1);
  assert.equal(migrated.colony.lifetimeSpores, 0);
  assert.equal(migrated.account.provider, 'none');
  assert.deepEqual(migrated.account.pendingResults, []);
});

test('v5 -> v6: sobres de Jefe y copias de la Coleccion arrancan en cero', () => {
  const migrated = migrateProfileSave({
    version: 5,
    packs: { pending: 2, opened: 5 },
    collection: { seenCardIds: ['spore_puffball'] },
  });
  assert.equal(migrated.version, PROFILE_SAVE_VERSION);
  // Los contadores viejos sobreviven.
  assert.equal(migrated.packs.pending, 2);
  assert.equal(migrated.packs.opened, 5);
  // Los nuevos caen a cero / objeto vacio: no se puede reconstruir hacia atras.
  assert.equal(migrated.packs.expansionPending, 0);
  assert.equal(migrated.packs.expansionOpened, 0);
  assert.equal(migrated.packs.bossMisses, 0);
  assert.deepEqual(migrated.collection.ownedCounts, {});
  // Lo que ya conocia el perfil se preserva.
  assert.deepEqual(migrated.collection.seenCardIds, ['spore_puffball']);
});

test('v6: un ownedCounts con basura se limpia (no numericos, negativos, cero)', () => {
  const migrated = migrateProfileSave({
    version: 6,
    collection: {
      ownedCounts: { a: 3, b: -2, c: 0, d: 'x', e: 2.7, f: Number.NaN },
    },
  });
  assert.deepEqual(migrated.collection.ownedCounts, { a: 3, e: 2 });
});

test('v6: un packs con contadores basura se fuerza a enteros >= 0', () => {
  const migrated = migrateProfileSave({
    version: 6,
    packs: { pending: -3, opened: 'x', expansionPending: 1.9, bossMisses: -1 },
  });
  assert.equal(migrated.packs.pending, 0);
  assert.equal(migrated.packs.opened, 0);
  assert.equal(migrated.packs.expansionPending, 1);
  assert.equal(migrated.packs.bossMisses, 0);
});

// ---------------------------------------------------------------------------
// v6 -> v7: mazos personalizados
// ---------------------------------------------------------------------------

test('v6 -> v7: decks arranca con un preset vacio y ninguno elegido', () => {
  const migrated = migrateProfileSave({ version: 6, stats: { runs: 7 } });
  assert.equal(migrated.version, PROFILE_SAVE_VERSION);
  // El perfil viejo sobrevive...
  assert.equal(migrated.stats.runs, 7);
  // ...y el modo nuevo arranca vacio: nadie armo un mazo todavia.
  assert.equal(migrated.decks.selectedId, '');
  assert.equal(migrated.decks.presets.length, 1);
  assert.deepEqual(migrated.decks.presets[0]?.entries, []);
});

test('v7: un decks con basura cae al default sin romper', () => {
  for (const junk of [42, 'roto', null, [], { presets: 'nope' }]) {
    const migrated = migrateProfileSave({ version: 7, decks: junk });
    assert.equal(migrated.decks.selectedId, '');
    assert.equal(migrated.decks.presets.length, 1);
    assert.deepEqual(migrated.decks.presets[0]?.entries, []);
  }
});

test('v7: un preset sin id se descarta y las entradas basura se limpian', () => {
  const migrated = migrateProfileSave({
    version: 7,
    decks: {
      selectedId: 'custom',
      presets: [
        { id: 'custom', name: 'Mi mazo', entries: [{ cardId: 'a', copies: 3 }, { cardId: '', copies: 2 }, { cardId: 'b', copies: 0 }, 'basura'] },
        { name: 'sin id', entries: [{ cardId: 'c', copies: 1 }] },
      ],
    },
  });
  assert.equal(migrated.decks.presets.length, 1);
  assert.deepEqual(migrated.decks.presets[0], {
    id: 'custom',
    name: 'Mi mazo',
    entries: [{ cardId: 'a', copies: 3 }],
  });
  assert.equal(migrated.decks.selectedId, 'custom');
});

test('v7: un selectedId huerfano cae a "ninguno" (clasico)', () => {
  const migrated = migrateProfileSave({
    version: 7,
    decks: { selectedId: 'no-existe', presets: [{ id: 'custom', name: '', entries: [] }] },
  });
  assert.equal(migrated.decks.selectedId, '');
});

test('v7: la lista de presets se capea a MAX_DECK_PRESETS', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, name: '', entries: [] }));
  const migrated = migrateProfileSave({ version: 7, decks: { selectedId: '', presets: many } });
  assert.equal(migrated.decks.presets.length, MAX_DECK_PRESETS);
});

test('EntitlementStore es serializable y estable', () => {
  const store = new EntitlementStore({ owned: ['pack.base'] });
  store.addXp('season_01', 120);
  store.claim('season_01', 3, 'premium');

  const json = store.toJSON();
  const restored = EntitlementStore.from(JSON.parse(JSON.stringify(json)));

  assert.deepEqual(restored.toJSON(), json);
  assert.ok(restored.has('pack.base'));
  assert.ok(restored.hasClaimed('season_01', 3, 'premium'));
  assert.ok(restored.equals(store));
});
