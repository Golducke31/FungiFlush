/**
 * loadContent.node.ts — Carga de contenido en Node (harness de consola y tests).
 *
 * Misma forma de salida que `src/data/index.ts`, pero leyendo del disco.
 * El motor no nota la diferencia: recibe un `ContentBundle` y listo.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BlindDefinition,
  CardDefinition,
  ContentBundle,
  JokerDefinition,
} from '../src/engine/index.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..');
const DATA_DIR = join(PROJECT_ROOT, 'src', 'data');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readCardFolder(): CardDefinition[] {
  const dir = join(DATA_DIR, 'cards');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out: CardDefinition[] = [];
  for (const file of files) {
    const full = join(dir, file);
    if (!statSync(full).isFile()) continue;
    const parsed = readJson<CardDefinition[]>(full);
    if (!Array.isArray(parsed)) {
      throw new Error(`[loadContent] ${file} debe contener un array de cartas.`);
    }
    out.push(...parsed);
  }
  return out;
}

export function loadContentFromDisk(): ContentBundle {
  const jokers = readJson<JokerDefinition[]>(join(DATA_DIR, 'jokers.json'));
  const mutations = readJson<JokerDefinition[]>(join(DATA_DIR, 'mutations.json'));
  const blinds = readJson<BlindDefinition[]>(join(DATA_DIR, 'blinds.json'));
  return {
    cards: readCardFolder(),
    jokers: [...jokers, ...mutations],
    blinds,
  };
}

/** Diccionarios de idioma ya parseados, para validar cobertura de traduccion. */
export function loadDictionaries(): Record<string, Record<string, unknown>> {
  const dir = join(PROJECT_ROOT, 'src', 'i18n');
  return {
    en: readJson<Record<string, unknown>>(join(dir, 'en.json')),
    es: readJson<Record<string, unknown>>(join(dir, 'es.json')),
  };
}
