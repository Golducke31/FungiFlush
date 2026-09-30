/**
 * migrations.ts — Cadena de migraciones de guardado.
 *
 * Por que una tabla de funciones puras y no un `switch` repartido por el
 * codigo: porque este es el punto donde un bug destruye el progreso de alguien
 * que PAGO el juego. Una migracion pura se testea con fixtures y golden files.
 *
 * Reglas:
 *   1. Nunca se borra un guardado ilegible: se pone en cuarentena.
 *   2. El perfil jamas devuelve null: si no se puede migrar, se arranca de
 *      cero antes que romper el juego.
 *   3. Un guardado de una version MAS NUEVA no se degrada: se rechaza.
 */

import { SAVE_VERSION, type RunSaveData } from '@engine/index';
import { PROFILE_SAVE_VERSION, defaultProfile, type ProfileSave } from '../meta/ProfileState';

export type UnknownRecord = Record<string, unknown>;
export type Migration = (input: UnknownRecord) => UnknownRecord;

export const CURRENT_RUN_SAVE_VERSION = SAVE_VERSION;
export const CURRENT_PROFILE_VERSION = PROFILE_SAVE_VERSION;

/** Clave = version de ORIGEN. migrate v -> v+1. */
export const RUN_MIGRATIONS: Record<number, Migration> = {
  1: migrateRunV1toV2,
};

export const PROFILE_MIGRATIONS: Record<number, Migration> = {};

export function migrateChain(
  data: UnknownRecord,
  from: number,
  to: number,
  table: Record<number, Migration>,
): UnknownRecord | null {
  let current = data;
  for (let version = from; version < to; version++) {
    const step = table[version];
    if (!step) return null;
    current = step(current);
  }
  return current;
}

// ---------------------------------------------------------------------------
// Run: v1 -> v2
// ---------------------------------------------------------------------------

/**
 * v2 agrega: contador de jugadas por carta (evoluciones), linaje, estadisticas
 * de mejora/evolucion, y el hash + lista de packs con los que se jugo.
 *
 * Todo campo nuevo tiene default seguro: un save v1 sigue siendo jugable.
 */
export function migrateRunV1toV2(input: UnknownRecord): UnknownRecord {
  const deck = Array.isArray(input['deck']) ? input['deck'] : [];
  const stats = (input['stats'] ?? {}) as UnknownRecord;

  return {
    ...input,
    version: 2,
    savedAt: typeof input['savedAt'] === 'string' ? input['savedAt'] : new Date(0).toISOString(),
    deck: deck.map((entry) => {
      const card = (entry ?? {}) as UnknownRecord;
      return {
        id: card['id'],
        bonusSubstrate: numberOr(card['bonusSubstrate'], 0),
        bonusSpores: numberOr(card['bonusSpores'], 0),
        level: numberOr(card['level'], 1),
        statuses: Array.isArray(card['statuses']) ? card['statuses'] : [],
        plays: numberOr(card['plays'], 0),
        evolvedFrom: card['evolvedFrom'] ?? null,
      };
    }),
    stats: {
      handsPlayed: numberOr(stats['handsPlayed'], 0),
      bestHand: numberOr(stats['bestHand'], 0),
      blindsCleared: numberOr(stats['blindsCleared'], 0),
      cardsDestroyed: numberOr(stats['cardsDestroyed'], 0),
      cardsUpgraded: numberOr(stats['cardsUpgraded'], 0),
      cardsEvolved: numberOr(stats['cardsEvolved'], 0),
    },
    consumedEffects: Array.isArray(input['consumedEffects']) ? input['consumedEffects'] : [],
    contentHash: input['contentHash'] ?? null,
    packIds: Array.isArray(input['packIds']) && input['packIds'].length > 0 ? input['packIds'] : ['base'],
  };
}

/**
 * Migra un guardado de run. Devuelve null si es ilegible o de una version
 * futura (en ese caso la capa superior lo pone en cuarentena).
 */
export function migrateRunSave(raw: unknown): RunSaveData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as UnknownRecord;
  const version = data['version'];
  if (typeof version !== 'number') return null;
  if (version > CURRENT_RUN_SAVE_VERSION) return null;

  const migrated = migrateChain(data, version, CURRENT_RUN_SAVE_VERSION, RUN_MIGRATIONS);
  if (!migrated) return null;

  // Sanidad minima: sin mazzo no hay run. Antes de rechazar, se verifica que
  // al menos exista la forma; las cartas inexistentes las descarta el motor.
  if (!Array.isArray(migrated['deck']) || migrated['deck'].length === 0) return null;
  if (typeof migrated['seed'] !== 'number') return null;

  return migrated as unknown as RunSaveData;
}

/** Migra el perfil. NUNCA devuelve null: cae al perfil por defecto. */
export function migrateProfileSave(raw: unknown): ProfileSave {
  const fallback = defaultProfile();
  if (typeof raw !== 'object' || raw === null) return fallback;

  const data = raw as UnknownRecord;
  const version = data['version'];
  if (typeof version !== 'number' || version > CURRENT_PROFILE_VERSION) return fallback;

  const migrated = migrateChain(data, version, CURRENT_PROFILE_VERSION, PROFILE_MIGRATIONS);
  if (!migrated) return fallback;

  // Mezcla sobre el default: un perfil viejo al que le faltan campos nuevos
  // sigue siendo valido, y uno corrupto en una seccion no tumba al resto.
  const settings = { ...fallback.settings, ...((migrated['settings'] as object) ?? {}) };
  const entitlements = { ...fallback.entitlements, ...((migrated['entitlements'] as object) ?? {}) };
  const collection = { ...fallback.collection, ...((migrated['collection'] as object) ?? {}) };
  const cosmetics = { ...fallback.cosmetics, ...((migrated['cosmetics'] as object) ?? {}) };
  const stats = { ...fallback.stats, ...((migrated['stats'] as object) ?? {}) };
  const board = { ...fallback.board, ...((migrated['board'] as object) ?? {}) };
  // Retencion (P0): campos ADITIVOS. El merge sobre el default alcanza y sobra,
  // asi que no hace falta entrada en PROFILE_MIGRATIONS. Sin estas tres lineas
  // el objeto reconstruido de abajo los descartaria: el return es explícito.
  const daily = { ...fallback.daily, ...((migrated['daily'] as object) ?? {}) };
  const achievements = { ...fallback.achievements, ...((migrated['achievements'] as object) ?? {}) };

  return {
    version: CURRENT_PROFILE_VERSION,
    updatedAt: typeof migrated['updatedAt'] === 'string' ? migrated['updatedAt'] : fallback.updatedAt,
    settings,
    entitlements,
    collection,
    daily,
    achievements,
    cosmetics,
    starterOverrides: Array.isArray(migrated['starterOverrides'])
      ? (migrated['starterOverrides'] as ProfileSave['starterOverrides'])
      : [],
    stats,
    board,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
