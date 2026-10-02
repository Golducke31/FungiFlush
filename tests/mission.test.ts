/**
 * mission.test.ts — Misiones de run (P2.6).
 *
 * Una mision es un objetivo CORTO dentro de la run que paga dinero al
 * cumplirse. Lo que hay que proteger:
 *
 *   - que el sorteo sea determinista (misma semilla = mismas misiones),
 *   - que una mision no se complete dos veces (pagaria dinero infinito),
 *   - que el progreso incremental avance y se clampee,
 *   - que el dinero se pague UNA sola vez,
 *   - que sobreviva al guardado,
 *   - que una mision borrada del contenido no rompa la carga.
 *
 * Contenido de referencia: `src/data/missions.json` (10 misiones).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { RNG } from '../src/engine/rng.ts';
import {
  advanceMissions,
  parseMissions,
  pickMissions,
  type MissionDef,
  type MissionState,
} from '../src/engine/missions/missions.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

function readData(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'),
  );
}

const MISSION_DATA = parseMissions(readData('missions.json'));

function engineWithMissions(seed = 1): GameEngine {
  const engine = new GameEngine({
    seed,
    bundle: buildRegistry().toBundle(),
    missions: MISSION_DATA,
  });
  engine.startRun(seed);
  return engine;
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

test('el contenido declara misiones y todas son validas', () => {
  assert.ok(MISSION_DATA.length > 0, 'deberia haber misiones en el pack base');
  const ids = MISSION_DATA.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'no puede haber ids repetidos');
  for (const def of MISSION_DATA) {
    assert.ok(def.reward > 0, `${def.id} deberia pagar algo`);
    assert.ok(def.event.length > 0, `${def.id} deberia escuchar un evento`);
  }
});

test('parseMissions descarta entradas mal formadas', () => {
  const parsed = parseMissions([
    { id: 'ok', nameKey: 'a.b', descKey: 'a.c', event: 'round:win', when: { op: 'always' }, reward: 3 },
    { id: 'sin-evento', nameKey: 'a.b', descKey: 'a.c', when: { op: 'always' }, reward: 3 },
    { id: 'evento-invalido', nameKey: 'a.b', descKey: 'a.c', event: 'no:existe', when: { op: 'always' }, reward: 3 },
    { id: 'sin-reward', nameKey: 'a.b', descKey: 'a.c', event: 'round:win', when: { op: 'always' } },
    { id: 'sin-condicion', nameKey: 'a.b', descKey: 'a.c', event: 'round:win', reward: 3 },
    null,
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, 'ok');
});

// ---------------------------------------------------------------------------
// Sorteo determinista
// ---------------------------------------------------------------------------

test('pickMissions es determinista para la misma semilla', () => {
  const a = pickMissions(MISSION_DATA, 2, [], 2, new RNG(42).next.bind(new RNG(42)));
  const b = pickMissions(MISSION_DATA, 2, [], 2, new RNG(42).next.bind(new RNG(42)));
  assert.deepEqual(a.map((m) => m.id), b.map((m) => m.id));
});

test('pickMissions no repite las excluidas', () => {
  const exclude = MISSION_DATA.slice(0, 3).map((m) => m.id);
  const picked = pickMissions(MISSION_DATA, 1, exclude, 2, new RNG(7).next.bind(new RNG(7)));
  for (const def of picked) {
    assert.ok(!exclude.includes(def.id), `${def.id} estaba excluida`);
  }
});

test('pickMissions respeta minAnte', () => {
  // En el ante 1 solo pueden salir misiones sin minAnte o con minAnte 1.
  const picked = pickMissions(MISSION_DATA, 1, [], 10, new RNG(3).next.bind(new RNG(3)));
  for (const def of picked) {
    assert.ok((def.minAnte ?? 1) <= 1, `${def.id} no deberia salir en el ante 1`);
  }
});

// ---------------------------------------------------------------------------
// Avance de misiones
// ---------------------------------------------------------------------------

const SIMPLE: MissionDef = {
  id: 'm_simple',
  nameKey: 'x.y',
  descKey: 'x.z',
  event: 'round:win',
  when: { op: 'gte', path: 'payload.reward', value: 5 },
  reward: 4,
};

const INCR: MissionDef = {
  id: 'm_incr',
  nameKey: 'x.y',
  descKey: 'x.z',
  event: 'card:discarded',
  incremental: { max: 3, inc: 1 },
  reward: 6,
};

test('una mision de condicion se completa al cumplirse el predicado', () => {
  const states: MissionState[] = [{ id: 'm_simple', progress: 0, completed: false }];
  const { next, completed } = advanceMissions(states, [SIMPLE], 'round:win', {
    payload: { reward: 9 },
    ctx: {},
  });
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.id, 'm_simple');
  assert.equal(next[0]?.completed, true);
});

test('una mision de condicion NO se completa si el predicado falla', () => {
  const states: MissionState[] = [{ id: 'm_simple', progress: 0, completed: false }];
  const { completed } = advanceMissions(states, [SIMPLE], 'round:win', {
    payload: { reward: 2 },
    ctx: {},
  });
  assert.equal(completed.length, 0);
});

test('una mision incremental acumula y se clampea en max', () => {
  let states: MissionState[] = [{ id: 'm_incr', progress: 0, completed: false }];
  const completedIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const res = advanceMissions(states, [INCR], 'card:discarded', { payload: {}, ctx: {} });
    states = res.next;
    completedIds.push(...res.completed.map((d) => d.id));
  }
  // Se completa UNA vez, aunque lleguen mas eventos que el max.
  assert.equal(completedIds.filter((id) => id === 'm_incr').length, 1);
  assert.equal(states[0]?.progress, 3, 'el progreso no puede pasar el max');
});

test('una mision completada no vuelve a completarse', () => {
  const states: MissionState[] = [{ id: 'm_simple', progress: 1, completed: true }];
  const { completed } = advanceMissions(states, [SIMPLE], 'round:win', {
    payload: { reward: 99 },
    ctx: {},
  });
  assert.equal(completed.length, 0);
});

test('advanceMissions no muta la lista de entrada', () => {
  const states: MissionState[] = [{ id: 'm_incr', progress: 0, completed: false }];
  const { next } = advanceMissions(states, [INCR], 'card:discarded', { payload: {}, ctx: {} });
  assert.equal(states[0]?.progress, 0, 'la entrada no deberia cambiar');
  assert.equal(next[0]?.progress, 1);
});

// ---------------------------------------------------------------------------
// Motor: dinero y ciclo de vida
// ---------------------------------------------------------------------------

test('el motor sortea misiones al entrar a la seleccion de ciego', () => {
  const engine = engineWithMissions(5);
  // `startRun` entra a `blind_select`, que ya reparte misiones.
  assert.ok(engine.run.missions.length > 0, 'deberia haber misiones activas');
  assert.ok(engine.run.missions.length <= 2, 'no puede haber mas de 2 activas');
});

test('completar una mision paga el dinero UNA vez', () => {
  const engine = engineWithMissions(5);
  // Fuerza una mision conocida y completa su condicion.
  engine.run.missions = [{ id: 'mission_hand_500', progress: 0, completed: false }];
  const before = engine.run.money;

  const first = engine.advanceMissionsOn('score:hand', { total: 600 });
  assert.equal(first.length, 1);
  assert.equal(engine.run.money, before + 5);

  // Repetir el evento no vuelve a pagar.
  const second = engine.advanceMissionsOn('score:hand', { total: 600 });
  assert.equal(second.length, 0);
  assert.equal(engine.run.money, before + 5, 'el dinero no puede duplicarse');
});

test('una mision que no cumple el predicado no paga', () => {
  const engine = engineWithMissions(5);
  engine.run.missions = [{ id: 'mission_hand_500', progress: 0, completed: false }];
  const before = engine.run.money;
  engine.advanceMissionsOn('score:hand', { total: 100 });
  assert.equal(engine.run.money, before);
});

test('no se repone una mision nueva si ya hay 2 activas', () => {
  const engine = engineWithMissions(5);
  // Fuerza dos activas y vuelve a entrar a la seleccion.
  engine.run.missions = [
    { id: 'mission_hand_500', progress: 0, completed: false },
    { id: 'mission_jokers_3', progress: 0, completed: false },
  ];
  const before = engine.run.missions.length;
  // `enterBlindSelect` es privado: se reentra via `leaveShop` en estado de
  // tienda, que es la via publica que lo llama.
  engine.enterShop();
  engine.leaveShop();
  assert.ok(
    engine.run.missions.filter((m) => !m.completed).length <= 2,
    'no puede superar el tope de 2 activas',
  );
  assert.ok(before <= 2);
});

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

test('las misiones sobreviven al guardado', () => {
  const engine = engineWithMissions(9);
  engine.run.missions = [
    { id: 'mission_discard_3', progress: 2, completed: false },
    { id: 'mission_hand_500', progress: 1, completed: true },
  ];

  const save = engine.serialize();
  const reloaded = new GameEngine({
    seed: 9,
    bundle: buildRegistry().toBundle(),
    missions: MISSION_DATA,
  });
  assert.equal(reloaded.restore(save), true);
  assert.deepEqual(
    reloaded.run.missions.map((m) => ({ ...m })),
    [
      { id: 'mission_discard_3', progress: 2, completed: false },
      { id: 'mission_hand_500', progress: 1, completed: true },
    ],
  );
});

test('un guardado sin misiones carga con lista vacia (migracion)', () => {
  const engine = engineWithMissions(9);
  const save = engine.serialize();
  delete (save as { missions?: unknown }).missions;

  const reloaded = new GameEngine({
    seed: 9,
    bundle: buildRegistry().toBundle(),
    missions: MISSION_DATA,
  });
  assert.equal(reloaded.restore(save), true);
  assert.deepEqual(reloaded.run.missions, []);
});

test('una mision que ya no existe en el contenido se descarta al cargar', () => {
  const engine = engineWithMissions(9);
  engine.run.missions = [
    { id: 'mission_borrada', progress: 1, completed: false },
    { id: 'mission_hand_500', progress: 0, completed: false },
  ];
  const save = engine.serialize();

  const reloaded = new GameEngine({
    seed: 9,
    bundle: buildRegistry().toBundle(),
    missions: MISSION_DATA,
  });
  reloaded.restore(save);
  assert.deepEqual(reloaded.run.missions.map((m) => m.id), ['mission_hand_500']);
});

test('sin definiciones de mision, el motor no rompe', () => {
  const engine = new GameEngine({ seed: 1, bundle: buildRegistry().toBundle() });
  engine.startRun(1);
  assert.deepEqual(engine.run.missions, []);
  assert.deepEqual(engine.advanceMissionsOn('round:win', { reward: 10 }), []);
});
