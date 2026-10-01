/**
 * loadContent.node.ts — Carga de contenido en Node (harness de consola y tests).
 *
 * Es el espejo de `src/content/bootstrap.ts` pero leyendo del disco y sin
 * `import.meta.glob`. Usa el MISMO `ContentRegistry` y el mismo `parsePack`,
 * asi que el simulador ve exactamente el mismo merge que el juego.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentBundle } from '../src/engine/index.ts';
import { ContentRegistry } from '../src/content/ContentRegistry.ts';
import { parsePack } from '../src/content/parse.ts';
import type { PackManifest, RawPack } from '../src/content/types.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..');
const PACKS_DIR = join(PROJECT_ROOT, 'src', 'data', 'packs');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Lee todos los packs declarados en `src/data/packs/*\/pack.json`. */
export function loadPacksFromDisk(): RawPack[] {
  if (!exists(PACKS_DIR)) return [];
  const dirs = readdirSync(PACKS_DIR).filter((d) => statSync(join(PACKS_DIR, d)).isDirectory());

  const packs: RawPack[] = [];
  for (const dir of dirs.sort()) {
    const manifestPath = join(PACKS_DIR, dir, 'pack.json');
    if (!exists(manifestPath)) continue;
    const manifest = readJson<PackManifest>(manifestPath);

    const files: Record<string, unknown> = {};
    const paths = [
      ...(manifest.contents?.cards ?? []),
      ...(manifest.contents?.jokers ?? []),
      ...(manifest.contents?.mutations ?? []),
      ...(manifest.contents?.blinds ?? []),
      ...(manifest.contents?.offers ?? []),
      ...(manifest.contents?.evolutions ?? []),
      ...(manifest.contents?.vouchers ?? []),
      ...(manifest.contents?.upgrades ?? []),
      ...(manifest.contents?.board ?? []),
      ...(manifest.contents?.antes ?? []),
      ...Object.values(manifest.i18n ?? {}),
    ];
    for (const relative of paths) {
      const full = join(PACKS_DIR, dir, relative);
      if (!exists(full)) continue;
      files[relative] = readJson<unknown>(full);
    }
    packs.push({ manifest, files, origin: 'bundled' });
  }
  return packs;
}

/** Registry listo para usar, con todos los packs del disco ya mezclados. */
export function buildRegistry(): ContentRegistry {
  const registry = new ContentRegistry('999.0.0');
  for (const raw of loadPacksFromDisk()) {
    registry.add(parsePack(raw));
  }
  return registry;
}

/** Compat: bundle plano para el simulador y los tests. */
export function loadContentFromDisk(): ContentBundle {
  return buildRegistry().toBundle();
}

/** Diccionarios de idioma ya parseados, para validar cobertura de traduccion. */
export function loadDictionaries(): Record<string, Record<string, unknown>> {
  const dir = join(PROJECT_ROOT, 'src', 'i18n');
  return {
    en: readJson<Record<string, unknown>>(join(dir, 'en.json')),
    es: readJson<Record<string, unknown>>(join(dir, 'es.json')),
  };
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
