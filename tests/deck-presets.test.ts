/**
 * deck-presets.test.ts — Mazos personalizados (capa META, puro).
 *
 * La regla que estos tests protegen: un mazo custom puede tener hasta
 * MAX_COPIES_PER_CARD copias de una carta y tiene que caer dentro de
 * [DECK_MIN, DECK_MAX]. Sin esas dos puertas, 40 copias de la carta mas fuerte
 * trivializan el juego entero — y el balance de 8 antes se rompe para siempre.
 *
 * Todo es puro: el catalogo entra por parametro, asi que los tests no necesitan
 * cargar contenido ni el motor.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DECK_MAX,
  DECK_MIN,
  DEFAULT_DECK_ID,
  MAX_COPIES_PER_CARD,
  MAX_DECK_PRESETS,
  addCopy,
  biasFromDeck,
  collapseDeckEntries,
  defaultDeckState,
  emptyDeckPreset,
  removeCopy,
  sanitizeDeck,
  selectedPreset,
  validateDeck,
} from '../src/meta/DeckPresets.ts';

const KNOWN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const OWNED = ['a', 'b', 'c', 'd'];

/** Helper: un mazo valido de `DECK_MIN` cartas, 4 copias de cada una. */
function legalDeck(): Array<{ cardId: string; copies: number }> {
  // 5 cartas x 4 copias = 20 = DECK_MIN, justo en el tope por carta.
  return ['a', 'b', 'c', 'd', 'e'].map((cardId) => ({ cardId, copies: MAX_COPIES_PER_CARD }));
}

test('las constantes de tamano y copias tienen los valores calibrados', () => {
  assert.equal(DECK_MIN, 20);
  assert.equal(DECK_MAX, 40);
  assert.equal(MAX_COPIES_PER_CARD, 4);
  assert.equal(MAX_DECK_PRESETS, 3);
  assert.equal(DEFAULT_DECK_ID, 'custom');
});

test('validateDeck acepta un mazo legal', () => {
  const result = validateDeck(legalDeck(), ['a', 'b', 'c', 'd', 'e'], KNOWN);
  assert.equal(result.ok, true);
  assert.equal(result.size, DECK_MIN);
  assert.deepEqual(result.errors, []);
});

test('validateDeck: tamano corto y largo reportan "size"', () => {
  const short = validateDeck([{ cardId: 'a', copies: 3 }], OWNED, KNOWN);
  assert.equal(short.ok, false);
  assert.equal(short.size, 3);
  assert.deepEqual(
    short.errors.filter((e) => e.code === 'size').map((e) => e.value),
    [3],
  );

  // 13 cartas x 4 copias = 52 > DECK_MAX.
  const long = validateDeck(
    Array.from({ length: 13 }, (_, i) => ({ cardId: `c${i}`, copies: 4 })),
    Array.from({ length: 13 }, (_, i) => `c${i}`),
    Array.from({ length: 13 }, (_, i) => `c${i}`),
  );
  assert.equal(long.ok, false);
  assert.deepEqual(
    long.errors.filter((e) => e.code === 'size').map((e) => e.value),
    [52],
  );
});

test('validateDeck: una carta fuera del registro da "unknown_card"', () => {
  const result = validateDeck(
    [{ cardId: 'a', copies: DECK_MAX }, { cardId: 'zzz', copies: 1 }],
    [...OWNED, 'zzz'],
    KNOWN,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((e) => e.code === 'unknown_card').map((e) => e.cardId),
    ['zzz'],
  );
});

test('validateDeck: una carta conocida pero NO poseida da "not_owned"', () => {
  // "e" existe en KNOWN pero no en OWNED.
  const result = validateDeck(
    [{ cardId: 'a', copies: 20 }, { cardId: 'e', copies: 4 }],
    OWNED,
    KNOWN,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((e) => e.code === 'not_owned').map((e) => e.cardId),
    ['e'],
  );
});

test('validateDeck: pasar el tope por carta da "too_many_copies"', () => {
  const result = validateDeck([{ cardId: 'a', copies: MAX_COPIES_PER_CARD + 1 }], OWNED, KNOWN);
  assert.deepEqual(
    result.errors.filter((e) => e.code === 'too_many_copies').map((e) => e.value),
    [MAX_COPIES_PER_CARD + 1],
  );
});

test('validateDeck: una entrada repetida da "duplicate_entry"', () => {
  const result = validateDeck(
    [
      { cardId: 'a', copies: 10 },
      { cardId: 'a', copies: 10 },
    ],
    OWNED,
    KNOWN,
  );
  assert.deepEqual(
    result.errors.filter((e) => e.code === 'duplicate_entry').map((e) => e.cardId),
    ['a'],
  );
  // El tamano suma las dos entradas: duplicar NO es una forma de esquivar el
  // tope, porque el validador las cuenta por separado.
  assert.equal(result.size, 20);
});

test('validateDeck acumula TODOS los errores, no solo el primero', () => {
  const result = validateDeck(
    [
      { cardId: 'zzz', copies: 1 },
      { cardId: 'e', copies: 9 },
    ],
    OWNED,
    KNOWN,
  );
  const codes = new Set(result.errors.map((e) => e.code));
  assert.ok(codes.has('unknown_card'));
  assert.ok(codes.has('not_owned'));
  assert.ok(codes.has('too_many_copies'));
  assert.ok(codes.has('size'));
});

test('validateDeck ignora entradas con copias <= 0 o no finitas', () => {
  const result = validateDeck(
    [
      { cardId: 'a', copies: 20 },
      { cardId: 'b', copies: 0 },
      { cardId: 'c', copies: -3 },
      { cardId: 'd', copies: Number.NaN },
    ],
    OWNED,
    KNOWN,
  );
  assert.equal(result.size, 20);
  // Las basura no cuentan, pero "a" con 20 copias SI pasa el tope por carta.
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((e) => e.code === 'too_many_copies').map((e) => e.cardId),
    ['a'],
  );
  // No hay error de tamano: 20 esta dentro del rango.
  assert.equal(result.errors.some((e) => e.code === 'size'), false);
});

test('collapseDeckEntries suma duplicados y descarta lo no positivo', () => {
  const collapsed = collapseDeckEntries([
    { cardId: 'a', copies: 2 },
    { cardId: 'b', copies: 0 },
    { cardId: 'a', copies: 3 },
    { cardId: 'c', copies: -1 },
  ]);
  assert.deepEqual(collapsed, [{ cardId: 'a', copies: 5 }]);
});

test('sanitizeDeck quita ids desconocidos y recorta al tope por carta', () => {
  const clean = sanitizeDeck(
    [
      { cardId: 'a', copies: 99 },
      { cardId: 'zzz', copies: 4 },
      { cardId: 'b', copies: 2 },
    ],
    KNOWN,
  );
  assert.deepEqual(clean, [
    { cardId: 'a', copies: MAX_COPIES_PER_CARD },
    { cardId: 'b', copies: 2 },
  ]);
});

test('sanitizeDeck nunca pasa de DECK_MAX', () => {
  const clean = sanitizeDeck(
    Array.from({ length: 30 }, (_, i) => ({ cardId: `c${i}`, copies: 4 })),
    Array.from({ length: 30 }, (_, i) => `c${i}`),
  );
  const size = clean.reduce((sum, e) => sum + e.copies, 0);
  assert.equal(size, DECK_MAX);
});

test('sanitizeDeck no inventa cartas: si el catalogo no tiene nada, devuelve vacio', () => {
  assert.deepEqual(sanitizeDeck([{ cardId: 'a', copies: 2 }], []), []);
});

test('addCopy suma una copia y respeta el tope por carta', () => {
  let entries: Array<{ cardId: string; copies: number }> = [];
  for (let i = 0; i < MAX_COPIES_PER_CARD; i++) entries = addCopy(entries, 'a');
  assert.deepEqual(entries, [{ cardId: 'a', copies: MAX_COPIES_PER_CARD }]);
  // La quinta no entra: el tope por carta gana.
  entries = addCopy(entries, 'a');
  assert.deepEqual(entries, [{ cardId: 'a', copies: MAX_COPIES_PER_CARD }]);
});

test('addCopy respeta el tope de tamano global', () => {
  let entries: Array<{ cardId: string; copies: number }> = [];
  // 10 cartas x 4 copias = 40 = DECK_MAX.
  for (let c = 0; c < 10; c++) {
    for (let i = 0; i < MAX_COPIES_PER_CARD; i++) entries = addCopy(entries, `card${c}`);
  }
  const size = entries.reduce((sum, e) => sum + e.copies, 0);
  assert.equal(size, DECK_MAX);
  // Una carta nueva ya no entra: lleno.
  entries = addCopy(entries, 'otra');
  assert.equal(entries.some((e) => e.cardId === 'otra'), false);
  assert.equal(entries.reduce((sum, e) => sum + e.copies, 0), DECK_MAX);
});

test('addCopy no muta el mazo original', () => {
  const original = [{ cardId: 'a', copies: 1 }];
  const next = addCopy(original, 'a');
  assert.deepEqual(original, [{ cardId: 'a', copies: 1 }]);
  assert.deepEqual(next, [{ cardId: 'a', copies: 2 }]);
});

test('removeCopy baja una copia y ELIMINA la entrada al llegar a cero', () => {
  let entries = [
    { cardId: 'a', copies: 2 },
    { cardId: 'b', copies: 1 },
  ];
  entries = removeCopy(entries, 'a');
  assert.deepEqual(entries, [
    { cardId: 'a', copies: 1 },
    { cardId: 'b', copies: 1 },
  ]);
  entries = removeCopy(entries, 'a');
  // Sin entrada muerta de "a" con 0 copias.
  assert.deepEqual(entries, [{ cardId: 'b', copies: 1 }]);
  // Quitar algo que no esta no rompe.
  assert.deepEqual(removeCopy(entries, 'zzz'), [{ cardId: 'b', copies: 1 }]);
});

test('removeCopy no muta el mazo original', () => {
  const original = [{ cardId: 'a', copies: 2 }];
  const next = removeCopy(original, 'a');
  assert.deepEqual(original, [{ cardId: 'a', copies: 2 }]);
  assert.deepEqual(next, [{ cardId: 'a', copies: 1 }]);
});

test('biasFromDeck devuelve los elementos dominantes en orden de frecuencia', () => {
  const elementOf = (id: string): 'poison' | 'spore' | 'neutral' | undefined =>
    id === 'a' ? 'poison' : id === 'b' ? 'spore' : id === 'c' ? 'spore' : 'neutral';
  const bias = biasFromDeck(
    [
      { cardId: 'a', copies: 4 },
      { cardId: 'b', copies: 4 },
      { cardId: 'c', copies: 4 },
      { cardId: 'd', copies: 1 },
    ],
    elementOf,
  );
  // spore aparece en 2 cartas, neutral en 1, poison en 1 => spore primero.
  assert.deepEqual(bias, ['spore', 'neutral']);
});

test('biasFromDeck cuenta CARTAS, no copias', () => {
  // "a" tiene 4 copias pero es UNA carta: no debe pesar mas que 4 cartas
  // distintas del otro elemento.
  const elementOf = (id: string): 'poison' | 'spore' | undefined =>
    id === 'a' ? 'poison' : 'spore';
  const bias = biasFromDeck(
    [
      { cardId: 'a', copies: 4 },
      { cardId: 'b', copies: 1 },
      { cardId: 'c', copies: 1 },
    ],
    elementOf,
  );
  assert.deepEqual(bias, ['spore', 'poison']);
});

test('biasFromDeck de un mazo vacio es [] (no sesga)', () => {
  assert.deepEqual(biasFromDeck([], () => 'spore'), []);
});

test('selectedPreset resuelve por id y devuelve undefined con selectedId vacio', () => {
  const state = {
    selectedId: 'custom',
    presets: [{ id: 'custom', name: 'Mi mazo', entries: [{ cardId: 'a', copies: 4 }] }],
  };
  assert.equal(selectedPreset(state)?.name, 'Mi mazo');
  assert.equal(selectedPreset({ ...state, selectedId: '' }), undefined);
  assert.equal(selectedPreset({ ...state, selectedId: 'nope' }), undefined);
});

test('defaultDeckState arranca con un preset vacio y ninguno elegido', () => {
  const state = defaultDeckState();
  assert.equal(state.selectedId, '');
  assert.equal(state.presets.length, 1);
  assert.equal(state.presets[0]?.id, DEFAULT_DECK_ID);
  assert.deepEqual(state.presets[0]?.entries, []);
});

test('emptyDeckPreset usa el id por defecto y nombre vacio', () => {
  const preset = emptyDeckPreset();
  assert.equal(preset.id, DEFAULT_DECK_ID);
  assert.equal(preset.name, '');
  assert.deepEqual(preset.entries, []);
});

test('un mazo sanitizado y completado a mano pasa la validacion', () => {
  // Flujo real de la UI: agregar 4 copias de 5 cartas distintas.
  let entries: Array<{ cardId: string; copies: number }> = [];
  for (const cardId of ['a', 'b', 'c', 'd', 'e']) {
    for (let i = 0; i < MAX_COPIES_PER_CARD; i++) entries = addCopy(entries, cardId);
  }
  const result = validateDeck(entries, ['a', 'b', 'c', 'd', 'e'], KNOWN);
  assert.equal(result.ok, true);
  assert.equal(result.size, 20);
});
