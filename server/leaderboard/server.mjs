#!/usr/bin/env node
/**
 * server.mjs — Servidor de REFERENCIA del ranking global de FungiFlush (V1.3).
 *
 * QUE ES: la implementacion ejecutable del contrato que consume
 * `src/net/LeaderboardClient.ts`. Sirve para levantar el ranking de verdad, y
 * como especificacion de que tiene que hacer un backend de produccion.
 *
 * QUE NO ES: no es un servicio listo para produccion. Guarda en un JSON y no
 * tiene cuentas propias (confia en el `playerId` que manda el cliente). Antes de
 * abrirlo al publico hay que agregarle: verificacion del token de Play Games,
 * base de datos real, y las defensas de la seccion ANTI-TRAMPA.
 *
 * POR QUE EL SERVIDOR ES LA FUENTE DE VERDAD: el cliente NUNCA manda Esporas.
 * Manda el RESULTADO de la run (modo, Ciegos superados, score, version) y el
 * servidor RECALCULA la recompensa. Mandar `{sporesEarned: 999999}` es
 * imposible porque ese campo no existe en el contrato.
 *
 *   node server/leaderboard/server.mjs
 *   PORT=8080 DATA_FILE=./data.json ALLOWED_ORIGIN=https://tu-app.com node server.mjs
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = resolve(process.env.DATA_FILE ?? './leaderboard-data.json');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const MAX_BODY_BYTES = 8 * 1024;

// --- Reglas de validacion (ANTI-TRAMPA) -------------------------------------
const MAX_ANTE = 8;
const BLINDS_PER_ANTE = 3;
const MAX_SCORE = 1e9;
/** Tope de Esporas que una sola run puede acreditar. Corta un resultado absurdo. */
const MAX_AWARD_PER_RUN = 5000;
/** Ventana y tope de envios por jugador. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
/** Margen para tolerar relojes adelantados del dispositivo. */
const FUTURE_TOLERANCE_MS = 10 * 60_000;
/** Tolerancia hacia atras: una run de 24 Ciegos no dura un mes. */
const MAX_RUN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Esporas base por ante. Espejo de `BLIND_BASE_SPORES` en `src/meta/Colony.ts`. */
const BLIND_BASE_SPORES = [50, 75, 100, 130, 165, 205, 250, 300];
const REPEAT_MULTIPLIER = 0.4;

function baseForAnte(ante) {
  const index = Math.max(1, Math.floor(ante)) - 1;
  if (index < BLIND_BASE_SPORES.length) return BLIND_BASE_SPORES[index];
  return 300 + (index - (BLIND_BASE_SPORES.length - 1)) * 75;
}

/**
 * Cuantas Esporas vale la run, calculado SOLO con lo que el cliente puede
 * declarar: cuantos Ciegos supero (`completedBlinds`) y hasta que ante llego.
 *
 * `firstClears` es memoria del SERVIDOR: la primera vez que un jugador limpia un
 * ante paga completo, despues el 40 %. El cliente tiene su propia copia para
 * jugar offline, pero la que cuenta para el tablero es esta.
 */
function awardForRun(player, result) {
  const completed = Math.max(0, Math.min(result.completedBlinds, MAX_ANTE * BLINDS_PER_ANTE));
  let remaining = completed;
  let total = 0;
  const cleared = [];

  for (let ante = 1; ante <= MAX_ANTE && remaining > 0; ante++) {
    const inAnte = Math.min(BLINDS_PER_ANTE, remaining);
    remaining -= inAnte;
    const key = String(ante);
    const first = !player.firstClears.includes(key);
    if (first) cleared.push(key);
    const multiplier = first ? 1 : REPEAT_MULTIPLIER;
    total += Math.round(baseForAnte(ante) * multiplier) * inAnte;
  }

  return { total: Math.min(total, MAX_AWARD_PER_RUN), cleared };
}

// --- Persistencia (JSON plano) ----------------------------------------------

let store = { players: {}, seasons: {} };

async function load() {
  try {
    store = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    store.players ??= {};
    store.seasons ??= {};
  } catch {
    store = { players: {}, seasons: {} };
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(DATA_FILE), { recursive: true });
      await writeFile(DATA_FILE, JSON.stringify(store));
    } catch (error) {
      console.error('[leaderboard] no se pudo guardar:', error.message);
    }
  }, 300);
}

function playerOf(id) {
  store.players[id] ??= {
    playerId: id,
    displayName: id.slice(0, 8),
    lifetimeSpores: 0,
    seasonSpores: 0,
    level: 1,
    firstClears: [],
    runs: [],
    submissions: [],
    updatedAt: new Date(0).toISOString(),
  };
  return store.players[id];
}

/** Nivel derivado de las Esporas. Espejo de `levelForSpores`. */
const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 1850, 2350, 3000];
function levelForSpores(spores) {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (spores >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  while (spores >= LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + (level - 9) * 600) level += 1;
  return level;
}

// --- Validacion del resultado -----------------------------------------------

function validateResult(result) {
  if (typeof result !== 'object' || result === null) return 'resultado ausente';
  const { runId, completedAt, mode, highestBlind, completedBlinds, scoreSummary, clientVersion } = result;
  if (typeof runId !== 'string' || runId.length < 4 || runId.length > 128) return 'runId invalido';
  if (typeof completedAt !== 'string') return 'completedAt invalido';
  if (!['classic', 'daily', 'ascension'].includes(mode)) return 'mode invalido';
  if (typeof clientVersion !== 'string' || clientVersion.length === 0) return 'clientVersion ausente';

  const when = Date.parse(completedAt);
  if (!Number.isFinite(when)) return 'completedAt ilegible';
  const now = Date.now();
  if (when > now + FUTURE_TOLERANCE_MS) return 'completedAt en el futuro';
  if (when < now - MAX_RUN_AGE_MS) return 'completedAt demasiado viejo';

  if (!Number.isInteger(highestBlind) || highestBlind < 1 || highestBlind > MAX_ANTE) {
    return 'highestBlind fuera de rango';
  }
  if (!Number.isInteger(completedBlinds) || completedBlinds < 0 || completedBlinds > MAX_ANTE * BLINDS_PER_ANTE) {
    return 'completedBlinds fuera de rango';
  }
  // No se pueden haber superado mas Ciegos que los que entran en el ante alcanzado.
  if (completedBlinds > highestBlind * BLINDS_PER_ANTE) return 'Ciegos incoherentes con el ante';
  if (typeof scoreSummary !== 'number' || !Number.isFinite(scoreSummary) || scoreSummary < 0 || scoreSummary > MAX_SCORE) {
    return 'scoreSummary fuera de rango';
  }
  return null;
}

function rateLimited(player) {
  const now = Date.now();
  player.submissions = player.submissions.filter((ts) => now - ts < RATE_WINDOW_MS);
  if (player.submissions.length >= RATE_MAX) return true;
  player.submissions.push(now);
  return false;
}

// --- HTTP -------------------------------------------------------------------

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('cuerpo demasiado grande');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function board(scope, seasonId, playerId, limit) {
  const rows = Object.values(store.players)
    .map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      spores: scope === 'season' ? p.seasonSpores : p.lifetimeSpores,
      level: p.level,
      updatedAt: p.updatedAt,
    }))
    .filter((row) => row.spores > 0)
    .sort((a, b) => b.spores - a.spores || a.playerId.localeCompare(b.playerId));

  const selfIndex = playerId ? rows.findIndex((row) => row.playerId === playerId) : -1;
  return {
    scope,
    seasonId: scope === 'season' ? seasonId : '',
    entries: rows.slice(0, limit),
    selfRank: selfIndex >= 0 ? selfIndex + 1 : null,
    total: rows.length,
    fetchedAt: new Date().toISOString(),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, players: Object.keys(store.players).length });
    }

    if (req.method === 'POST' && url.pathname === '/runs') {
      const body = await readBody(req);
      const playerId = typeof body?.playerId === 'string' ? body.playerId : '';
      if (playerId.length < 3 || playerId.length > 128) return send(res, 400, { error: 'playerId invalido' });

      const problem = validateResult(body?.result);
      if (problem) return send(res, 422, { rejected: true, reason: problem, awarded: 0 });

      const player = playerOf(playerId);
      if (rateLimited(player)) return send(res, 429, { rejected: true, reason: 'demasiados envios', awarded: 0 });

      // IDEMPOTENCIA: reenviar el mismo runId (un reintento por red) no vuelve a
      // pagar. Sin esto, un cliente con la cola sin vaciar duplicaria Esporas.
      if (player.runs.includes(body.result.runId)) {
        return send(res, 200, {
          awarded: 0,
          lifetimeSpores: player.lifetimeSpores,
          seasonSpores: player.seasonSpores,
          level: player.level,
        });
      }

      const { total, cleared } = awardForRun(player, body.result);
      player.runs.push(body.result.runId);
      if (player.runs.length > 200) player.runs.splice(0, player.runs.length - 200);
      for (const key of cleared) if (!player.firstClears.includes(key)) player.firstClears.push(key);

      const seasonId = typeof body.seasonId === 'string' ? body.seasonId : '';
      player.lifetimeSpores += total;
      player.seasonSpores += total;
      player.level = levelForSpores(player.lifetimeSpores);
      player.updatedAt = new Date().toISOString();
      if (body.result.displayName) player.displayName = String(body.result.displayName).slice(0, 24);
      store.seasons[seasonId] ??= { seasonId, startedAt: new Date().toISOString() };
      save();

      return send(res, 200, {
        awarded: total,
        lifetimeSpores: player.lifetimeSpores,
        seasonSpores: player.seasonSpores,
        level: player.level,
      });
    }

    if (req.method === 'GET' && url.pathname === '/leaderboard') {
      const scope = url.searchParams.get('scope') === 'lifetime' ? 'lifetime' : 'season';
      const seasonId = url.searchParams.get('season') ?? '';
      const playerId = url.searchParams.get('playerId');
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 100) || 100));
      return send(res, 200, board(scope, seasonId, playerId, limit));
    }

    return send(res, 404, { error: 'no encontrado' });
  } catch (error) {
    return send(res, 400, { error: error instanceof Error ? error.message : 'pedido invalido' });
  }
});

await load();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[leaderboard] escuchando en http://0.0.0.0:${PORT}`);
  console.log(`[leaderboard] datos en ${DATA_FILE}`);
  console.log(`[leaderboard] origen permitido: ${ALLOWED_ORIGIN}`);
});
