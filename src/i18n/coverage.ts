/**
 * coverage.ts — Verificacion de cobertura de traducciones.
 *
 * Modulo PURO (sin i18next, sin DOM): recibe los diccionarios ya parseados.
 * Asi el mismo chequeo corre en el navegador, en CI y en el harness de consola.
 */

import type { ContentBundle } from '@engine/index';

export type Dictionary = Record<string, unknown>;

function lookup(dict: Dictionary, key: string): unknown {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * Devuelve la lista de claves i18n referenciadas por el contenido que faltan
 * en alguno de los diccionarios. Lista vacia = todo traducido.
 */
export function validateDictionaryCoverage(
  bundle: ContentBundle,
  dicts: Record<string, Dictionary>,
): string[] {
  const missing: string[] = [];
  const langs = Object.keys(dicts);

  const check = (key: string | undefined, where: string) => {
    if (!key) {
      missing.push(`${where}: sin clave i18n`);
      return;
    }
    for (const lang of langs) {
      const value = lookup(dicts[lang] ?? {}, key);
      if (typeof value !== 'string' || value.length === 0) {
        missing.push(`${where}: falta "${key}" en [${lang}]`);
      }
    }
  };

  for (const card of bundle.cards) {
    check(card.nameKey, `card:${card.id}`);
    check(card.descKey, `card:${card.id}`);
    for (const [i, effect] of (card.effects ?? []).entries()) {
      if (effect.labelKey) check(effect.labelKey, `card:${card.id} > effects[${i}]`);
    }
  }
  for (const joker of bundle.jokers) {
    check(joker.nameKey, `joker:${joker.id}`);
    check(joker.descKey, `joker:${joker.id}`);
    for (const [i, effect] of joker.effects.entries()) {
      if (effect.labelKey) check(effect.labelKey, `joker:${joker.id} > effects[${i}]`);
    }
  }
  for (const blind of bundle.blinds) {
    check(blind.nameKey, `blind:${blind.id}`);
    check(blind.descKey, `blind:${blind.id}`);
  }

  // Claves de UI que el codigo usa y no vienen del contenido.
  const REQUIRED_UI_KEYS = [
    'ui.title',
    'ui.newRun',
    'ui.language',
    'hud.ante',
    'hud.score',
    'hud.target',
    'hud.money',
    'hud.substrate',
    'hud.spores',
    'hud.hands',
    'hud.discards',
    'hud.deck',
    'hud.jokers',
    'action.play',
    'action.discard',
    'action.buy',
    'action.sell',
    'action.reroll',
    'action.leaveShop',
    'shop.title',
    'phase.game_over',
    'phase.victory',
    'combo.title',
    'combo.element.2',
    'combo.element.3',
    'combo.element.4',
    'combo.element.5',
    'combo.family.3',
    'combo.family.4',
    'combo.family.5',
    'combo.diversity',
    'combo.rarity.2',
    'combo.rarity.3',
    'combo.rarity.4',
    'combo.straight.3',
    'combo.straight.4',
    'combo.straight.5',
    'combo.fullhouse',
    'element.poison',
    'element.crystal',
    'family.agaricaceae',
    'rarity.mythic',
    'status.dormant',
    'status.decay',
    'status.spore_lock',
    'status.overgrowth',
    'log.triggerOverflow',
  ];
  for (const key of REQUIRED_UI_KEYS) check(key, 'ui');

  return missing;
}
