/**
 * scanI18n.ts — Verifica que toda clave i18n escrita en el CODIGO exista.
 *
 * POR QUE EXISTE
 * --------------
 * `validateDictionaryCoverage` cubre las claves del CONTENIDO (cartas, jokers,
 * blinds) y una lista a mano de claves de UI. Esa lista a mano es justo el
 * punto debil: durante la Fase 2 se agregaron los botones de orden del
 * constructor de mazo y los rotulos salieron en pantalla como
 * `deck.sortElement`, porque nadie agrego la clave al diccionario y ningun
 * chequeo lo noto.
 *
 * Este escaneo cierra ese agujero: lee los .ts de `src/`, extrae las claves
 * literales que se le pasan a `t()` / `tName()` / `tDesc()` y falla si falta
 * alguna en cualquier idioma.
 *
 * No es un parser de TypeScript: es un regex. A proposito. Las claves
 * dinamicas (`t(`element.${x}`)`) no se pueden resolver estaticamente y se
 * validan aparte, enumerando todas las familias conocidas.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT, loadDictionaries } from './loadContent.node.ts';

const SRC = join(PROJECT_ROOT, 'src');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'src-tauri', '.git']);

/** Claves con partes variables: se enumeran a mano para cubrir todo el rango. */
const DYNAMIC_FAMILIES: Array<[string, string[]]> = [
  [
    'element',
    ['neutral', 'poison', 'spore', 'decay', 'symbiosis', 'crystal', 'mycelium', 'parasite'],
  ],
  [
    'family',
    [
      'agaricaceae',
      'amanitaceae',
      'boletaceae',
      'polyporaceae',
      'psilocybaceae',
      'clavariaceae',
      'tricholomataceae',
    ],
  ],
  ['rarity', ['common', 'uncommon', 'rare', 'legendary', 'mythic']],
  ['status', ['dormant', 'decay', 'spore_lock', 'overgrowth']],
  ['phase', ['menu', 'blind_select', 'playing', 'scoring', 'reward', 'shop', 'game_over', 'victory']],
  ['combo.element', ['2', '3', '4', '5']],
  ['combo.family', ['3', '4', '5']],
  ['combo.rarity', ['2', '3', '4']],
  ['combo.straight', ['3', '4', '5']],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Clave -> archivos donde aparece. */
export function scanI18nKeys(): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  const pattern = /\bt(?:Name|Desc)?\(\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'/g;

  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (!key) continue;
      const where = keys.get(key) ?? [];
      where.push(file.slice(PROJECT_ROOT.length + 1));
      keys.set(key, where);
    }
  }
  return keys;
}

function lookup(dict: Record<string, unknown>, dotted: string): unknown {
  let node: unknown = dict;
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Devuelve los problemas encontrados: clave faltante, idioma y archivo. */
export function validateI18nKeys(): string[] {
  const dictionaries = loadDictionaries();
  const problems: string[] = [];

  const checkKey = (key: string, where: string) => {
    for (const [lang, dict] of Object.entries(dictionaries)) {
      if (lookup(dict, key) === undefined) {
        problems.push(`[${lang}] falta "${key}" (${where})`);
      }
    }
  };

  for (const [key, files] of scanI18nKeys()) {
    checkKey(key, [...new Set(files)].join(', '));
  }

  // Claves con partes dinamicas: se enumeran todas las combinaciones posibles.
  for (const [prefix, values] of DYNAMIC_FAMILIES) {
    for (const value of values) checkKey(`${prefix}.${value}`, 'clave dinamica');
  }

  return problems;
}
