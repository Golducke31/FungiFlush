/**
 * colony.test.ts — Meta-progresion de la Colonia Fungi.
 *
 * La regla que estos tests protegen: las Esporas de Colonia se ganan SUPERANDO
 * CIEGOS, la primera vez paga completo y repetir paga menos (pero nunca cero).
 * Si eso se rompe, la economia meta deja de premiar el progreso y pasa a
 * premiar el farmeo del primer Ciego.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BONUS_DISCARDS_LEFT,
  BONUS_FIRST_HAND,
  COLONY_LAST_DEFINED_LEVEL,
  DAILY_FULL_AWARDS,
  REPEAT_MULTIPLIER,
  applyBlindAward,
  blindBaseSpores,
  colonyLevelNameKey,
  computeBlindAward,
  defaultColonyProgress,
  grantSpores,
  levelForSpores,
  levelThreshold,
  localDateKey,
  nextLevelInfo,
} from '../src/meta/Colony.ts';

const NOON = Date.UTC(2026, 9, 6, 15, 0, 0);

test('la tabla de Esporas base por ante arranca en 50 y termina en 300', () => {
  assert.equal(blindBaseSpores(1), 50);
  assert.equal(blindBaseSpores(2), 75);
  assert.equal(blindBaseSpores(3), 100);
  assert.equal(blindBaseSpores(8), 300);
  // Extrapolacion: el contenido puede agregar antes.
  assert.equal(blindBaseSpores(9), 375);
  assert.ok(blindBaseSpores(12) > blindBaseSpores(11));
});

test('la escalera de niveles es monotona y creciente', () => {
  let previous = -1;
  for (let level = 1; level <= 25; level++) {
    const value = levelThreshold(level);
    assert.ok(value > previous, `el nivel ${level} debe costar mas que el ${level - 1}`);
    previous = value;
  }
  assert.equal(levelThreshold(1), 0);
  assert.equal(levelThreshold(2), 100);
  assert.equal(levelThreshold(5), 700);
  assert.equal(levelThreshold(10), 3000);
});

test('levelForSpores corta en el umbral exacto', () => {
  assert.equal(levelForSpores(0), 1);
  assert.equal(levelForSpores(99), 1);
  assert.equal(levelForSpores(100), 2);
  assert.equal(levelForSpores(249), 2);
  assert.equal(levelForSpores(250), 3);
  assert.equal(levelForSpores(700), 5);
  assert.equal(levelForSpores(3000), 10);
  assert.equal(levelForSpores(3449), 10);
  assert.equal(levelForSpores(3450), 11);
});

test('el nombre del nivel va por bandas, no uno por nivel', () => {
  assert.equal(colonyLevelNameKey(1), 'colony.band.dormant');
  assert.equal(colonyLevelNameKey(4), 'colony.band.dormant');
  assert.equal(colonyLevelNameKey(5), 'colony.band.sprout');
  assert.equal(colonyLevelNameKey(10), 'colony.band.emerging');
  assert.equal(colonyLevelNameKey(20), 'colony.band.deep');
  assert.equal(colonyLevelNameKey(30), 'colony.band.underground');
  assert.equal(colonyLevelNameKey(50), 'colony.band.primordial');
  assert.equal(colonyLevelNameKey(120), 'colony.band.primordial');
});

test('la primera superacion paga completo; repetir paga el 40%', () => {
  const progress = defaultColonyProgress();
  const first = computeBlindAward(progress, {
    ante: 3,
    blindIndex: 0,
    firstHandClear: false,
    discardsLeft: 0,
    now: NOON,
  });
  assert.equal(first.base, 100);
  assert.equal(first.multiplier, 1);
  assert.equal(first.firstClear, true);
  assert.equal(first.total, 100);

  applyBlindAward(progress, first, NOON);

  const repeat = computeBlindAward(progress, {
    ante: 3,
    blindIndex: 0,
    firstHandClear: false,
    discardsLeft: 0,
    now: NOON,
  });
  assert.equal(repeat.firstClear, false);
  assert.equal(repeat.multiplier, REPEAT_MULTIPLIER);
  assert.equal(repeat.total, 40);
  // "Nunca llega a cero": el piso es 1.
  assert.ok(repeat.total > 0);
});

test('las bonificaciones secundarias se suman a la base', () => {
  const progress = defaultColonyProgress();
  const award = computeBlindAward(progress, {
    ante: 1,
    blindIndex: 2,
    firstHandClear: true,
    discardsLeft: 2,
    now: NOON,
  });
  assert.equal(award.base, 50);
  assert.equal(award.bonuses.length, 2);
  assert.equal(award.total, 50 + BONUS_FIRST_HAND + BONUS_DISCARDS_LEFT);
});

test('el tope blando diario reduce despues de N Ciegos premiados', () => {
  const progress = defaultColonyProgress();
  const ctx = { ante: 1, blindIndex: 0, firstHandClear: false, discardsLeft: 0, now: NOON };
  for (let i = 0; i < DAILY_FULL_AWARDS; i++) {
    const award = computeBlindAward(progress, { ...ctx, blindIndex: i });
    assert.equal(award.multiplier, 1, `el premio ${i + 1} del dia va completo`);
    applyBlindAward(progress, award, NOON);
  }
  const capped = computeBlindAward(progress, { ...ctx, blindIndex: 3 });
  assert.equal(capped.dailyCapped, true);
  assert.equal(capped.multiplier, REPEAT_MULTIPLIER);
  // Y al dia siguiente vuelve a estar completo.
  const tomorrow = NOON + 24 * 60 * 60 * 1000;
  const next = computeBlindAward(progress, { ...ctx, blindIndex: 3, now: tomorrow });
  assert.equal(next.dailyCapped, false);
});

test('applyBlindAward acumula Esporas, memoria de anti-farm y tope diario', () => {
  const progress = defaultColonyProgress();
  const award = computeBlindAward(progress, {
    ante: 2,
    blindIndex: 1,
    firstHandClear: false,
    discardsLeft: 0,
    now: NOON,
  });
  const result = applyBlindAward(progress, award, NOON);

  assert.equal(progress.lifetimeSpores, 75);
  assert.equal(progress.seasonSpores, 75);
  assert.deepEqual(progress.firstClears, ['2:1']);
  assert.equal(progress.dailyAwardedDate, localDateKey(NOON));
  assert.equal(progress.dailyAwardedCount, 1);
  assert.equal(result.levelBefore, 1);
  assert.equal(result.levelAfter, 1);
});

test('grantSpores sube de nivel y desbloquea las recompensas saltadas', () => {
  const progress = defaultColonyProgress();
  const result = grantSpores(progress, 1200);
  assert.equal(result.levelBefore, 1);
  assert.equal(result.levelAfter, 6);
  assert.equal(progress.level, 6);
  // Niveles 2..6: cinco recompensas (el 1 no otorga nada).
  assert.equal(result.newRewards.length, 5);
  assert.deepEqual(result.newRewards, [
    'frame_common',
    'pack_spores',
    'bg_new',
    'title_mycelium',
    'victory_fx',
  ]);
  // Idempotente: volver a otorgar no duplica.
  const again = grantSpores(progress, 0);
  assert.deepEqual(again.newRewards, []);
});

test('el nivel nunca baja', () => {
  const progress = defaultColonyProgress();
  grantSpores(progress, 5000);
  const high = progress.level;
  assert.ok(high >= 10);
  progress.lifetimeSpores = 10;
  const result = grantSpores(progress, 0);
  assert.equal(progress.level, high);
  assert.equal(result.levelAfter, levelForSpores(10));
  assert.equal(progress.level, Math.max(high, result.levelAfter));
});

test('nextLevelInfo describe el tramo actual para la barra', () => {
  const progress = defaultColonyProgress();
  progress.lifetimeSpores = 1175;
  progress.level = levelForSpores(progress.lifetimeSpores);
  const info = nextLevelInfo(progress);
  assert.equal(info.level, 6);
  assert.equal(info.current, 1000);
  assert.equal(info.next, 1400);
  assert.equal(info.remaining, 225);
  assert.ok(Math.abs(info.progress - 175 / 400) < 1e-9);
  assert.equal(info.rewardId, 'pack_colony');
});

test('la escalera definida a mano tiene la forma esperada', () => {
  assert.equal(COLONY_LAST_DEFINED_LEVEL, 10);
  const progress = defaultColonyProgress();
  progress.lifetimeSpores = 3000;
  progress.level = levelForSpores(progress.lifetimeSpores);
  const info = nextLevelInfo(progress);
  assert.equal(info.level, 10);
  // El nivel 10 es el techo de la escalera ESCRITA a mano: el 11 ya extrapola.
  assert.equal(info.next, 3450);
});
