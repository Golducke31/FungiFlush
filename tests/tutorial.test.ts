/**
 * tutorial.test.ts — El GUION del tutorial avanza y termina.
 *
 * Que protege:
 *   1. El guion es LINEAL por CAPITULO: desde el principio de cada capitulo,
 *      avanzando paso a paso con el estado correcto, se recorren TODOS sus pasos
 *      sin repetir ninguno.
 *   2. Cada paso declara una `phase` real de `GameStatus` (sin typos) y un
 *      `chapter` valido.
 *   3. Un paso OPCIONAL cuyo `require` falla se SALTEA: el guion no se traba.
 *   4. Al final de cada capitulo, `stepAfter` devuelve `null` (el capitulo cierra).
 *   5. `isFinalStep` reconoce el cierre de SU capitulo y los 23 pasos existen con
 *      claves i18n unicas en ES y EN.
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
  lastStepOfChapter,
  stepAfter,
  stepsOfChapter,
  type TutorialChapter,
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
    chapter: 'classic',
    blindIndex: 0,
    ante: 1,
    selectedCount: 0,
    handsPlayed: 0,
    handComboKind: null,
    lastComboKind: null,
    lastOverlap: false,
    lastOrder: null,
    visitedShop: false,
    sawPurge: false,
    ...over,
  };
}

/**
 * Recorre un capitulo entero simulando un jugador que hace todo lo que cada paso
 * pide, y devuelve los ids visitados en orden.
 */
function walk(chapter: TutorialChapter): TutorialStepId[] {
  const steps = stepsOfChapter(chapter);
  const visited: TutorialStepId[] = [];
  let current: TutorialStepId | null = null;
  for (let guard = 0; guard < 80 && visited.length < steps.length; guard += 1) {
    const guess = steps[visited.length];
    if (!guess) break;
    const step = stepAfter(
      current,
      ctx({
        chapter,
        status: guess.phase,
        blindIndex: guess.id === 'boss_intro' ? 2 : 0,
        selectedCount: guess.id === 'select_cards' ? 0 : 3,
        handsPlayed: guess.id === 'play_hand' ? 0 : 1,
        handComboKind: guess.id === 'combo_hint' ? 'family' : null,
        lastOverlap: guess.id === 'overlap_axes',
        visitedShop: false,
        sawPurge: false,
      }),
    );
    if (!step) break;
    visited.push(step.id);
    current = step.id;
  }
  return visited;
}

test('el guion tiene 23 pasos con ids unicos', () => {
  assert.equal(TUTORIAL_STEPS.length, 23);
  assert.equal(new Set(allStepIds()).size, 23);
});

test('los dos capitulos suman el guion completo', () => {
  const classic = stepsOfChapter('classic');
  const advanced = stepsOfChapter('advanced');
  assert.equal(classic.length, 18, 'el capitulo clasico tiene 18 pasos');
  assert.equal(advanced.length, 5, 'el capitulo avanzado tiene 5 pasos');
  assert.equal(classic.length + advanced.length, TUTORIAL_STEPS.length);
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

test('el capitulo clasico se recorre entero, paso a paso, sin repetir', () => {
  assert.deepEqual(
    walk('classic'),
    stepsOfChapter('classic').map((s) => s.id),
    'se recorren los 18 pasos del clasico en orden',
  );
});

test('el capitulo avanzado se recorre entero, paso a paso, sin repetir', () => {
  assert.deepEqual(
    walk('advanced'),
    stepsOfChapter('advanced').map((s) => s.id),
    'se recorren los 5 pasos del avanzado en orden',
  );
});

test('un paso de otro capitulo NUNCA aparece', () => {
  // Desde el principio del capitulo avanzado, ningun paso clasico se cuela.
  const advancedIds = new Set(stepsOfChapter('advanced').map((s) => s.id));
  for (const id of walk('advanced')) {
    assert.ok(advancedIds.has(id), `${id} pertenece al capitulo avanzado`);
  }
});

test('combo_hint se saltea si la mano no forma combo', () => {
  // Venimos de `select_cards`; la mano ACTUAL no forma combo, asi que
  // `combo_hint` no aplica y `element_family` toma el relevo.
  const step = stepAfter(
    'select_cards',
    ctx({ status: 'playing', handComboKind: null, handsPlayed: 0 }),
  );
  assert.equal(step?.id, 'element_family', 'sin combo en mano, el siguiente es element_family');
});

test('combo_hint aparece si la mano forma combo', () => {
  const step = stepAfter(
    'select_cards',
    ctx({ status: 'playing', handComboKind: 'family', handsPlayed: 0 }),
  );
  assert.equal(step?.id, 'combo_hint');
});

test('overlap_axes solo aparece si hubo solapamiento', () => {
  const skipped = stepAfter(
    'substrate_spores',
    ctx({ status: 'reward', lastOverlap: false }),
  );
  assert.equal(skipped?.id, 'reward_draft', 'sin solapamiento, se saltea overlap_axes');
  const shown = stepAfter('substrate_spores', ctx({ status: 'reward', lastOverlap: true }));
  assert.equal(shown?.id, 'overlap_axes');
});

test('si el jugador ya jugo una mano, play_hand se saltea', () => {
  const step = stepAfter(
    'element_family',
    ctx({ status: 'playing', handsPlayed: 2, handComboKind: null }),
  );
  // No quedan pasos de `playing` despues de play_hand: el guion espera a `reward`.
  assert.equal(step, null, 'sin pasos de playing pendientes');
});

test('el guion NO retrocede: pedir el siguiente de un paso tardio no vuelve atras', () => {
  const step = stepAfter('shop_intro', ctx({ status: 'blind_select', blindIndex: 2 }));
  assert.equal(step?.id, 'boss_intro', 'desde shop_intro solo mira hacia adelante');
});

test('boss_intro solo aparece en el ciego de Jefe', () => {
  const notBoss = stepAfter('order_bonus', ctx({ status: 'blind_select', blindIndex: 1 }));
  assert.equal(notBoss, null, 'con blindIndex 1 no hay paso de jefe');
  const boss = stepAfter('order_bonus', ctx({ status: 'blind_select', blindIndex: 2 }));
  assert.equal(boss?.id, 'boss_intro');
});

test('despues del ultimo paso de cada capitulo, el capitulo cierra', () => {
  assert.equal(lastStepOfChapter('classic')?.id, 'ante_complete');
  assert.equal(lastStepOfChapter('advanced')?.id, 'chapter_b_complete');
  assert.ok(isFinalStep('ante_complete'), 'ante_complete cierra el clasico');
  assert.ok(isFinalStep('chapter_b_complete'), 'chapter_b_complete cierra el avanzado');
  assert.equal(isFinalStep('blind_select'), false);
  assert.equal(
    stepAfter('ante_complete', ctx({ status: 'reward' })),
    null,
    'no hay nada despues de ante_complete',
  );
  assert.equal(
    stepAfter('chapter_b_complete', ctx({ chapter: 'advanced', status: 'shop' })),
    null,
    'no hay nada despues de chapter_b_complete',
  );
});

test('la semilla del tutorial es fija y reconocible', () => {
  assert.equal(TUTORIAL_SEED, 0xf00d);
});
