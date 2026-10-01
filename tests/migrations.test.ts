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
