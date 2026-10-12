/**
 * quitPause.test.ts — Contrato de "salir al menu" = PAUSAR, no borrar.
 *
 * El bug del playtest: salia al menu (en parte sin confirmacion) y el guardado
 * se borraba, asi que el menu solo ofrecia "Nueva partida" mientras el perfil SI
 * conservaba el progreso. Lo que hay que proteger:
 *
 *   - salir al menu CONSERVA el guardado: `save(serialize())` -> `load()`
 *     devuelve la misma run (es lo que hace visible el chip "Continuar"),
 *   - abandonar (accion explicita y aparte) SI lo borra: `clear()` -> `load()`
 *     devuelve null,
 *   - la pausa captura el estado VIVO: lo que se guarda es el serialize del
 *     momento de salir, no el ultimo autoguardado (1.5 s de debounce),
 *   - la run restaurada retoma el estado exacto (dinero, mazo, ante).
 *
 * `localStorage` no existe en Node: se stubea con un Map para ejercitar el
 * backend real de `Storage` (en el navegador sin Tauri es el mismo camino).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

import { RunStore } from '../src/persistence/RunStore.ts';
import { Storage } from '../src/persistence/Storage.ts';

// ---------------------------------------------------------------------------
// Stub de localStorage (Node no lo tiene)
// ---------------------------------------------------------------------------

const installLocalStorage = (): (() => void) => {
  const map = new Map<string, string>();
  const stub = {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, String(value));
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
    clear: (): void => map.clear(),
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    get length(): number {
      return map.size;
    },
  };
  const g = globalThis as { localStorage?: unknown };
  const had = 'localStorage' in g;
  const prev = g.localStorage;
  g.localStorage = stub;
  return () => {
    if (had) g.localStorage = prev;
    else delete g.localStorage;
  };
};

function newStore(): RunStore {
  const storage = new Storage();
  // Sin puente Tauri en Node: `init()` cae a localStorage (el stub de arriba).
  void storage.init();
  return new RunStore(storage);
}

function startedEngine(seed = 7): GameEngine {
  const engine = new GameEngine({ seed, bundle: buildRegistry().toBundle() });
  engine.startRun(seed, 0);
  return engine;
}

// ---------------------------------------------------------------------------
// Pausar vs abandonar
// ---------------------------------------------------------------------------

test('salir al menu CONSERVA el guardado: load() devuelve la run pausada', async () => {
  const restore = installLocalStorage();
  try {
    const store = newStore();
    const engine = startedEngine();

    // El flujo real de `onQuitToMenu`: guarda YA (sin esperar el debounce).
    const saved = await store.save(engine.serialize());
    assert.equal(saved, true, 'el guardado deberia escribirse');

    const loaded = await store.load();
    assert.ok(loaded, 'deberia haber guardado: es lo que enciende "Continuar"');
    assert.equal(loaded.seed, 7);
    assert.equal(loaded.ante, engine.run.ante);
    assert.equal(loaded.deck.length, engine.run.deck.totalSize);
  } finally {
    restore();
  }
});

test('abandonar SI borra: tras clear(), load() devuelve null', async () => {
  const restore = installLocalStorage();
  try {
    const store = newStore();
    const engine = startedEngine();
    await store.save(engine.serialize());
    assert.ok(await store.load(), 'sanity: el guardado existe antes de abandonar');

    await store.clear();
    assert.equal(await store.load(), null, 'abandonar no debe dejar run continuable');
  } finally {
    restore();
  }
});

test('la pausa captura el estado VIVO, no el autoguardado', async () => {
  const restore = installLocalStorage();
  try {
    const store = newStore();
    const engine = startedEngine();

    const before = engine.run.money;
    // El run cambia DESPUES del ultimo autoguardado: la pausa tiene que
    // serializar el momento de salir o se pierden hasta 1.5 s de progreso.
    engine.run.money = before + 3;
    assert.notEqual(engine.run.money, before, 'sanity: el dinero cambio');

    await store.save(engine.serialize());
    const loaded = await store.load();
    assert.ok(loaded);
    assert.equal(loaded.money, engine.run.money, 'el guardado deberia tener el dinero actual');
  } finally {
    restore();
  }
});

test('la run pausada se retoma con el estado exacto', async () => {
  const restore = installLocalStorage();
  try {
    const store = newStore();
    const engine = startedEngine(21);
    engine.run.money = 9;
    const snapshot = engine.serialize();
    await store.save(snapshot);

    const loaded = await store.load();
    assert.ok(loaded);

    const resumed = startedEngine(21);
    assert.equal(resumed.restore(loaded), true, 'restore deberia aceptar el guardado pausado');
    assert.equal(resumed.run.money, 9, 'el dinero se retoma');
    assert.equal(resumed.run.deck.totalSize, engine.run.deck.totalSize, 'el mazo se retoma');
    assert.equal(resumed.run.ante, engine.run.ante, 'el ante se retoma');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Lo que NO cambia: una run terminada no se continua
// ---------------------------------------------------------------------------

test('una victoria/derrota sigue sin ser continuable (semantica de clear)', async () => {
  const restore = installLocalStorage();
  try {
    const store = newStore();
    const engine = startedEngine();
    await store.save(engine.serialize());

    // `state:changed` con game_over/victory llama a clear(): el contrato de
    // abandono es el mismo que borra la run terminada.
    await store.clear();
    assert.equal(await store.load(), null);
  } finally {
    restore();
  }
});
