/**
 * dailyRun.test.ts — Desafio diario (R1).
 *
 * Lo que se protege aca:
 *
 *   1. La semilla sale SOLO de la fecha y es estable entre versiones: si
 *      cambiara, todos los diarios ya jugados dejarian de ser "el mismo" que
 *      el de los demas jugadores de ese dia.
 *   2. La fecha es LOCAL (el dia del jugador): con UTC, medio mundo veria
 *      cambiar el diario a mitad de la tarde.
 *   3. Misma fecha = misma run: misma semilla, mismo primer ciego y misma mano
 *      inicial. Es la promesa central de la feature.
 *   4. La run diaria sobrevive al guardado sin subir `SAVE_VERSION` (campo
 *      aditivo), y un guardado viejo restaura como clasica.
 *   5. El intento del dia bloquea SOLO la misma fecha, y la recompensa diaria
 *      es un intento SEPARADO (se puede reclamar sin jugar la run y al reves).
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { hashString } from '../src/engine/rng.ts';
import { dailyDateAt, dailyPlayed, dailySeed, dailySeedAt } from '../src/meta/DailyRun.ts';
import { defaultProfile } from '../src/meta/ProfileState.ts';
import { migrateProfileSave } from '../src/persistence/migrations.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

const content = buildRegistry().toBundle();

// ---------------------------------------------------------------------------
// Semilla
// ---------------------------------------------------------------------------

test('la semilla del diario es determinista y depende SOLO de la fecha', () => {
  assert.equal(dailySeed('2026-10-24'), dailySeed('2026-10-24'));
  assert.notEqual(dailySeed('2026-10-24'), dailySeed('2026-10-25'));
  // FNV-1a estable (rng.ts). El prefijo es parte del contrato: cambiarlo
  // invalidaria los diarios ya jugados.
  assert.equal(dailySeed('2026-10-24'), hashString('fungiflush:daily:2026-10-24'));
  // Valor de referencia fijado a proposito: si el hash cambia, este test
  // falla y obliga a decidir CONSCIENTEMENTE que los diarios viejos cambian.
  assert.equal(dailySeed('2026-10-24'), 1063783450);
});

test('la fecha del diario es LOCAL (el dia del jugador, no el de Greenwich)', () => {
  // 23:30 del 24 local sigue siendo el 24 aunque en UTC ya sea otro dia (o al
  // reves, segun la zona): la clave se arma con los getters LOCALES de Date.
  const lateNight = new Date(2026, 9, 24, 23, 30).getTime();
  assert.equal(dailyDateAt(lateNight), '2026-10-24');
  assert.equal(dailySeedAt(lateNight), dailySeed('2026-10-24'));
  // Y un cambio de dia local cambia la semilla.
  const nextDay = new Date(2026, 9, 25, 0, 10).getTime();
  assert.notEqual(dailySeedAt(lateNight), dailySeedAt(nextDay));
});

// ---------------------------------------------------------------------------
// Misma fecha = misma run
// ---------------------------------------------------------------------------

/**
 * Firma de una run diaria: lo que tiene que coincidir entre dos jugadores.
 *
 * `engineSeed` es la semilla del MOTOR (la que en el navegador sale del reloj).
 * Se pasa distinta a proposito: la firma NO puede depender de ella. Antes
 * dependia (`buildStarterDeck` barajaba con el RNG del motor), asi que dos
 * jugadores con la misma fecha recibian manos distintas — el bug que este test
 * protege.
 */
function dailySignature(
  date: string,
  engineSeed = 1,
): {
  seed: number;
  daily: boolean;
  blind: string | undefined;
  target: number | undefined;
  hand: string;
} {
  const seed = dailySeed(date);
  const engine = new GameEngine({ seed: engineSeed, bundle: content });
  // R3 — `tutorial: true` apaga el borrador de bendicion: la firma del dia es
  // semilla + primer ciego + mano inicial, y el borrador la retrasaria un paso.
  engine.startRun(seed, 0, '', true, true);
  engine.chooseBlind();
  return {
    seed: engine.run.seed,
    daily: engine.run.daily,
    blind: engine.round?.blind.id,
    target: engine.round?.target,
    hand: (engine.round?.hand ?? []).map((card) => card.def.id).join(','),
  };
}

test('misma fecha = misma semilla, mismo primer ciego y misma mano inicial', () => {
  const a = dailySignature('2026-10-24');
  const b = dailySignature('2026-10-24');
  assert.deepEqual(a, b);
  assert.equal(a.daily, true);
  assert.ok(a.hand.length > 0, 'la mano inicial no puede estar vacia');

  // La firma NO depende del RNG del motor: dos navegadores con relojes
  // distintos tienen que repartir la MISMA mano.
  const differentEngineRng = dailySignature('2026-10-24', 987654321);
  assert.deepEqual(a, differentEngineRng);

  // Otra fecha = otra run. Lo que cambia de verdad es la mano (el primer ciego
  // es el mismo id mientras haya un solo small por ante: R2 lo diversifica).
  const c = dailySignature('2026-10-25');
  assert.notEqual(a.seed, c.seed);
  assert.notEqual(a.hand, c.hand);
});

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------

test('la run diaria sobrevive al guardado (aditivo, sin bump de version)', () => {
  const engine = new GameEngine({ seed: dailySeed('2026-10-24'), bundle: content });
  engine.startRun(dailySeed('2026-10-24'), 0, '', true, true);
  engine.chooseBlind();
  const save = engine.serialize();
  assert.equal(save.daily, true);

  const reloaded = new GameEngine({ seed: 1, bundle: content });
  assert.equal(reloaded.restore(save), true);
  assert.equal(reloaded.run.daily, true);
  // El seed tambien sobrevive: una run diaria retomada sigue siendo LA MISMA.
  assert.equal(reloaded.run.seed, dailySeed('2026-10-24'));
});

test('un guardado anterior al diario restaura como run clasica', () => {
  const engine = new GameEngine({ seed: 5, bundle: content });
  engine.startRun(5, 0, '', false, true);
  engine.chooseBlind();
  const save = engine.serialize();
  delete (save as { daily?: boolean }).daily;

  const reloaded = new GameEngine({ seed: 5, bundle: content });
  assert.equal(reloaded.restore(save), true);
  assert.equal(reloaded.run.daily, false);
});

// ---------------------------------------------------------------------------
// El intento del dia
// ---------------------------------------------------------------------------

test('el intento del dia bloquea SOLO la misma fecha', () => {
  const profile = defaultProfile();
  assert.equal(profile.daily.playedDate, null);
  assert.equal(dailyPlayed(profile, '2026-10-24'), false);

  profile.daily.playedDate = '2026-10-24';
  assert.equal(dailyPlayed(profile, '2026-10-24'), true);
  assert.equal(dailyPlayed(profile, '2026-10-25'), false);
});

test('la recompensa diaria y la run diaria son intentos SEPARADOS', () => {
  const profile = defaultProfile();
  // Reclamar la recompensa NO consume la run del dia: `playedDate` sigue null
  // aunque `lastClaimDate` ya sea hoy.
  profile.daily.lastClaimDate = '2026-10-24';
  assert.equal(dailyPlayed(profile, '2026-10-24'), false);
  // Y jugar la run deja `lastClaimDate` como estaba: son campos distintos a
  // proposito (ver `DailyState.playedDate`).
  profile.daily.playedDate = '2026-10-24';
  assert.equal(profile.daily.lastClaimDate, '2026-10-24');
  assert.equal(dailyPlayed(profile, '2026-10-24'), true);
});

// ---------------------------------------------------------------------------
// Migracion v7 -> v8 (una sola para R1 + R4)
// ---------------------------------------------------------------------------

test('v7 -> v8: el diario arranca sin intento y los contadores en cero', () => {
  const migrated = migrateProfileSave({ version: 7 });
  assert.equal(migrated.daily.playedDate, null);
  assert.equal(migrated.stats.dailyRuns, 0);
  assert.equal(migrated.stats.dailyWins, 0);
  assert.equal(migrated.stats.bestScore, 0);
  assert.equal(migrated.stats.totalBlinds, 0);
});

test('v7 -> v8: conserva la racha y sanea basura en playedDate y stats', () => {
  const migrated = migrateProfileSave({
    version: 7,
    daily: {
      lastClaimDate: '2026-10-23',
      lastClaimTs: 1,
      streak: 4,
      bestStreak: 9,
      history: ['2026-10-23'],
      // Basura a proposito: un numero no puede volverse una fecha.
      playedDate: 42,
    },
    stats: { runs: 12, wins: 3, bestAnte: 5, totalXp: 100, playtimeMs: 1000, bestScore: -3, totalBlinds: 'mucho' },
  });
  assert.equal(migrated.daily.playedDate, null);
  assert.equal(migrated.daily.streak, 4);
  assert.equal(migrated.daily.bestStreak, 9);
  assert.equal(migrated.stats.runs, 12);
  assert.equal(migrated.stats.bestScore, 0);
  assert.equal(migrated.stats.totalBlinds, 0);
});
