/**
 * packSource.ts — De donde salen los packs.
 *
 * DOS FUENTES, MISMA INTERFAZ:
 *
 *   BundledPackSource  → `import.meta.glob` en build time. Solo el pack base.
 *   HttpPackSource     → fetch de `packs/index.json`. Expansiones y temporadas.
 *
 * Por que las expansiones viajan por HTTP desde el dia 1: si las cargaramos
 * con glob, agregar un DLC exigiria recompilar y republicar. Yendo por fetch
 * (incluso contra archivos estaticos dentro del propio AAB), el dia que la
 * expansion exista basta con soltar la carpeta, actualizar el indice y otorgar
 * el entitlement. Cero cambios de codigo.
 */

import { parsePack } from './parse';
import type { LoadedPack, PackManifest, RawPack } from './types';

export interface PackSource {
  readonly origin: 'bundled' | 'remote';
  list(): Promise<PackManifest[]>;
  load(id: string): Promise<LoadedPack | null>;
}

const PACK_DIR = /packs\/([^/]+)\//;

/** Extrae el id del pack desde una ruta de glob tipo "../data/packs/base/cards/x.json". */
function packIdOf(path: string): string | undefined {
  return PACK_DIR.exec(path)?.[1];
}

export class BundledPackSource implements PackSource {
  readonly origin = 'bundled' as const;

  private readonly manifests: Record<string, PackManifest>;
  private readonly files: Record<string, unknown>;

  constructor() {
    this.manifests = import.meta.glob<PackManifest>('../data/packs/*/pack.json', {
      eager: true,
      import: 'default',
    }) as Record<string, PackManifest>;

    this.files = import.meta.glob<unknown>('../data/packs/*/**/*.json', {
      eager: true,
      import: 'default',
    }) as Record<string, unknown>;
  }

  async list(): Promise<PackManifest[]> {
    return Object.values(this.manifests);
  }

  async load(id: string): Promise<LoadedPack | null> {
    const manifest = Object.values(this.manifests).find((m) => m.id === id);
    if (!manifest) return null;

    const files: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(this.files)) {
      if (packIdOf(path) !== id) continue;
      const relative = path.slice(path.indexOf(`packs/${id}/`) + `packs/${id}/`.length);
      files[relative] = value;
    }

    return parsePack({ manifest, files, origin: 'bundled' });
  }
}

export interface PackIndex {
  packs: string[];
}

export class HttpPackSource implements PackSource {
  readonly origin = 'remote' as const;

  constructor(private readonly baseUrl = 'packs/') {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async list(): Promise<PackManifest[]> {
    let index: PackIndex;
    try {
      index = (await fetch(this.url('index.json')).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })) as PackIndex;
    } catch {
      // Sin indice no hay packs remotos. No es un error: es el estado normal
      // de una instalacion base sin expansiones.
      return [];
    }

    const ids = Array.isArray(index?.packs) ? index.packs : [];
    const manifests = await Promise.all(
      ids.map(async (id) => {
        try {
          return (await fetch(this.url(`${id}/pack.json`)).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })) as PackManifest;
        } catch {
          return null;
        }
      }),
    );
    return manifests.filter((m): m is PackManifest => m !== null);
  }

  async load(id: string): Promise<LoadedPack | null> {
    const manifest = await this.fetchJson<PackManifest>(`${id}/pack.json`);
    if (!manifest) return null;

    const paths = allContentPaths(manifest);
    const entries = await Promise.all(
      paths.map(async (path) => [path, await this.fetchJson<unknown>(`${id}/${path}`)] as const),
    );

    const files: Record<string, unknown> = {};
    for (const [path, value] of entries) {
      if (value !== null) files[path] = value;
    }

    const raw: RawPack = { manifest, files, origin: 'remote' };
    return parsePack(raw);
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(this.url(path));
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}

/** Todos los archivos que un manifiesto declara (para fetch en paralelo). */
function allContentPaths(manifest: PackManifest): string[] {
  const contents = manifest.contents ?? {};
  return [
    ...(contents.cards ?? []),
    ...(contents.jokers ?? []),
    ...(contents.mutations ?? []),
    ...(contents.blinds ?? []),
    ...(contents.offers ?? []),
    ...(contents.evolutions ?? []),
    ...(contents.upgrades ?? []),
    ...(contents.board ?? []),
    ...(contents.antes ?? []),
    ...Object.values(manifest.i18n ?? {}),
  ];
}
