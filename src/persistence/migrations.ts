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

export const PROFILE_MIGRATIONS: Record<number, Migration> = {
  1: migrateProfileV1toV2,
  2: migrateProfileV2toV3,
};

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
    // Score acumulado de la run. Aditivo: un guardado previo no lo trae y cae a
    // 0, que es correcto (no podemos reconstruirlo hacia atras). No sube version.
    totalScore: numberOr(input['totalScore'], 0),
    consumedEffects: Array.isArray(input['consumedEffects']) ? input['consumedEffects'] : [],
    contentHash: input['contentHash'] ?? null,
    packIds: Array.isArray(input['packIds']) && input['packIds'].length > 0 ? input['packIds'] : ['base'],
  };
}

/**
 * Perfil: v1 -> v2
 *
 * v2 agrega `seenTutorial` (la guia de inicio se muestra una vez por perfil, no
 * una vez por run). Default `false` a proposito: un perfil v1 es de alguien que
 * jugo ANTES de que la guia nueva existiera o que nunca llego a verla, y
 * mostrarle la guia una vez mas es inofensivo; darlo por visto y no mostrarla
 * nunca seria peor. El jugador la cierra en un toque.
 */
export function migrateProfileV1toV2(input: UnknownRecord): UnknownRecord {
  return {
    ...input,
    version: 2,
    seenTutorial: input['seenTutorial'] === true,
  };
}

/**
 * Perfil: v2 -> v3
 *
 * v3 agrega `ui` (estado de paneles: misiones plegadas, ayuda abierta).
 * Default todo cerrado: un perfil v2 no tiene preferencias previas.
 */
export function migrateProfileV2toV3(input: UnknownRecord): UnknownRecord {
  return {
    ...input,
    version: 3,
    ui: { missionsOpen: false, helpOpen: false },
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
  // `pendingUnlocks` (R2) entra por aca y NO necesita linea propia porque el
  // spread ya cubre cualquier campo nuevo de `collection`. Se deja el spread a
  // proposito: enumerar los campos a mano es exactamente la trampa que este
  // archivo documenta (un campo nuevo se descarta en silencio).
  const collection = { ...fallback.collection, ...((migrated['collection'] as object) ?? {}) };
  const cosmetics = { ...fallback.cosmetics, ...((migrated['cosmetics'] as object) ?? {}) };
  const stats = { ...fallback.stats, ...((migrated['stats'] as object) ?? {}) };
  const board = { ...fallback.board, ...((migrated['board'] as object) ?? {}) };
  // Retencion (P0): campos ADITIVOS. El merge sobre el default alcanza y sobra,
  // asi que no hace falta entrada en PROFILE_MIGRATIONS. Sin estas tres lineas
  // el objeto reconstruido de abajo los descartaria: el return es explícito.
  const daily = { ...fallback.daily, ...((migrated['daily'] as object) ?? {}) };
  const achievements = { ...fallback.achievements, ...((migrated['achievements'] as object) ?? {}) };
  // Ascension (R1): OBJETO anidado, no escalar. Un `ascension` que llegara
  // como numero (formato viejo o edicion a mano) se descarta por el spread:
  // solo se acepta la forma `{ highestUnlocked, selected }`.
  const ascRaw = migrated['ascension'];
  const ascension = {
    ...fallback.ascension,
    ...((typeof ascRaw === 'object' && ascRaw !== null ? ascRaw : {}) as object),
  };
  // El nivel elegido nunca puede superar el desbloqueado: un perfil editado a
  // mano podria pedir A8 sin haber ganado nunca, y el motor lo clampearia
  // igual, pero asi la UI no muestra un estado imposible.
  ascension.selected = Math.max(0, Math.min(ascension.selected, ascension.highestUnlocked));

  // Historial (R5): array ADITIVO. Igual que `starterOverrides`, sobrevive al
  // merge sobre el default pero el return de abajo es explícito: sin esta linea
  // el campo reconstruido lo descartaria (la trampa de siempre).
  const history = Array.isArray(migrated['history'])
    ? (migrated['history'] as ProfileSave['history'])
    : [];

  // Guia de inicio (v2): booleano ADITIVO. El `return` de abajo es explicito,
  // asi que sin esta linea se perderia igual que `history`.
  const seenTutorial = migrated['seenTutorial'] === true;

  // Arquetipo elegido: OBJETO anidado ADITIVO. Un perfil viejo no lo tiene y
  // cae a `''` (clasico). Si llegara con la forma equivocada (string suelto,
  // edicion a mano) el spread sobre el default lo descarta.
  const archRaw = migrated['archetype'];
  const archetype = {
    ...fallback.archetype,
    ...((typeof archRaw === 'object' && archRaw !== null ? archRaw : {}) as object),
  };
  if (typeof archetype.selected !== 'string') archetype.selected = '';

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
    ascension,
    archetype,
    history,
    seenTutorial,
    ui: {
      missionsOpen: (migrated['ui'] as UnknownRecord)?.['missionsOpen'] === true,
      helpOpen: (migrated['ui'] as UnknownRecord)?.['helpOpen'] === true,
    },
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
