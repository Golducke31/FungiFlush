/**
 * colony-rewards.test.ts — Las recompensas NOMBRADAS de la Colonia.
 *
 * Cubre el registro (todo rewardId de la escalera tiene definicion), el reclamo
 * (sobres + cosmeticos, idempotente, sin auto-equipar) y la supervivencia de los
 * campos nuevos por la migracion.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COLONY_LEVELS, defaultColonyProgress, grantSpores } from '../src/meta/Colony.ts';
import {
  COLONY_REWARDS,
  claimColonyRewards,
  claimableRewards,
  rewardDef,
} from '../src/meta/ColonyRewards.ts';
import { defaultProfile, PROFILE_SAVE_VERSION } from '../src/meta/ProfileState.ts';
import { migrateProfileSave } from '../src/persistence/migrations.ts';

/** Los 9 rewardIds que la escalera declara hoy. */
const LADDER_IDS = COLONY_LEVELS.map((level) => level.rewardId).filter(
  (id): id is string => typeof id === 'string' && id.length > 0,
);

test('R1: todo rewardId de la escalera tiene definicion en el registro', () => {
  assert.equal(LADDER_IDS.length, 9, 'la escalera deberia declarar 9 recompensas');
  for (const id of LADDER_IDS) {
    assert.ok(rewardDef(id), `falta la definicion de la recompensa ${id}`);
  }
  // Sin definiciones huerfanas: cada def tiene que estar en la escalera.
  for (const id of Object.keys(COLONY_REWARDS)) {
    assert.ok(LADDER_IDS.includes(id), `${id} esta en el registro pero no en COLONY_LEVELS`);
  }
});

test('R2: cada definicion tiene nameKey y descKey, y los no-pack un cosmeticId', () => {
  for (const def of Object.values(COLONY_REWARDS)) {
    assert.ok(def.nameKey.startsWith('colony.reward.'), `${def.id}: nameKey raro`);
    assert.ok(def.descKey.startsWith('colony.rewardInfo.'), `${def.id}: descKey raro`);
    if (def.kind === 'pack') {
      assert.ok(def.packKind === 'base' || def.packKind === 'expansion', `${def.id}: packKind invalido`);
      assert.equal(def.cosmeticId, undefined, `${def.id}: un sobre no da cosmetico`);
    } else {
      assert.ok(def.cosmeticId, `${def.id}: falta cosmeticId`);
    }
  }
});

test('R3: claimableRewards = desbloqueadas menos reclamadas', () => {
  const progress = defaultColonyProgress();
  grantSpores(progress, 400); // nivel 5 -> 4 recompensas
  assert.ok(progress.unlockedRewards.length >= 3);
  assert.deepEqual(claimableRewards(progress), progress.unlockedRewards);

  const first = progress.unlockedRewards[0]!;
  progress.claimedRewards.push(first);
  assert.ok(!claimableRewards(progress).includes(first));
  assert.equal(claimableRewards(progress).length, progress.unlockedRewards.length - 1);
});

test('R4: reclamar todo entrega sobres y cosmeticos SIN equipar', () => {
  const profile = defaultProfile();
  grantSpores(profile.colony, 1200); // nivel 8 -> 7 recompensas (hasta `avatar`)

  const result = claimColonyRewards(profile);

  assert.equal(result.claimed.length, 7);
  assert.equal(result.basePacks, 1, 'pack_spores -> 1 sobre base');
  assert.equal(result.expansionPacks, 1, 'pack_colony -> 1 sobre de expansion');
  assert.equal(profile.packs.pending, 1);
  assert.equal(profile.packs.expansionPending, 1);

  for (const id of ['frame_common', 'bg_new', 'title_mycelium', 'victory_fx', 'avatar']) {
    assert.ok(profile.cosmetics.owned.includes(id), `falta ${id} en cosmetics.owned`);
  }
  // Los packs NO dan cosmetico.
  assert.ok(!profile.cosmetics.owned.includes('pack_spores'));
  assert.ok(!profile.cosmetics.owned.includes('pack_colony'));

  // Reclamar NO equipa: los slots siguen en 'default'.
  assert.equal(profile.cosmetics.equippedAvatar, 'default');
  assert.equal(profile.cosmetics.equippedFrame, 'default');
  assert.equal(profile.cosmetics.equippedTitle, 'default');
  assert.equal(profile.cosmetics.equippedBackground, 'default');
  assert.equal(profile.cosmetics.equippedVictoryFx, 'default');
});

test('R5: reclamar es idempotente', () => {
  const profile = defaultProfile();
  grantSpores(profile.colony, 1200);
  claimColonyRewards(profile);

  const ownedBefore = [...profile.cosmetics.owned];
  const second = claimColonyRewards(profile);

  assert.deepEqual(second.claimed, []);
  assert.equal(profile.packs.pending, 1, 'no se duplica el sobre base');
  assert.equal(profile.packs.expansionPending, 1, 'no se duplica el sobre de expansion');
  assert.deepEqual(profile.cosmetics.owned, ownedBefore);
  assert.deepEqual(claimableRewards(profile.colony), []);
});

test('R6: reclamar por id reclama solo ese, y reporta los que no estan pendientes', () => {
  const profile = defaultProfile();
  grantSpores(profile.colony, 1200);

  const one = claimColonyRewards(profile, ['pack_spores', 'title_established']);
  assert.deepEqual(one.claimed, ['pack_spores']);
  assert.deepEqual(one.skipped, ['title_established'], 'nivel 10 no esta desbloqueado todavia');
  assert.equal(profile.packs.pending, 1);
  assert.equal(profile.packs.expansionPending, 0);

  // Repetir el mismo id cae en `skipped`.
  const again = claimColonyRewards(profile, ['pack_spores']);
  assert.deepEqual(again.claimed, []);
  assert.deepEqual(again.skipped, ['pack_spores']);
});

test('R7: un id desbloqueado sin definicion se marca reclamado igual (no queda pegado)', () => {
  const profile = defaultProfile();
  profile.colony.unlockedRewards.push('recompensa_fantasma');
  const result = claimColonyRewards(profile, ['recompensa_fantasma']);
  assert.deepEqual(result.claimed, ['recompensa_fantasma']);
  assert.deepEqual(claimableRewards(profile.colony), []);
});

test('R8: la migracion conserva claimedRewards y los slots equipados', () => {
  const raw = {
    version: PROFILE_SAVE_VERSION,
    colony: { lifetimeSpores: 1200, claimedRewards: ['frame_common', 'pack_spores'] },
    cosmetics: {
      equippedAvatar: 'avatar',
      equippedTitle: 'title_mycelium',
      owned: ['default', 'mycelial', 'avatar', 'title_mycelium'],
    },
  };
  const migrated = migrateProfileSave(raw);

  assert.deepEqual(migrated.colony.claimedRewards, ['frame_common', 'pack_spores']);
  assert.equal(migrated.cosmetics.equippedAvatar, 'avatar');
  assert.equal(migrated.cosmetics.equippedTitle, 'title_mycelium');
  // Los slots que el perfil no traia caen a 'default'.
  assert.equal(migrated.cosmetics.equippedFrame, 'default');
  assert.equal(migrated.cosmetics.equippedVictoryFx, 'default');
  assert.ok(migrated.cosmetics.owned.includes('avatar'));
});

test('R9: un perfil viejo (sin los campos nuevos) arranca limpio', () => {
  const migrated = migrateProfileSave({ version: PROFILE_SAVE_VERSION });
  assert.deepEqual(migrated.colony.claimedRewards, []);
  assert.equal(migrated.cosmetics.equippedAvatar, 'default');
  assert.equal(migrated.cosmetics.equippedFrame, 'default');
  assert.equal(migrated.cosmetics.equippedBackground, 'default');
  assert.equal(migrated.cosmetics.equippedVictoryFx, 'default');
});

test('R10: un claimedRewards no-array se corrige a []', () => {
  const migrated = migrateProfileSave({
    version: PROFILE_SAVE_VERSION,
    colony: { lifetimeSpores: 100, claimedRewards: 'basura' },
  });
  assert.deepEqual(migrated.colony.claimedRewards, []);
});
