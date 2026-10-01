/**
 * content/types.ts — Contrato de los packs de contenido.
 *
 * Un "pack" es una carpeta con un `pack.json` (manifiesto) y los archivos que
 * declara. El juego base es un pack; una expansion es otro; una temporada es
 * otro. El motor nunca sabe cuantos hay: solo recibe el bundle ya mezclado.
 *
 * POR QUE EXISTE ESTA CAPA
 * ------------------------
 * Antes, `src/data/index.ts` descubria los .json con un glob *eager*, lo que
 * inlinea todo en el bundle: agregar contenido exigia recompilar y no habia
 * forma de saber de donde venia cada carta. Con packs:
 *
 *   - cada pack declara que contiene y que version de app necesita,
 *   - el merge es deterministico (no depende del orden del filesystem),
 *   - una expansion puede viajar por HTTP (DLC) sin cambiar una linea de codigo,
 *   - el contenido bloqueado se puede filtrar por entitlement (ver src/meta).
 */

import type {
  BlindDefinition,
  CardDefinition,
  EvolutionRule,
  JokerDefinition,
  OfferTable,
  UpgradeTrack,
  VoucherDefinition,
} from '@engine/index';
// Solo el TIPO: no arrastra `@engine/board` al bundle de contenido. El modo
// tablero se carga con `await import('@engine/board')` cuando se juega.
import type { BoardCardDef } from '@engine/board/types';

// Los tipos de tabla de oferta viven en el MOTOR (`src/engine/types.ts`)
// porque son parte del contrato de datos que el motor consume. Aca solo se
// re-exportan para que el resto de la capa de contenido los tenga a mano.
export type { OfferTable, OfferGroup, OfferOption, OfferKind, OfferPhase } from '@engine/index';

// ---------------------------------------------------------------------------
// Manifiesto
// ---------------------------------------------------------------------------

export type PackKind = 'base' | 'expansion' | 'season';

/** Semver "X.Y.Z" — se compara numericamente. */
export type AppVersion = string;

export interface PackRequires {
  /** Version minima de la app. Si no se cumple, el pack se OMITE (no es error). */
  appMin?: AppVersion;
  /** Otros packs que deben estar presentes y habilitados. */
  packs?: string[];
}

export interface PackContents {
  /** Rutas relativas al directorio del pack. */
  cards?: string[];
  jokers?: string[];
  mutations?: string[];
  blinds?: string[];
  offers?: string[];
  evolutions?: string[];
  /** Modificadores de run (R3). */
  vouchers?: string[];
  upgrades?: string[];
  board?: string[];
  antes?: string[];
}

export interface PackGating {
  /** Clave de entitlement que se consulta en EntitlementStore. Default `pack.<id>`. */
  entitlement?: string;
  /** Como se muestra el contenido bloqueado. Default 'visible' (grisado, con el nombre del pack). */
  lockedVisibility?: 'visible' | 'hidden';
  /** Temporada a la que pertenece (solo kind === 'season'). */
  seasonId?: string;
  /**
   * Si es true, este pack PUEDE pisar ids declarados por packs anteriores
   * (y solo si su `version` es mayor). Default false: ante un conflicto gana
   * el primero y se reporta en `collisions`.
   */
  allowOverride?: boolean;
}

export interface PackManifest {
  /** snake_case, globalmente unico. */
  id: string;
  /** Entero monotono por pack. */
  version: number;
  kind: PackKind;
  /** Mayor gana al ordenar. Default 0. */
  priority: number;
  titleKey: string;
  descKey?: string;
  requires?: PackRequires;
  gating?: PackGating;
  contents: PackContents;
  /** lang -> ruta del diccionario del pack (se mezcla sobre el diccionario base). */
  i18n?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Contenido tipado
// ---------------------------------------------------------------------------

/** Tabla de objetivos por ante. Reemplaza el ANTE_BASE_TARGET hardcodeado. */
export interface AnteRow {
  ante: number;
  baseTarget: number;
}

export interface RawPack {
  manifest: PackManifest;
  /** path declarado -> JSON ya parseado. */
  files: Record<string, unknown>;
  origin: 'bundled' | 'remote';
}

export interface LoadedPack extends RawPack {
  cards: CardDefinition[];
  jokers: JokerDefinition[];
  mutations: JokerDefinition[];
  blinds: BlindDefinition[];
  offers: OfferTable[];
  antes: AnteRow[];
  upgrades: UpgradeTrack[];
  evolutions: EvolutionRule[];
  /** Modificadores de run. Ver `VoucherDefinition`. */
  vouchers: VoucherDefinition[];
  /** Flechas del modo tablero. Indexadas por `cardId`, no por posicion. */
  board: BoardCardDef[];
}

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

/** Compara semver numerico. Devuelve <0, 0 o >0. */
export function compareVersion(a: AppVersion, b: AppVersion): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const KIND_RANK: Record<PackKind, number> = { base: 0, expansion: 1, season: 2 };

/**
 * Orden de merge. Determinista: no depende del orden del filesystem ni de
 * como Vite resolvio el glob.
 *   1) base antes que expansion antes que season
 *   2) mayor priority primero
 *   3) id alfabetico como desempate
 */
export function comparePacks(a: PackManifest, b: PackManifest): number {
  const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (rank !== 0) return rank;
  const prio = (b.priority ?? 0) - (a.priority ?? 0);
  if (prio !== 0) return prio;
  return a.id.localeCompare(b.id);
}

/** Clave de entitlement por defecto de un pack. */
export function entitlementFor(manifest: PackManifest): string {
  return manifest.gating?.entitlement ?? `pack.${manifest.id}`;
}
