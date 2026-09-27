/**
 * bootstrap.ts — El unico punto de entrada para armar el contenido del juego.
 *
 *   1. junta manifiestos de todas las fuentes (bundled + remotas),
 *   2. carga y parsea cada pack,
 *   3. los mezcla en un ContentRegistry,
 *   4. valida y devuelve los problemas para que la app decida que hace.
 *
 * `main.ts` es el unico llamador. Cambiar de "solo base" a "base + DLC"
 * no cambia ninguna linea de este archivo: solo el indice remoto.
 */

import { ContentRegistry, type PackIssue, type SkippedPack } from './ContentRegistry';
import { BundledPackSource, HttpPackSource, type PackSource } from './packSource';
import type { PackManifest } from './types';

export interface BootstrapOptions {
  appVersion: string;
  /** Intenta cargar packs remotos. Default true en produccion. */
  remote?: boolean;
  /** Base URL de los packs remotos (relativa: funciona bajo asset:// de Tauri). */
  remoteBase?: string;
  /** Fuentes extra (tests, herramientas). */
  sources?: PackSource[];
  /** Diccionarios base ya cargados, para validar cobertura i18n. */
  dictionaries?: Record<string, Record<string, unknown>>;
}

export interface BootstrapResult {
  registry: ContentRegistry;
  issues: PackIssue[];
  /** Diccionarios de los packs, listos para mezclarse sobre el base. */
  packDictionaries: Record<string, Record<string, unknown>>;
  loadedIds: string[];
  skipped: SkippedPack[];
}

export async function bootstrapContent(options: BootstrapOptions): Promise<BootstrapResult> {
  const registry = new ContentRegistry(options.appVersion);
  const remote = options.remote ?? true;

  const bundled = new BundledPackSource();
  const sources: PackSource[] = [bundled, ...(options.sources ?? [])];
  if (remote) sources.push(new HttpPackSource(options.remoteBase ?? 'packs/'));

  // --- Descubrir ---
  const manifests: PackManifest[] = [];
  const seenIds = new Set<string>();
  for (const source of sources) {
    for (const manifest of await source.list()) {
      if (seenIds.has(manifest.id)) continue;
      seenIds.add(manifest.id);
      manifests.push(manifest);
    }
  }

  // --- Cargar (en paralelo; el merge final es por manifiesto, no por orden) ---
  const loaded = await Promise.all(
    manifests.map(async (manifest) => {
      for (const source of sources) {
        const pack = await source.load(manifest.id);
        if (pack) return pack;
      }
      return null;
    }),
  );

  for (const pack of loaded) {
    if (pack) registry.add(pack);
  }

  // --- Validar ---
  const packDictionaries = registry.packDictionaries();
  const merged = mergeDictionaries(options.dictionaries ?? {}, packDictionaries);
  const issues = registry.validate({ dictionaries: merged });

  return {
    registry,
    issues,
    packDictionaries,
    loadedIds: registry.activeManifests().map((m) => m.id),
    skipped: registry.skipped,
  };
}

/** Mezcla slices de packs sobre los diccionarios base (sin pisar el base). */
export function mergeDictionaries(
  base: Record<string, Record<string, unknown>>,
  packs: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const lang of new Set([...Object.keys(base), ...Object.keys(packs)])) {
    out[lang] = { ...(base[lang] ?? {}), ...(packs[lang] ?? {}) };
  }
  return out;
}
