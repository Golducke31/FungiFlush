/**
 * retention.test.ts — Recompensa diaria, recompensas y logros.
 *
 * Por que hay tests aca y no en la UI: la racha depende del RELOJ y del
 * calendario (cambio de dia, reloj adelantado), y eso es exactamente lo que no
 * se puede verificar mirando la pantalla. Aca se congela el tiempo pasando
 * timestamps a mano.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultProfile } from '../src/meta/ProfileState.ts';
import { migrateProfileSave } from '../src/persistence/migrations.ts';
import { applyReward } from '../src/retention/rewards.ts';
import {
  claimDaily,
  dateKey,
  evaluateDaily,
  parseDailyTable,
  rewardForDay,
  type DailyRewardTable,
} from '../src/retention/DailyReward.ts';
import {
  AchievementTracker,
  parseAchievements,
  type AchievementDef,
  type ProfileHandle,
} from '../src/retention/AchievementTracker.ts';
import { Emitter, type GameEventMap } from '../src/engine/events.ts';

/**
 * Un momento del dia `day` a las `hour` HORA LOCAL, no UTC: `getTimezoneOffset`
 * es (UTC - local), asi que se SUMA para pasar de hora local a timestamp.
 */
function at(day: number, hour = 12): number {
  return Date.UTC(2026, 8, day, hour) + new Date().getTimezoneOffset() * 60_000;
}

const TABLE: DailyRewardTable = parseDailyTable({
  cycleDays: 3,
  rewards: [
    { day: 1, reward: { type: 'card', id: 'morel_prize' } },
    { day: 2, reward: { type: 'card', id: 'chanterelle_gold' } },
    { day: 3, reward: { type: 'joker', id: 'joker_golden_mold' } },
  ],
});

// ---------------------------------------------------------------------------
// Racha
// ---------------------------------------------------------------------------

test('dateKey usa el dia LOCAL del jugador, no el de Greenwich', () => {
  // Lo que importa: la primera y la ultima hora del mismo dia local caen en la
  // misma clave aunque en UTC sean dias distintos.
  assert.equal(dateKey(at(20, 0)), dateKey(at(20, 23)));
  // Y dos horas despues de la medianoche local ya es OTRO dia.
  assert.notEqual(dateKey(at(20, 23)), dateKey(at(21, 1)));
});

test('la primera vez la racha arranca en 1 y da el reward del dia 1', () => {
  const profile = defaultProfile();
  const state = evaluateDaily(profile, at(10), TABLE);
  assert.equal(state.alreadyClaimedToday, false);
  assert.equal(state.streak, 1);
  assert.equal(state.day, 1);
  assert.deepEqual(state.reward, { type: 'card', id: 'morel_prize' });
});

test('reclamar escribe la racha, el historial y el mejor registro', () => {
  const profile = defaultProfile();
  const first = claimDaily(profile, at(10), TABLE);
  assert.equal(first.ok, true);
  assert.equal(first.streak, 1);
  assert.equal(first.fresh, true);
  assert.equal(profile.daily.lastClaimDate, dateKey(at(10)));
  assert.equal(profile.daily.bestStreak, 1);
  assert.deepEqual(profile.daily.history, [dateKey(at(10))]);
  assert.ok(profile.collection.unlockedCardIds.includes('morel_prize'));
  assert.equal(profile.collection.unlockSource['morel_prize'], 'daily');
});

test('dos dias seguidos suman racha; el dia 2 da el segundo reward', () => {
  const profile = defaultProfile();
  claimDaily(profile, at(10), TABLE);
  const second = claimDaily(profile, at(11), TABLE);
  assert.equal(second.ok, true);
  assert.equal(second.streak, 2);
  assert.deepEqual(second.reward, { type: 'card', id: 'chanterelle_gold' });
});

test('reclamar dos veces el mismo dia es un no-op', () => {
  const profile = defaultProfile();
  claimDaily(profile, at(10), TABLE);
  const again = claimDaily(profile, at(10, 20), TABLE);
  assert.equal(again.ok, false);
  assert.equal(again.streak, 1);
  assert.equal(profile.daily.history.length, 1);
});

test('saltarse un dia reinicia la racha a 1', () => {
  const profile = defaultProfile();
  claimDaily(profile, at(10), TABLE);
  claimDaily(profile, at(11), TABLE);
  const later = claimDaily(profile, at(15), TABLE);
  assert.equal(later.streak, 1);
  assert.equal(profile.daily.bestStreak, 2);
});

test('el ciclo vuelve a empezar: el dia 4 repite el reward del dia 1', () => {
  const profile = defaultProfile();
  claimDaily(profile, at(10), TABLE);
  claimDaily(profile, at(11), TABLE);
  claimDaily(profile, at(12), TABLE);
  const fourth = claimDaily(profile, at(13), TABLE);
  assert.equal(fourth.streak, 4);
  assert.equal(fourth.reward?.id, 'morel_prize');
  assert.deepEqual(rewardForDay(TABLE, 4), { type: 'card', id: 'morel_prize' });
});

test('un reloj ADELANTADO no regala racha: la sostiene sin sumar', () => {
  const profile = defaultProfile();
  claimDaily(profile, at(10), TABLE);
  // Mismo dia local siguiente pero apenas 5 h despues: fisicamente imposible
  // sin mover el reloj.
  const suspicious = evaluateDaily(profile, at(11, 2), TABLE);
  assert.equal(suspicious.streak, 1, 'no debe sumar con menos de 20 h de por medio');
  assert.equal(profile.daily.streak, 1);
});

test('una fecha guardada en el FUTURO reinicia la racha', () => {
  const profile = defaultProfile();
  profile.daily.lastClaimDate = dateKey(at(30));
  profile.daily.streak = 7;
  const state = evaluateDaily(profile, at(10), TABLE);
  assert.equal(state.streak, 1);
});

test('reclamar otorga el mismo id una sola vez (segunda vuelta del ciclo)', () => {
  const profile = defaultProfile();
  for (let day = 10; day <= 13; day++) claimDaily(profile, at(day), TABLE);
  assert.equal(profile.daily.streak, 4);
  // El dia 4 vuelve a tocar morel_prize: ya estaba, asi que no es novedad.
  const repeat = claimDaily(profile, at(14), TABLE);
  assert.equal(repeat.ok, true);
  const ids = profile.collection.unlockedCardIds.filter((id) => id === 'morel_prize');
  assert.equal(ids.length, 1);
});

// ---------------------------------------------------------------------------
// Recompensas
// ---------------------------------------------------------------------------

test('applyReward es idempotente y avisa cuando NO agrega nada', () => {
  const profile = defaultProfile();
  assert.equal(applyReward(profile, { type: 'card', id: 'morel_prize' }, 'daily'), true);
  assert.equal(applyReward(profile, { type: 'card', id: 'morel_prize' }, 'achievement'), false);
  // Aunque no sea nuevo, el origen queda actualizado.
  assert.equal(profile.collection.unlockSource['morel_prize'], 'achievement');
});

test('applyReward separa cartas de jokers y equipa lo cosmético', () => {
  const profile = defaultProfile();
  applyReward(profile, { type: 'joker', id: 'joker_first_spore' }, 'achievement');
  applyReward(profile, { type: 'cardBack', id: 'back_moss' }, 'season');
  applyReward(profile, { type: 'felt', id: 'felt_peat' }, 'season');
  assert.ok(profile.collection.unlockedJokerIds.includes('joker_first_spore'));
  assert.equal(profile.cosmetics.equippedCardBack, 'back_moss');
  assert.equal(profile.cosmetics.equippedFelt, 'felt_peat');
  assert.ok(profile.cosmetics.owned.includes('back_moss'));
});

// ---------------------------------------------------------------------------
// Parseo de datos
// ---------------------------------------------------------------------------

test('el parseo descarta entradas invalidas sin tumbar el resto', () => {
  const table = parseDailyTable({
    cycleDays: 2,
    rewards: [
      { day: 1, reward: { type: 'card', id: 'ok' } },
      { day: 2, reward: { type: 'moneda', id: 'inventado' } },
      { day: 'tres', reward: { type: 'card', id: 'otro' } },
      null,
    ],
  });
  assert.equal(table.cycleDays, 2);
  assert.equal(table.rewards.length, 1);
  assert.equal(table.rewards[0]?.reward.id, 'ok');
});

test('un logro sin condicion y sin incremental se descarta', () => {
  const defs = parseAchievements([
    { id: 'a', nameKey: 'a', descKey: 'a', event: 'round:win', when: { op: 'always' } },
    { id: 'b', nameKey: 'b', descKey: 'b', event: 'round:win' },
    { id: 'c', nameKey: 'c', descKey: 'c', event: 'no_existe', when: { op: 'always' } },
    { id: 'd', nameKey: 'd', descKey: 'd', event: 'game:over', incremental: { max: 3 } },
  ]);
  assert.deepEqual(defs.map((d) => d.id), ['a', 'd']);
});

// ---------------------------------------------------------------------------
// Logros
// ---------------------------------------------------------------------------

/** Doble de perfil: sin almacenamiento, sin DOM. */
function fakeProfile(): ProfileHandle {
  const profile = defaultProfile();
  return {
    current: profile,
    patch(mutate) {
      mutate(profile);
    },
  };
}

const DEFS: AchievementDef[] = [
  {
    id: 'ach_ante',
    nameKey: 'achievement.ach_ante_3.name',
    descKey: 'achievement.ach_ante_3.desc',
    event: 'round:win',
    when: { op: 'gte', path: 'ctx.ante', value: 3 },
    reward: { type: 'card', id: 'ghost_fungus' },
  },
  {
    id: 'ach_cards',
    nameKey: 'achievement.ach_cards_100.name',
    descKey: 'achievement.ach_cards_100.desc',
    event: 'card:played',
    incremental: { max: 3 },
  },
];

test('un logro con predicado se desbloquea y emite el evento con su reward', () => {
  const bus = new Emitter<GameEventMap>();
  const profile = fakeProfile();
  const seen: string[] = [];
  bus.on('achievement:unlocked', (payload) => seen.push(payload.id));

  const tracker = new AchievementTracker({ bus, defs: DEFS, profile, getContext: () => ({ ante: 3 }) });
  tracker.start();

  bus.emit('round:win', { score: 10, target: 5, reward: 3, money: 7 });
  assert.deepEqual(seen, ['ach_ante']);
  assert.ok(profile.current.collection.unlockedCardIds.includes('ghost_fungus'));
  assert.equal(profile.current.collection.unlockSource['ghost_fungus'], 'achievement');
});

test('un logro incremental acumula y solo se desbloquea al llegar al maximo', () => {
  const bus = new Emitter<GameEventMap>();
  const profile = fakeProfile();
  const seen: string[] = [];
  bus.on('achievement:unlocked', (payload) => seen.push(payload.id));

  const tracker = new AchievementTracker({ bus, defs: DEFS, profile, getContext: () => ({}) });
  tracker.start();

  const card = { uid: 'u1', def: { id: 'spore_puffball' } } as never;
  bus.emit('card:played', { card, index: 0 });
  bus.emit('card:played', { card, index: 1 });
  assert.equal(seen.length, 0, 'con 2 de 3 todavia no');
  assert.equal(tracker.progressOf('ach_cards'), 2);

  bus.emit('card:played', { card, index: 2 });
  assert.deepEqual(seen, ['ach_cards']);
  assert.equal(tracker.progressOf('ach_cards'), 3);
});

test('un logro ya desbloqueado no se vuelve a emitir ni a suscribir', () => {
  const bus = new Emitter<GameEventMap>();
  const profile = fakeProfile();
  profile.current.achievements.unlockedIds.push('ach_ante');

  const seen: string[] = [];
  bus.on('achievement:unlocked', (payload) => seen.push(payload.id));

  const tracker = new AchievementTracker({ bus, defs: DEFS, profile, getContext: () => ({ ante: 9 }) });
  const stop = tracker.start();
  bus.emit('round:win', { score: 10, target: 5, reward: 3, money: 7 });
  assert.deepEqual(seen, []);

  stop();
  bus.emit('round:win', { score: 10, target: 5, reward: 3, money: 7 });
  assert.equal(bus.listenerCount('round:win'), 0, 'stop() tiene que desuscribir');
});

// ---------------------------------------------------------------------------
// Migracion: los campos nuevos son ADITIVOS
// ---------------------------------------------------------------------------

test('un perfil viejo (sin daily ni achievements) migra con defaults', () => {
  const old = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { lang: 'es' },
    entitlements: { owned: ['pack.base'], passes: [] },
    collection: { seenCardIds: ['spore_puffball'], unlockedCardIds: [], unlockedJokerIds: [] },
    cosmetics: { equippedCardBack: 'default', equippedFelt: 'default', owned: ['default'] },
    stats: { runs: 3, wins: 1, bestAnte: 4, totalXp: 0, playtimeMs: 0 },
  };
  const migrated = migrateProfileSave(old);

  assert.equal(migrated.stats.runs, 3, 'no se pierde lo que ya estaba');
  assert.deepEqual(migrated.collection.seenCardIds, ['spore_puffball']);
  assert.deepEqual(migrated.daily, {
    lastClaimDate: null,
    lastClaimTs: 0,
    streak: 0,
    bestStreak: 0,
    history: [],
  });
  assert.deepEqual(migrated.achievements, { unlockedIds: [], progress: {} });
  assert.deepEqual(migrated.collection.unlockSource, {});
  assert.equal(migrated.settings.notifyDaily, true);
  assert.equal(migrated.settings.notifyAchievements, true);
});

test('un perfil CON racha la conserva al migrar', () => {
  const withDaily = {
    ...defaultProfile(),
    daily: { lastClaimDate: '2026-09-20', lastClaimTs: 1, streak: 4, bestStreak: 4, history: ['2026-09-20'] },
  };
  const migrated = migrateProfileSave(JSON.parse(JSON.stringify(withDaily)));
  assert.equal(migrated.daily.streak, 4);
  assert.equal(migrated.daily.bestStreak, 4);
});
