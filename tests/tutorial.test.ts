/**
 * tutorial.test.ts — El GUION del tutorial avanza y termina.
 *
 * Que protege:
 *   1. El guion es LINEAL: desde el principio, avanzando paso a paso con el
 *      estado correcto, se recorren TODOS los pasos sin repetir ninguno.
 *   2. Cada paso declara una `phase` real de `GameStatus` (sin typos).
 *   3. Un paso OPCIONAL cuyo `require` falla se SALTEA: el guion no se traba.
 *   4. Al final, `stepAfter` devuelve `null` (el tutorial cierra).
 *   5. `isFinalStep` reconoce el cierre y los 12 pasos existen con claves i18n
 *      unicas.
 *
 * Se corre en Node sin mocks: `Tutorial.ts` es puro.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  TUTORIAL_SEED,
  TUTORIAL_STEPS,
  allStepIds,
  isFinalStep,
  stepAfter,
  type TutorialContext,
  type TutorialStepId,
} from '../src/meta/Tutorial.js';

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../src/i18n/${name}`, import.meta.url), 'utf8'));
}

const es = readJson('es.json');
const en = readJson('en.json');

/** Contexto base con todo lo que un paso podria necesitar. */
function ctx(over: Partial<TutorialContext> = {}): TutorialContext {
  return {
    status: 'blind_select',
    blindIndex: 0,
    ante: 1,
    selectedCount: 0,
    handsPlayed: 0,
    lastComboKind: null,
    visitedShop: false,
    sawPurge: false,
    ...over,
  };
}

/** Estado del juego en el que vive cada paso del guion (para el recorrido). */
const PHASE_OF: Record<TutorialStepId, TutorialContext['status']> = {
  blind_select: 'blind_select',
  hand_dealt: 'playing',
  select_cards: 'playing',
  combo_hint: 'playing',
  play_hand: 'playing',
  score_breakdown: 'reward',
  reward_draft: 'reward',
  shop_intro: 'shop',
  purge_intro: 'shop',
  upgrade_intro: 'shop',
  boss_intro: 'blind_select',
  ante_complete: 'reward',
};

test('el guion tiene 12 pasos con ids unicos', () => {
  assert.equal(TUTORIAL_STEPS.length, 12);
  assert.equal(new Set(allStepIds()).size, 12);
});

test('todos los pasos declaran una fase de juego real', () => {
  const valid = new Set([
    'menu',
    'blind_select',
    'playing',
    'scoring',
    'reward',
    'interlude',
    'shop',
    'game_over',
    'victory',
  ]);
  for (const step of TUTORIAL_STEPS) {
    assert.ok(valid.has(step.phase), `${step.id} declara una fase valida`);
  }
});

test('cada paso tiene claves i18n en ES y EN', () => {
  const lookup = (dict: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
      return undefined;
    }, dict);
  for (const step of TUTORIAL_STEPS) {
    assert.equal(typeof lookup(es, step.titleKey), 'string', `ES ${step.titleKey}`);
    assert.equal(typeof lookup(en, step.titleKey), 'string', `EN ${step.titleKey}`);
    assert.equal(typeof lookup(es, step.bodyKey), 'string', `ES ${step.bodyKey}`);
    assert.equal(typeof lookup(en, step.bodyKey), 'string', `EN ${step.bodyKey}`);
  }
});

test('el guion se recorre entero, paso a paso, sin repetir', () => {
  const visited: TutorialStepId[] = [];
  let current: TutorialStepId | null = null;
  // Se recorre varias veces: cada estado "avanza" el contexto para que los
  // pasos con `require` (select_cards, combo_hint, play_hand, shop) apliquen.
  for (let guard = 0; guard < 40 && visited.length < 12; guard += 1) {
    // El contexto simula un jugador que hace todo lo que el paso pide.
    const guess = TUTORIAL_STEPS[visited.length] ?? null;
    const phase = guess ? PHASE_OF[guess.id] : 'blind_select';
    const step = stepAfter(
      current,
      ctx({
        status: phase,
        // El Jefe (blindIndex 2) es para el paso boss_intro; el resto, ciego 1.
        blindIndex: guess?.id === 'boss_intro' ? 2 : 0,
        selectedCount: guess?.id === 'select_cards' ? 0 : 3,
        handsPlayed: guess?.id === 'play_hand' ? 0 : 1,
        lastComboKind: guess?.id === 'combo_hint' ? 'family' : null,
        visitedShop: false,
        sawPurge: false,
      }),
    );
    if (!step) break;
    visited.push(step.id);
    current = step.id;
  }
  assert.deepEqual(visited, allStepIds(), 'se recorren los 12 pasos en orden');
});

test('un paso opcional cuyo require falla se SALTEA (no traba el guion)', () => {
  // Venimos de `select_cards`; la mano cerrada NO produjo combo, asi que
  // `combo_hint` no aplica y `play_hand` toma el relevo... pero `play_hand`
  // solo aplica si handsPlayed === 0.
  const step = stepAfter(
    'select_cards',
    ctx({ status: 'playing', lastComboKind: null, handsPlayed: 0 }),
  );
  assert.equal(step?.id, 'play_hand', 'sin combo, el siguiente paso es play_hand');
});

test('si el jugador ya jugo una mano, play_hand se saltea', () => {
  const step = stepAfter(
    'combo_hint',
    ctx({ status: 'playing', handsPlayed: 2, lastComboKind: null }),
  );
  // No quedan pasos de `playing` despues de play_hand: el guion espera a `reward`.
  assert.equal(step, null, 'sin pasos de playing pendientes');
});

test('el guion NO retrocede: pedir el siguiente de un paso tardio no vuelve atras', () => {
  const step = stepAfter('shop_intro', ctx({ status: 'blind_select', blindIndex: 2 }));
  assert.equal(step?.id, 'boss_intro', 'desde shop_intro solo mira hacia adelante');
});

test('boss_intro solo aparece en el ciego de Jefe', () => {
  const notBoss = stepAfter('upgrade_intro', ctx({ status: 'blind_select', blindIndex: 1 }));
  assert.equal(notBoss, null, 'con blindIndex 1 no hay paso de jefe');
  const boss = stepAfter('upgrade_intro', ctx({ status: 'blind_select', blindIndex: 2 }));
  assert.equal(boss?.id, 'boss_intro');
});

test('despues del ultimo paso el tutorial cierra', () => {
  assert.ok(isFinalStep('ante_complete'));
  assert.equal(isFinalStep('blind_select'), false);
  const after = stepAfter('ante_complete', ctx({ status: 'reward' }));
  assert.equal(after, null, 'no hay nada despues de ante_complete');
});

test('la semilla del tutorial es fija y reconocible', () => {
  assert.equal(TUTORIAL_SEED, 0xf00d);
});
