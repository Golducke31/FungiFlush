/**
 * leaderboard.test.ts — Ranking global (V1.3).
 *
 * Lo que estos tests protegen:
 *   1. el cliente NUNCA calcula Esporas para mandar: solo sube el RESULTADO;
 *   2. una respuesta rara del servidor no rompe la pantalla (se valida);
 *   3. un error de red deja la cola intacta (no se pierde progreso);
 *   4. un resultado RECHAZADO marca conflicto pero no borra nada.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COLONY_MILESTONES,
  emptySnapshot,
  formatRank,
  markSelf,
  milestoneViews,
  percentileOf,
  rankTierFor,
  sanitizeBoard,
  sanitizeSubmitResult,
} from '../src/meta/Leaderboard.ts';
import { flushPendingResults, refreshBoards } from '../src/meta/LeaderboardSync.ts';
import { linkAccount, queueRunResult, makeRunResult } from '../src/meta/Account.ts';
import { defaultProfile } from '../src/meta/ProfileState.ts';
import type { LeaderboardTransport } from '../src/net/LeaderboardClient.ts';
import { createOfflineTransport } from '../src/net/LeaderboardClient.ts';

const IDENTITY = { id: 'gpg_1', displayName: 'Nova', provider: 'google-play' as const };

function runResult(runId: string) {
  return makeRunResult({
    runId,
    startedAt: '2026-10-06T10:00:00.000Z',
    completedAt: '2026-10-06T10:30:00.000Z',
    mode: 'classic',
    highestBlind: 3,
    completedBlinds: 6,
    scoreSummary: 5000,
    clientVersion: '1.0.0',
  });
}

/** Transporte falso: registra lo que se le manda y devuelve lo que se le pide. */
function fakeTransport(overrides: Partial<LeaderboardTransport> = {}): LeaderboardTransport & {
  submitted: string[];
} {
  const submitted: string[] = [];
  return {
    enabled: true,
    disabledReason: null,
    submitted,
    async submit(payload) {
      submitted.push(payload.result.runId);
      return { awarded: 100, lifetimeSpores: 1100, seasonSpores: 300, level: 6 };
    },
    async fetchBoard(scope) {
      return {
        scope,
        seasonId: scope === 'season' ? 's1' : '',
        entries: [
          { playerId: 'a', displayName: 'A', spores: 900, level: 5, updatedAt: '', isSelf: false },
          { playerId: 'gpg_1', displayName: 'Nova', spores: 800, level: 4, updatedAt: '', isSelf: false },
        ],
        selfRank: 2,
        total: 50,
        fetchedAt: '2026-10-06T12:00:00.000Z',
      };
    },
    ...overrides,
  };
}

test('el percentil y el premio por posicion cortan por porcentaje, no por puesto', () => {
  // Mismo percentil en tableros de tamanos muy distintos.
  assert.equal(percentileOf(1, 50), 2);
  assert.equal(percentileOf(1, 50_000), 1);
  assert.equal(rankTierFor(1, 50).id, 'top5');
  assert.equal(rankTierFor(1, 50_000).id, 'top1');
  // El ultimo puesto siempre entra (premio de participacion).
  assert.equal(rankTierFor(50, 50).id, 'participation');
  assert.equal(percentileOf(50, 50), 100);
});

test('el percentil acota entradas imposibles', () => {
  assert.equal(percentileOf(0, 10), 10);
  assert.equal(percentileOf(999, 10), 100);
  assert.equal(percentileOf(1, 0), 100);
});

test('formatRank nunca miente con un jugador sin posicion', () => {
  assert.equal(formatRank(12, 340), '12 / 340');
  assert.equal(formatRank(null, 340), '—');
});

test('sanitizeBoard descarta filas invalidas y capea el tablero', () => {
  const raw = {
    seasonId: 's1',
    total: 3,
    selfRank: 2,
    fetchedAt: '2026-10-06T12:00:00.000Z',
    entries: [
      { playerId: 'a', displayName: 'A', spores: 10, level: 1 },
      { playerId: '', displayName: 'sin id' }, // se descarta
      'basura', // se descarta
      { playerId: 'b', spores: -50, level: 0 },
    ],
  };
  const board = sanitizeBoard(raw, 'season');
  assert.ok(board);
  assert.equal(board.entries.length, 2);
  // Las Esporas negativas y el nivel 0 se sanean, no se propagan.
  assert.equal(board.entries[1]?.spores, 0);
  assert.equal(board.entries[1]?.level, 1);
  assert.equal(board.selfRank, 2);
});

test('sanitizeBoard rechaza un documento que no sirve', () => {
  assert.equal(sanitizeBoard(null, 'season'), null);
  assert.equal(sanitizeBoard('roto', 'season'), null);
  assert.equal(sanitizeBoard({ total: 5 }, 'season'), null); // sin `entries`
});

test('sanitizeSubmitResult rechaza una respuesta sin `awarded`', () => {
  assert.equal(sanitizeSubmitResult({ lifetimeSpores: 10 }), null);
  const ok = sanitizeSubmitResult({ awarded: 120.6, lifetimeSpores: 1200, seasonSpores: 400, level: 7 });
  assert.ok(ok);
  assert.equal(ok.awarded, 121);
  assert.equal(ok.level, 7);
});

test('markSelf marca la fila propia sin mutar la original', () => {
  const board = sanitizeBoard({ entries: [{ playerId: 'x' }, { playerId: 'me' }], total: 2 }, 'lifetime');
  assert.ok(board);
  const marked = markSelf(board, 'me');
  assert.equal(marked.entries[1]?.isSelf, true);
  assert.equal(board.entries[1]?.isSelf, false, 'la cache no se muta');
});

test('los hitos personales existen y son alcanzables', () => {
  const profile = defaultProfile();
  const views = milestoneViews(profile);
  assert.equal(views.length, COLONY_MILESTONES.length);
  assert.ok(views.every((v) => !v.met), 'un perfil nuevo no tiene hitos cumplidos');

  profile.colony.lifetimeSpores = 1500;
  profile.colony.level = 10;
  const later = milestoneViews(profile);
  assert.equal(later.find((v) => v.id === 'spores_1000')?.met, true);
  assert.equal(later.find((v) => v.id === 'level_10')?.met, true);
  assert.equal(later.find((v) => v.id === 'blinds_10')?.met, false, 'sin historial no hay ciegos');
});

test('el sync sube la cola, la vacia y NO re-acredita Esporas locales', async () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  queueRunResult(profile, runResult('r1'));
  queueRunResult(profile, runResult('r2'));
  const before = profile.colony.lifetimeSpores;

  const transport = fakeTransport();
  const outcome = await flushPendingResults(profile, transport, IDENTITY, Date.now());

  assert.equal(outcome.submitted, 2);
  assert.equal(outcome.rejected, 0);
  assert.deepEqual(transport.submitted, ['r1', 'r2']);
  assert.deepEqual(profile.account.pendingResults, []);
  assert.equal(profile.account.syncState, 'synced');
  // El libro LOCAL no se toca: las Esporas se acreditaron al superar el Ciego.
  assert.equal(profile.colony.lifetimeSpores, before);
  // Lo verificado por el servidor se guarda aparte.
  assert.equal(profile.account.verifiedSpores, 1100);
});

test('un error de red deja la cola intacta (no se pierde progreso)', async () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  queueRunResult(profile, runResult('r1'));

  const transport = fakeTransport({
    async submit() {
      throw new Error('sin red');
    },
  });
  const outcome = await flushPendingResults(profile, transport, IDENTITY, Date.now());

  assert.equal(outcome.submitted, 0);
  assert.equal(outcome.error, 'sin red');
  assert.equal(profile.account.pendingResults.length, 1, 'el resultado sigue en la cola');
});

test('un resultado RECHAZADO marca conflicto y no borra lo ganado', async () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  queueRunResult(profile, runResult('r1'));
  profile.colony.lifetimeSpores = 500;

  const transport = fakeTransport({
    async submit() {
      return { awarded: 0, lifetimeSpores: 0, seasonSpores: 0, level: 1, rejected: true, reason: 'fuera de rango' };
    },
  });
  const outcome = await flushPendingResults(profile, transport, IDENTITY, Date.now());

  assert.equal(outcome.rejected, 1);
  assert.equal(profile.account.syncState, 'conflict');
  assert.equal(profile.colony.lifetimeSpores, 500, 'las Esporas locales no se quitan hacia atras');
});

test('sin cuenta vinculada el sync no hace nada', async () => {
  const profile = defaultProfile();
  queueRunResult(profile, runResult('r1'));
  const transport = fakeTransport();
  const outcome = await flushPendingResults(profile, transport, null, Date.now());
  assert.equal(outcome.hadWork, false);
  assert.equal(transport.submitted.length, 0);
  assert.equal(profile.account.pendingResults.length, 1);
});

test('refreshBoards cachea los dos tableros en el perfil', async () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  const transport = fakeTransport();
  const outcome = await refreshBoards(profile, transport, IDENTITY.id, Date.now());

  assert.ok(outcome.season);
  assert.ok(outcome.lifetime);
  assert.equal(profile.account.leaderboard.season?.total, 50);
  assert.equal(profile.account.leaderboard.lifetime?.scope, 'lifetime');
  assert.ok(profile.account.leaderboard.fetchedAt);
});

test('un tablero que falla no invalida el otro', async () => {
  const profile = defaultProfile();
  const transport = fakeTransport({
    async fetchBoard(scope) {
      if (scope === 'season') throw new Error('timeout');
      return {
        scope,
        seasonId: '',
        entries: [],
        selfRank: null,
        total: 0,
        fetchedAt: '2026-10-06T12:00:00.000Z',
      };
    },
  });
  const outcome = await refreshBoards(profile, transport, null, Date.now());
  assert.equal(outcome.season, null);
  assert.ok(outcome.lifetime);
  assert.equal(outcome.error, 'timeout');
});

test('el transporte apagado no inventa tableros', async () => {
  const transport = createOfflineTransport('sin servidor');
  assert.equal(transport.enabled, false);
  assert.equal(transport.disabledReason, 'sin servidor');
  const profile = defaultProfile();
  const outcome = await refreshBoards(profile, transport, null, Date.now());
  assert.equal(outcome.season, null);
  assert.equal(outcome.error, 'sin servidor');
  assert.deepEqual(profile.account.leaderboard, emptySnapshot());
});
