/**
 * cardAbilities.test.ts — Las "habilidades" de carta (effects) estan completas
 * y son coherentes con el motor y con la i18n.
 *
 * Contexto: una carta NO tiene un campo `ability`; su habilidad ES su lista
 * `effects[]`. La UI la marca con "✦ HABILIDAD" cuando `effects.length > 0`.
 * Dos formas de romperla en silencio:
 *   1. un `effects` con un `trigger` que el motor no conoce (nunca dispara),
 *   2. un `labelKey` sin traduccion (la UI mostraba la clave cruda, como el
 *      viejo `card.noAbility`).
 *
 * Este test recorre el pack REAL (no un fixture) y exige:
 *   - todo `trigger` pertenece a TRIGGER_EVENTS,
 *   - toda habilidad tiene al menos una accion con `type`,
 *   - todo `labelKey` resuelve en es.json Y en.json,
 *   - los triggers que las cartas usan hoy siguen presentes en el pack.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { TRIGGER_EVENTS } from '../src/engine/types.ts';
import type { CardDefinition, TriggerEvent } from '../src/engine/types.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../src/i18n/${name}`, import.meta.url), 'utf8'));
}

const ES = readJson('es.json');
const EN = readJson('en.json');

/** Resuelve una clave con puntos ("a.b.c") contra un diccionario. */
function resolveKey(dict: unknown, key: string): boolean {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return false;
  }
  return true;
}

/** Todas las cartas del pack real, con su id. */
function allCards(): CardDefinition[] {
  return buildRegistry().toBundle().cards;
}

/** Los effects de todas las cartas, aplanados. */
function allCardEffects(): Array<{ id: string; trigger: string; labelKey?: string; actions: unknown[] }> {
  const out: Array<{ id: string; trigger: string; labelKey?: string; actions: unknown[] }> = [];
  for (const card of allCards()) {
    for (const effect of card.effects ?? []) {
      out.push({
        id: card.id,
        trigger: effect.trigger,
        labelKey: effect.labelKey,
        actions: (effect.actions ?? []) as unknown[],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('todo trigger de carta pertenece a TRIGGER_EVENTS', () => {
  const known = new Set<string>(TRIGGER_EVENTS);
  const bad: string[] = [];
  for (const { id, trigger } of allCardEffects()) {
    if (!known.has(trigger)) bad.push(`${id}: ${trigger}`);
  }
  assert.deepEqual(bad, [], `triggers desconocidos:\n${bad.join('\n')}`);
});

test('toda habilidad de carta tiene al menos una accion', () => {
  const empty: string[] = [];
  for (const { id, trigger, actions } of allCardEffects()) {
    if (actions.length === 0) empty.push(`${id} (${trigger})`);
  }
  assert.deepEqual(empty, [], `habilidades sin acciones:\n${empty.join('\n')}`);
});

test('todo labelKey de habilidad resuelve en es y en', () => {
  const missing: string[] = [];
  for (const { id, labelKey } of allCardEffects()) {
    if (!labelKey) continue;
    if (!resolveKey(ES, labelKey) || !resolveKey(EN, labelKey)) missing.push(`${id}: ${labelKey}`);
  }
  assert.deepEqual(missing, [], `labelKeys sin traduccion:\n${missing.join('\n')}`);
});

test('el pack define habilidades (si no, la cobertura es vacia)', () => {
  const effects = allCardEffects();
  // Guardia contra un pack que se vaciara en silencio.
  assert.ok(effects.length >= 30, `se esperaban >=30 effects de carta, hay ${effects.length}`);
});

test('los triggers que usan las cartas hoy siguen presentes', () => {
  const used = new Set(allCardEffects().map((e) => e.trigger));
  // Solo los que el pack YA usa. Una tanda futura puede agregar ON_DRAW sin
  // romper este test; lo que no puede es PERDER una habilidad existente.
  const mustHappen: TriggerEvent[] = ['ON_PLAY', 'ON_HAND_SCORED'];
  for (const t of mustHappen) {
    assert.ok(used.has(t), `ninguna carta usa ${t}: se perdio una habilidad`);
  }
});
