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
  DAILY_HARD_CAP,
  REPEAT_MULTIPLIER,
  applyBlindAward,
  blindBaseSpores,
  colonyLevelNameKey,
  computeBlindAward,
  dailyRemaining,
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
  assert.equal(levelThreshold(2), 50);
  assert.equal(levelThreshold(5), 350);
  assert.equal(levelThreshold(10), 1600);
});

test('levelForSpores corta en el umbral exacto', () => {
  assert.equal(levelForSpores(0), 1);
  assert.equal(levelForSpores(49), 1);
  assert.equal(levelForSpores(50), 2);
  assert.equal(levelForSpores(119), 2);
  assert.equal(levelForSpores(120), 3);
  assert.equal(levelForSpores(350), 5);
  assert.equal(levelForSpores(1600), 10);
  assert.equal(levelForSpores(levelThreshold(11) - 1), 10);
  assert.equal(levelForSpores(levelThreshold(11)), 11);
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
  assert.equal(progress.dailySporesAwarded, 75);
  assert.equal(result.levelBefore, 1);
  // 75 Esporas ya alcanzan el umbral 50 del nivel 2.
  assert.equal(result.levelAfter, 2);
});

test('grantSpores sube de nivel y desbloquea las recompensas saltadas', () => {
  const progress = defaultColonyProgress();
  const result = grantSpores(progress, 1200);
  assert.equal(result.levelBefore, 1);
  // 1200 cae dentro del tramo del nivel 8 (950..1250), no llega al 9 (1250).
  assert.equal(result.levelAfter, 8);
  assert.equal(progress.level, 8);
  // Niveles 2..8: siete recompensas (el 1 no otorga nada).
  assert.equal(result.newRewards.length, 7);
  assert.deepEqual(result.newRewards, [
    'frame_common',
    'pack_spores',
    'bg_new',
    'title_mycelium',
    'victory_fx',
    'pack_colony',
    'avatar',
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

test('nextLevelInfo describe el tramo actual y su PROXIMO desbloqueo', () => {
  const progress = defaultColonyProgress();
  progress.lifetimeSpores = 575;
  progress.level = levelForSpores(progress.lifetimeSpores);
  const info = nextLevelInfo(progress);
  assert.equal(info.level, 6);
  assert.equal(info.current, 500);
  assert.equal(info.next, 700);
  assert.equal(info.remaining, 125);
  assert.ok(Math.abs(info.progress - 75 / 200) < 1e-9);
  // Nivel 6 -> el proximo desbloqueo es el nivel 7 (COLONY_LEVELS[6]).
  assert.equal(info.rewardId, 'pack_colony');
});

test('nextLevelInfo NO repite el premio cuando el jugador esta en el umbral', () => {
  // Regresion del off-by-one: clavado en el umbral del nivel 6 (500 exactas) el
  // premio del nivel 6 (victory_fx) YA es del jugador; "Proximo desbloqueo"
  // tiene que apuntar al 7 (pack_colony), no al 6.
  const progress = defaultColonyProgress();
  progress.lifetimeSpores = 500;
  progress.level = levelForSpores(progress.lifetimeSpores);
  assert.equal(progress.level, 6);
  const atThreshold = nextLevelInfo(progress);
  assert.equal(atThreshold.current, 500);
  assert.equal(atThreshold.next, levelThreshold(7));
  assert.equal(atThreshold.rewardId, 'pack_colony');
  assert.notEqual(atThreshold.rewardId, 'victory_fx');

  // Un spore por debajo del umbral el nivel sigue siendo 5 y el proximo
  // desbloqueo es el 6 (victory_fx).
  progress.lifetimeSpores = 499;
  progress.level = levelForSpores(progress.lifetimeSpores);
  assert.equal(progress.level, 5);
  const justBelow = nextLevelInfo(progress);
  assert.equal(justBelow.current, levelThreshold(5));
  assert.equal(justBelow.next, 500);
  assert.equal(justBelow.rewardId, 'victory_fx');
});

test('la escalera definida a mano tiene la forma esperada', () => {
  assert.equal(COLONY_LAST_DEFINED_LEVEL, 10);
  const progress = defaultColonyProgress();
  progress.lifetimeSpores = 1600;
  progress.level = levelForSpores(progress.lifetimeSpores);
  const info = nextLevelInfo(progress);
  assert.equal(info.level, 10);
  // El nivel 10 es el techo de la escalera ESCRITA a mano: el 11 ya extrapola.
  assert.equal(info.next, levelThreshold(11));
  assert.ok(info.next > info.current);
});

test('el tope DURO diario recorta las Esporas acreditadas', () => {
  const progress = defaultColonyProgress();
  const first = grantSpores(progress, 70, NOON);
  assert.equal(first.granted, 70);
  assert.equal(first.capped, 0);
  assert.equal(progress.lifetimeSpores, 70);
  assert.equal(progress.level, 2);
  assert.equal(dailyRemaining(progress, NOON), DAILY_HARD_CAP - 70);

  // Lo que sobra del dia se recorta: 70 + 90 pedidas -> solo entran 30.
  const second = grantSpores(progress, 90, NOON);
  assert.equal(second.granted, 30);
  assert.equal(second.capped, 60);
  assert.equal(progress.lifetimeSpores, DAILY_HARD_CAP);
  assert.equal(dailyRemaining(progress, NOON), 0);

  // El dia ya toco techo: nada entra.
  const third = grantSpores(progress, 50, NOON);
  assert.equal(third.granted, 0);
  assert.equal(third.dailyCapped, true);
  assert.equal(progress.lifetimeSpores, DAILY_HARD_CAP);

  // Al dia siguiente la ventana se reabre completa.
  const tomorrow = NOON + 24 * 60 * 60 * 1000;
  const next = grantSpores(progress, 40, tomorrow);
  assert.equal(next.granted, 40);
  assert.equal(progress.lifetimeSpores, DAILY_HARD_CAP + 40);
});

test('sin fecha no hay ventana diaria: grantSpores acredita completo', () => {
  const progress = defaultColonyProgress();
  const result = grantSpores(progress, DAILY_HARD_CAP * 3);
  assert.equal(result.granted, DAILY_HARD_CAP * 3);
  assert.equal(result.capped, 0);
});
