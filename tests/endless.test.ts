/**
 * endless.test.ts — Modo infinito tras el ultimo ante (Fase 3).
 *
 * El feedback del playtest fue "llego a X puntos y ahi se acaba": sin objetivo
 * mas alla del ante 8 la partida moria justo cuando el mazo estaba en su mejor
 * momento. Desde esta fase, al pasar el ultimo ante el motor OFRECE terminar o
 * seguir, y seguir no tiene techo. Lo que hay que proteger:
 *
 *   - la OFERTA: pasar el ultimo ante NO termina la run de golpe, la deja en
 *     `victory_offer` (y el ante no avanza hasta decidir),
 *   - que la victoria se COMMITEE UNA sola vez, tanto si se termina como si se
 *     sigue (`stats.runs`/XP/colonia no se cobran dos veces),
 *   - que una run en infinito AVANCE de ante y ya no reoferta victoria,
 *   - que `endless` viaje serializado: retomar la run la sigue en infinito.
 *
 * Referencia: `GameEngine.leaveShop` / `acceptVictory` / `continueEndless`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

const BUNDLE = buildRegistry().toBundle();

/** Motor recien salido del blind select, con el ante forzado. */
function atAnte(ante: number, seed = 0x5eed): GameEngine {
  const engine = new GameEngine({ seed, bundle: BUNDLE });
  engine.startRun(seed, 0);
  engine.run.ante = ante;
  engine.run.status = 'blind_select';
  return engine;
}

/** Motor parado en el ULTIMO blind del ultimo ante, listo para salir de tienda. */
function atLastBlindOfLastAnte(): { engine: GameEngine; max: number } {
  const engine = atAnte(0);
  const max = engine.registry.maxAnte();
  engine.run.ante = max;
  engine.run.blindIndex = 2;
  return { engine, max };
}

test('pasar el ultimo ante OFRECE terminar o seguir, no termina la run', () => {
  const { engine, max } = atLastBlindOfLastAnte();
  engine.leaveShop();

  assert.equal(engine.run.status, 'victory_offer');
  // El ante NO avanza hasta decidir: la oferta es una pregunta, no un resultado.
  assert.equal(engine.run.ante, max);
  assert.equal(engine.run.blindIndex, 2);
  // Y sigue siendo la misma run: nada se cerro ni se borro.
  assert.equal(engine.run.endless, false);
});

test('con endless activo el mismo punto AVANZA de ante y no reoferta', () => {
  const { engine, max } = atLastBlindOfLastAnte();
  engine.continueEndless();
  // La decision pudo caer en un interludio: lo que importa es que la run sigue.
  assert.notEqual(engine.run.status, 'victory_offer');
  assert.equal(engine.run.endless, true);
  assert.equal(engine.run.ante, max + 1);

  // Y la proxima vez que se cruza el mismo borde no se vuelve a ofrecer.
  engine.run.status = 'shop';
  engine.run.blindIndex = 2;
  engine.leaveShop();
  assert.notEqual(engine.run.status, 'victory_offer');
  assert.equal(engine.run.ante, max + 2);
});

test('terminar la partida emite UNA victoria con el ante final', () => {
  const { engine, max } = atLastBlindOfLastAnte();
  engine.leaveShop();

  const seen: Array<{ reason: string; ante: number; continues?: boolean }> = [];
  const off = bus.on('game:over', (e) => {
    seen.push({ reason: e.reason, ante: e.ante, continues: e.continues });
  });
  try {
    engine.acceptVictory();
  } finally {
    off();
  }

  assert.equal(engine.run.status, 'victory');
  assert.equal(seen.length, 1, 'un solo game:over');
  const go = seen[0];
  assert.ok(go !== undefined);
  assert.equal(go.reason, 'victory');
  assert.equal(go.ante, max + 1);
  assert.equal(go.continues, undefined);
});

test('seguir en infinito commitea la victoria UNA vez y la run continua', () => {
  const { engine, max } = atLastBlindOfLastAnte();
  engine.leaveShop();

  const seen: Array<{ reason: string; ante: number; continues?: boolean }> = [];
  const off = bus.on('game:over', (e) => {
    seen.push({ reason: e.reason, ante: e.ante, continues: e.continues });
  });
  try {
    engine.continueEndless();
  } finally {
    off();
  }

  assert.equal(seen.length, 1, 'la victoria se commitea una sola vez');
  const go = seen[0];
  assert.ok(go !== undefined);
  assert.equal(go.reason, 'victory');
  assert.equal(go.continues, true);
  assert.equal(go.ante, max + 1);
  // `endless` es del RUN, no del evento: la derrota final lo lleva aparte.
  assert.equal(engine.run.endless, true);
  assert.equal(engine.run.ante, max + 1);
  assert.equal(engine.run.status !== 'victory', true, 'la run sigue viva');
});

test('los antes infinitos tienen objetivo y ruta (sin tabla declarada)', () => {
  const { engine, max } = atLastBlindOfLastAnte();
  const next = engine.registry.anteTarget(max + 1);
  const base = engine.registry.anteTarget(max);
  assert.ok(base !== undefined && next !== undefined);
  assert.equal(next, Math.round((base ?? 0) * 2.4), 'extrapola x2.4 por ante');

  // La RUTA del ante infinito sigue teniendo 3 ciegos jugables (el pool tiene
  // variantes por tier desde R2: sortear es justamente lo que acá se verifica).
  engine.run.ante = max + 1;
  engine.run.blindRoute = [];
  const blinds = engine.availableBlinds();
  assert.equal(blinds.length, 3);
  assert.deepEqual(
    blinds.map((b) => String(b.tier)).sort(),
    ['big', 'boss', 'small'],
  );
});

test('endless viaja serializado: una run retomada sigue en infinito', () => {
  const { engine } = atLastBlindOfLastAnte();
  engine.leaveShop();
  engine.continueEndless();
  assert.equal(engine.run.endless, true);

  const saved = engine.serialize();
  assert.equal(saved.endless, true);

  const fresh = new GameEngine({ seed: saved.seed, bundle: BUNDLE });
  fresh.startRun(saved.seed, 0);
  assert.equal(fresh.restore(saved), true);
  assert.equal(fresh.run.endless, true);

  // Un guardado viejo, sin el campo, restaura en `false` (aditivo).
  const legacy = { ...saved } as typeof saved & { endless?: boolean };
  delete legacy.endless;
  const older = new GameEngine({ seed: saved.seed, bundle: BUNDLE });
  older.startRun(saved.seed, 0);
  assert.equal(older.restore(legacy), true);
  assert.equal(older.run.endless, false);
});
