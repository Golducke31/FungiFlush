import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultProfile } from '../src/meta/ProfileState';
import {
  parseSeason,
  addXp,
  claimTier,
  tierViews,
  currentTier,
} from '../src/retention/SeasonTracker';

const RAW = {
  id: 'founder',
  nameKey: 'season.founder.name',
  tiers: [
    { level: 2, xp: 120, reward: { type: 'joker', id: 'joker_x' } },
    { level: 1, xp: 0, reward: { type: 'card', id: 'card_a' } },
    { level: 3, xp: 260, reward: { type: 'card', id: 'card_b' } },
  ],
};

test('parseSeason valida y ordena por nivel', () => {
  const def = parseSeason(RAW);
  assert.ok(def);
  assert.equal(def.id, 'founder');
  assert.deepEqual(
    def.tiers.map((t) => t.level),
    [1, 2, 3],
  );
});

test('parseSeason descarta entradas rotas y devuelve null si no sirve', () => {
  assert.equal(parseSeason(null), null);
  assert.equal(parseSeason({ id: 'x' }), null);
  assert.equal(parseSeason({ id: 'x', nameKey: 'y', tiers: [{ level: 1 }] }), null);
});

test('addXp crea el PassState y acumula sin bajar de 0', () => {
  const p = defaultProfile();
  assert.equal(addXp(p, 'founder', 120), 120);
  assert.equal(addXp(p, 'founder', -999), 0);
  const pass = p.entitlements.passes.find((x) => x.seasonId === 'founder');
  assert.ok(pass);
  assert.equal(pass.xp, 0);
});

test('tierViews refleja claimed/claimable/locked por XP', () => {
  const p = defaultProfile();
  addXp(p, 'founder', 120); // alcanza nivel 1 y 2, no el 3
  const def = parseSeason(RAW);
  assert.ok(def);
  const pass = p.entitlements.passes.find((x) => x.seasonId === 'founder');
  assert.ok(pass);
  const views = tierViews(def, pass);
  assert.equal(views.length, 3);
  assert.equal(views[0]!.state, 'claimable'); // xp 0
  assert.equal(views[1]!.state, 'claimable'); // xp 120
  assert.equal(views[2]!.state, 'locked'); // xp 260
  assert.equal(currentTier(def, pass), 2);
});

test('claimTier otorga, escribe unlockSource=season y es idempotente', () => {
  const p = defaultProfile();
  addXp(p, 'founder', 120);
  const def = parseSeason(RAW);
  assert.ok(def);

  const first = claimTier(p, def, 1);
  assert.equal(first, true);
  assert.equal(p.collection.unlockSource['card_a'], 'season');
  assert.ok(p.collection.unlockedCardIds.includes('card_a'));

  // Reclamar de nuevo no duplica.
  const again = claimTier(p, def, 1);
  assert.equal(again, false);

  // No se puede reclamar un tier no alcanzado.
  assert.equal(claimTier(p, def, 3), false);
  assert.equal(p.collection.unlockSource['card_b'], undefined);

  // Estado reflejado en la vista.
  const pass = p.entitlements.passes.find((x) => x.seasonId === 'founder');
  assert.ok(pass);
  const views = tierViews(def, pass);
  assert.equal(views[0]!.state, 'claimed');
});
