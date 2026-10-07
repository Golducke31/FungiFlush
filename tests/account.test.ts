/**
 * account.test.ts — Identidad y sincronizacion (capa meta).
 *
 * La cuenta es OPCIONAL: el juego se juega entero offline. Estos tests fijan
 * las dos reglas que importan:
 *   1. desvincular NUNCA borra el progreso local;
 *   2. lo que se sube es el RESULTADO, no las Esporas calculadas por el cliente.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isTauriRuntime,
  linkAccount,
  makeRunResult,
  markConflict,
  markSynced,
  queueRunResult,
  syncStateLabelKey,
  unlinkAccount,
} from '../src/meta/Account.ts';
import { PENDING_RESULTS_CAP, defaultProfile } from '../src/meta/ProfileState.ts';

const IDENTITY = { id: 'gpg_123', displayName: 'Nova', provider: 'google-play' as const };

test('vincular una cuenta deja el progreso pendiente de subir', () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  assert.equal(profile.account.provider, 'google-play');
  assert.equal(profile.account.accountId, 'gpg_123');
  assert.equal(profile.account.displayName, 'Nova');
  assert.equal(profile.account.syncState, 'pending');
});

test('desvincular NO borra el progreso local', () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  profile.colony.lifetimeSpores = 1850;
  profile.colony.level = 8;
  unlinkAccount(profile);

  assert.equal(profile.account.provider, 'none');
  assert.equal(profile.account.accountId, null);
  assert.equal(profile.account.syncState, 'offline');
  // El progreso sigue ahi: la cuenta es opcional, no la duena del perfil.
  assert.equal(profile.colony.lifetimeSpores, 1850);
  assert.equal(profile.colony.level, 8);
});

test('queueRunResult encola sin duplicar y capea la cola', () => {
  const profile = defaultProfile();
  const result = makeRunResult({
    runId: 'r1',
    startedAt: '2026-10-06T10:00:00.000Z',
    completedAt: '2026-10-06T10:30:00.000Z',
    mode: 'classic',
    highestBlind: 4,
    completedBlinds: 10,
    scoreSummary: 12345,
    clientVersion: '0.1.0',
  });

  // Sin cuenta: el resultado se guarda igual (offline-first) pero el estado
  // sigue siendo `offline` (no hay a donde subirlo).
  queueRunResult(profile, result);
  assert.equal(profile.account.pendingResults.length, 1);
  assert.equal(profile.account.syncState, 'offline');

  // Duplicado por runId: no se encola dos veces.
  queueRunResult(profile, result);
  assert.equal(profile.account.pendingResults.length, 1);

  // Con cuenta vinculada, encolar marca `pending`.
  linkAccount(profile, IDENTITY);
  queueRunResult(profile, { ...result, runId: 'r2' });
  assert.equal(profile.account.syncState, 'pending');

  // La cola esta capeada.
  for (let i = 0; i < PENDING_RESULTS_CAP + 5; i++) {
    queueRunResult(profile, { ...result, runId: `bulk_${i}` });
  }
  assert.equal(profile.account.pendingResults.length, PENDING_RESULTS_CAP);
});

test('el resultado que se sube NO lleva Esporas (anti-trampa)', () => {
  const result = makeRunResult({
    runId: 'r1',
    startedAt: '2026-10-06T10:00:00.000Z',
    completedAt: '2026-10-06T10:30:00.000Z',
    mode: 'ascension',
    highestBlind: 6,
    completedBlinds: 15,
    scoreSummary: 99999,
    clientVersion: '0.1.0',
  });
  const keys = Object.keys(result);
  assert.ok(!keys.some((k) => /spore/i.test(k)), 'el cliente no manda Esporas');
  assert.equal(result.highestBlind, 6);
  assert.equal(result.completedBlinds, 15);
  assert.equal(result.mode, 'ascension');
});

test('markSynced vacia la cola y sella ambas fechas', () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  queueRunResult(profile, {
    runId: 'r1',
    startedAt: '2026-10-06T10:00:00.000Z',
    completedAt: '2026-10-06T10:30:00.000Z',
    mode: 'classic',
    highestBlind: 2,
    completedBlinds: 3,
    scoreSummary: 100,
    clientVersion: '0.1.0',
  });
  markSynced(profile, '2026-10-06T11:00:00.000Z');
  assert.deepEqual(profile.account.pendingResults, []);
  assert.equal(profile.account.syncState, 'synced');
  assert.equal(profile.account.lastSyncAt, '2026-10-06T11:00:00.000Z');
  assert.equal(profile.colony.lastSyncAt, '2026-10-06T11:00:00.000Z');
});

test('markConflict deja el estado en conflicto', () => {
  const profile = defaultProfile();
  linkAccount(profile, IDENTITY);
  markConflict(profile);
  assert.equal(profile.account.syncState, 'conflict');
});

test('cada estado de sync tiene su clave i18n', () => {
  assert.equal(syncStateLabelKey('offline'), 'colony.account.sync.offline');
  assert.equal(syncStateLabelKey('pending'), 'colony.account.sync.pending');
  assert.equal(syncStateLabelKey('synced'), 'colony.account.sync.synced');
  assert.equal(syncStateLabelKey('conflict'), 'colony.account.sync.conflict');
});

test('fuera de Tauri no se toca nada nativo', () => {
  // En Node no hay `window`: el proveedor de Play Games nunca se activa.
  assert.equal(isTauriRuntime(), false);
});
