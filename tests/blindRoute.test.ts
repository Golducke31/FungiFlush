/**
 * blindRoute.test.ts — Ruta de ciegos sorteada por ante (R2).
 *
 * El contenido declara VARIANTES por tier (2 small y 2 big por ante). Lo que
 * hay que proteger:
 *
 *   - el SORTEO: misma semilla ⇒ misma ruta (una run sigue siendo reproducible
 *     por semilla, que es la base del desafio diario y de las sims),
 *   - la VARIEDAD: semillas distintas dan rutas distintas (si no, el sorteo no
 *     estaria sorteando nada),
 *   - la ESTRUCTURA: la ruta siempre es small → big → jefe, y el jefe de la
 *     ruta es EL jefe del ante (nunca una variante: los jefes no se sortean),
 *   - la FUENTE UNICA: `chooseBlind()` sin id juega el ciego de la ruta, que es
 *     el MISMO que mostro la pantalla de seleccion,
 *   - el GUARDADO: la ruta viaja serializada (recargar no es un reroll gratis)
 *     y un guardado previo a R2 cae a una ruta determinista.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

const REAL = buildRegistry().toBundle();

/** Motor recien arrancado con la semilla pedida. */
function started(seed: number): GameEngine {
  const engine = new GameEngine({ seed, bundle: REAL });
  // R3 — `tutorial: true` apaga el borrador de bendicion: estos tests miden la
  // ruta de ciegos y necesitan la run en `blind_select`, no en 'draft'. El
  // flag no cambia ninguna regla, solo suprime el sorteo del borrador.
  engine.startRun(seed, 0, '', false, true);
  return engine;
}

/**
 * Ruta del ante pedido PARA la semilla, por el mismo camino que el juego: se
 * fuerza el ante y se deja que `availableBlinds` resuelva (sorteando si hace
 * falta). Devuelve los ids en orden de juego.
 */
function routeOf(seed: number, ante: number): string[] {
  const engine = started(seed);
  engine.run.ante = ante;
  engine.run.blindRoute = [];
  return engine.availableBlinds().map((b) => b.id);
}

// ---------------------------------------------------------------------------
// El sorteo
// ---------------------------------------------------------------------------

test('misma semilla ⇒ misma ruta en todos los antes', () => {
  for (const seed of [1, 7, 1234, 0xfeed]) {
    const a = started(seed);
    const b = started(seed);
    for (let ante = 1; ante <= 8; ante++) {
      a.run.ante = ante;
      b.run.ante = ante;
      a.run.blindRoute = [];
      b.run.blindRoute = [];
      assert.deepEqual(
        a.availableBlinds().map((x) => x.id),
        b.availableBlinds().map((x) => x.id),
        `semilla ${seed}, ante ${ante}: la ruta no es reproducible`,
      );
    }
  }
});

test('semillas distintas dan rutas distintas', () => {
  // Con 2 small y 2 big por ante hay 4 combinaciones posibles por ante: con 20
  // semillas tienen que aparecer varias, no siempre la misma.
  const seen = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    seen.add(routeOf(seed, 3).join('|'));
  }
  assert.ok(seen.size >= 3, `solo ${seen.size} rutas distintas en 20 semillas`);
});

test('la ruta es small → big → jefe y el jefe es el del ante', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (let ante = 1; ante <= 8; ante++) {
      const route = routeOf(seed, ante);
      assert.equal(route.length, 3, `semilla ${seed}, ante ${ante}: la ruta tiene 3 ciegos`);
      const engine = started(seed);
      engine.run.ante = ante;
      const defs = engine.availableBlinds();
      assert.deepEqual(
        defs.map((b) => b.tier),
        ['small', 'big', 'boss'],
        `semilla ${seed}, ante ${ante}: el orden de tiers se perdio`,
      );
      assert.equal(defs[2]?.id, `blind_a${ante}_boss`, 'el jefe de la ruta es el jefe del ante');
    }
  }
});

test('el sorteo de la ruta NO consume el RNG de la run', () => {
  // La ruta sale de un RNG propio derivado de (semilla, ante): sortearla no
  // puede desplazar los demas sorteos (misiones, tienda) ni depender de ellos.
  const a = started(42);
  const before = a.rng.getSeed();
  a.run.ante = 4;
  a.run.blindRoute = [];
  a.availableBlinds();
  assert.equal(a.rng.getSeed(), before, 'el RNG de la run quedo intacto');
});

// ---------------------------------------------------------------------------
// Fuente unica: lo que se muestra es lo que se juega
// ---------------------------------------------------------------------------

test('chooseBlind sin id juega el ciego de la ruta', () => {
  const engine = started(99);
  const route = engine.availableBlinds();
  assert.equal(engine.run.blindRoute.length, 3, 'la ronda arranca con ruta sorteada');

  engine.chooseBlind();
  assert.equal(engine.round?.blind.id, route[0]?.id, 'el primer ciego es el small de la ruta');
  assert.equal(engine.round?.blind.tier, 'small');
});

test('un chooseBlind con id forzado gana sobre el sorteo (compat tests)', () => {
  // Los tests que fijan un ciego concreto tienen que poder hacerlo aunque la
  // variante sorteada sea la otra: el id se busca en el pool completo.
  const engine = started(5);
  engine.run.ante = 2;
  engine.run.blindRoute = ['blind_a2_small', 'blind_a2_big', 'blind_a2_boss'];
  engine.chooseBlind('blind_a2_small_v');
  assert.equal(engine.round?.blind.id, 'blind_a2_small_v');
});

test('la variante sorteada es la que aplica sus efectos', () => {
  // Ruta forzada a las variantes del ante 4: el descarte de menos del small y
  // la mano de menos del big tienen que disparar en SU ronda.
  const engine = started(11);
  engine.run.ante = 4;
  engine.run.blindRoute = ['blind_a4_small_v', 'blind_a4_big_v', 'blind_a4_boss'];
  engine.chooseBlind();
  assert.equal(engine.round?.blind.id, 'blind_a4_small_v');
  assert.equal(
    engine.roundSnapshot().discardsLeft,
    engine.run.baseDiscards - 1,
    'el handicap de la variante se aplica',
  );

  engine.run.status = 'blind_select';
  engine.run.blindIndex = 1;
  engine.chooseBlind();
  assert.equal(engine.round?.blind.id, 'blind_a4_big_v');
  assert.equal(
    engine.roundSnapshot().handsLeft,
    engine.run.baseHands - 1,
    'y el de la otra variante en la suya',
  );
});

test('el impuesto de la variante sorteada aparece al puntuar', () => {
  const engine = started(3);
  engine.run.ante = 2;
  engine.run.blindRoute = ['blind_a2_small_v', 'blind_a2_big', 'blind_a2_boss'];
  engine.chooseBlind();
  const hand = engine.roundSnapshot().hand;
  for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);
  const res = engine.playHand();
  assert.ok(res, 'la mano se jugo');
  const tax = (res.steps ?? []).filter((s) => s.action === 'MULTIPLY_SPORES' && s.value === 0.95);
  assert.ok(tax.length >= 1, 'el impuesto de la variante aparece en el registro');
});

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------

test('la ruta viaja serializada: recargar no es un reroll gratis', () => {
  const engine = started(77);
  engine.run.ante = 5;
  const saved = engine.serialize();
  assert.deepEqual(saved.blindRoute, engine.run.blindRoute);

  // Se fuerza una ruta DISTINTA a la que saldria del sorteo: si el guardado se
  // respeta, la run retomada la conserva.
  const forced = ['blind_a5_big', 'blind_a5_small', 'blind_a5_boss'];
  assert.notDeepEqual(forced, engine.run.blindRoute, 'sanity: la forzada es otra');
  saved.blindRoute = forced;

  const resumed = new GameEngine({ seed: 77, bundle: REAL });
  assert.equal(resumed.restore(saved), true);
  assert.deepEqual(
    resumed.availableBlinds().map((b) => b.id),
    forced,
    'la ruta guardada manda sobre el sorteo',
  );
});

test('un guardado previo a R2 (sin ruta) carga con una ruta determinista', () => {
  const engine = started(77);
  engine.run.ante = 5;
  const saved = engine.serialize();
  delete saved.blindRoute;

  const resumed = new GameEngine({ seed: 77, bundle: REAL });
  assert.equal(resumed.restore(saved), true);
  assert.deepEqual(
    resumed.availableBlinds().map((b) => b.id),
    routeOf(77, 5),
    'la ruta re-sorteada es la misma que saldria hoy para esa semilla',
  );
  assert.equal(resumed.run.blindRoute.length, 3);
});
