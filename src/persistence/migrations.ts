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
import { COLONY_LEVELS, levelForSpores } from '../meta/Colony';
import { MAX_DECK_PRESETS, defaultDeckState } from '../meta/DeckPresets';
import { defaultPackInventory } from '../meta/Packs';
import { emptySnapshot } from '../meta/Leaderboard';
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
  3: migrateProfileV3toV4,
  4: migrateProfileV4toV5,
  5: migrateProfileV5toV6,
  6: migrateProfileV6toV7,
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
 * Perfil: v3 -> v4
 *
 * v4 agrega la meta-progresion de la Colonia Fungi (`colony`) y la cuenta
 * (`account`).
 *
 * Defaults a proposito:
 *   - `colony` arranca en cero. Un perfil v3 es de alguien que jugo ANTES de
 *     que existieran las Esporas de Colonia: no se le puede reconstruir hacia
 *     atras el historial de Ciegos, asi que empieza a acumular desde ahora.
 *     Inventarle Esporas por partidas viejas seria regalar progreso que nadie
 *     gano (y el ranking futuro lo notaria).
 *   - `account.syncState` cae a `'offline'`: sin cuenta vinculada el progreso
 *     es local, que es exactamente lo que era un perfil v3.
 */
export function migrateProfileV3toV4(input: UnknownRecord): UnknownRecord {
  return {
    ...input,
    version: 4,
    colony: {
      lifetimeSpores: 0,
      level: 1,
      unlockedRewards: [],
      seasonSpores: 0,
      seasonId: '',
      lastSyncAt: null,
      firstClears: [],
      dailyAwardedDate: '',
      dailyAwardedCount: 0,
      dailySporesAwarded: 0,
    },
    account: {
      provider: 'none',
      accountId: null,
      displayName: null,
      syncState: 'offline',
      lastSyncAt: null,
      pendingResults: [],
      verifiedSpores: null,
      leaderboard: { season: null, lifetime: null, fetchedAt: null },
    },
  };
}

/**
 * Perfil: v4 -> v5
 *
 * v5 agrega los sobres (`packs`): cuantos tiene pendientes y cuantos abrio de
 * por vida.
 *
 * Default a proposito: arranca en cero con `defaultPackInventory()`. Un perfil
 * v4 es de alguien que jugo ANTES de que existieran los sobres; los Ciegos que
 * supero no se pueden reconstruir hacia atras, asi que empieza a ganar sobres
 * desde ahora. Regalarle sobres por partidas viejas seria inventar progreso que
 * nadie gano (y la economia meta lo notaria). Es defensivo ante un perfil al
 * que le falte el campo: cae al default en vez de romper el guardado.
 */
export function migrateProfileV4toV5(input: UnknownRecord): UnknownRecord {
  const initial = defaultPackInventory();
  const raw = input['packs'];
  const packData = typeof raw === 'object' && raw !== null ? (raw as UnknownRecord) : {};
  return {
    ...input,
    version: 5,
    packs: {
      pending: numberOr(packData['pending'], initial.pending),
      opened: numberOr(packData['opened'], initial.opened),
    },
  };
}

/**
 * Perfil: v5 -> v6
 *
 * v6 agrega dos cosas que van juntas porque nacieron del mismo rediseno:
 *
 *   - `packs.bossMisses` / `packs.expansionPending` / `packs.expansionOpened`:
 *     los sobres dejan de caer en CADA ciego y pasan a caer solo al vencer a un
 *     Jefe, con pity (`rollPackDrop`), y aparece un segundo tipo de sobre (el de
 *     expansion).
 *   - `collection.ownedCounts`: cuantas copias de cada carta se obtuvieron de
 *     sobres, para que la Coleccion muestre "xN" en vez de repetir la carta.
 *
 * Defaults a proposito: todo en cero / objeto vacio. Un perfil v5 es de alguien
 * que jugo antes de este cambio; no se le puede reconstruir hacia atras cuantas
 * copias saco de cada sobre, asi que empieza a contar desde ahora.
 */
export function migrateProfileV5toV6(input: UnknownRecord): UnknownRecord {
  const initial = defaultPackInventory();
  const rawPacks = input['packs'];
  const packData = typeof rawPacks === 'object' && rawPacks !== null ? (rawPacks as UnknownRecord) : {};
  const rawCollection = input['collection'];
  const collectionData =
    typeof rawCollection === 'object' && rawCollection !== null ? (rawCollection as UnknownRecord) : {};
  return {
    ...input,
    version: 6,
    packs: {
      ...packData,
      pending: numberOr(packData['pending'], initial.pending),
      opened: numberOr(packData['opened'], initial.opened),
      expansionPending: numberOr(packData['expansionPending'], initial.expansionPending),
      expansionOpened: numberOr(packData['expansionOpened'], initial.expansionOpened),
      bossMisses: numberOr(packData['bossMisses'], initial.bossMisses),
    },
    collection: {
      ...collectionData,
      ownedCounts:
        typeof collectionData['ownedCounts'] === 'object' && collectionData['ownedCounts'] !== null
          ? collectionData['ownedCounts']
          : {},
    },
  };
}

/**
 * Perfil: v6 -> v7
 *
 * v7 agrega los mazos personalizados (`decks`): la lista de presets guardados y
 * cual esta elegido. Ver `src/meta/DeckPresets.ts`.
 *
 * Default a proposito: un preset VACIO sin elegir. Un perfil v6 es de alguien
 * que jugo antes de que existiera el modo; no tiene mazo armado y lo correcto es
 * que arranque con el clasico hasta que el jugador entre a la pestaña y lo arme.
 * Inventarle un mazo seria decidir por el.
 *
 * Se normaliza con `defaultDeckState()` en vez de confiar en la forma cruda: si
 * el campo viniera con basura (numero suelto, edicion a mano, formato futuro),
 * cae al default en vez de romper el panel al leer `presets.length`.
 */
export function migrateProfileV6toV7(input: UnknownRecord): UnknownRecord {
  return {
    ...input,
    version: 7,
    decks: defaultDeckState(),
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
  // Los packs INCLUIDOS en la app se garantizan SIEMPRE. Un perfil viejo trae
  // `owned: ['pack.base']` y el merge hace ganar al perfil, asi que sin esto una
  // actualizacion que agrega contenido incluido dejaria sus cartas bloqueadas
  // (la Coleccion las mostraria como "superficie de venta" de algo que ya se
  // pago). Se UNEN, no se reemplazan: los entitlements comprados se conservan.
  const ownedEntitlements = Array.isArray(entitlements.owned) ? [...entitlements.owned] : [];
  for (const id of fallback.entitlements.owned) {
    if (!ownedEntitlements.includes(id)) ownedEntitlements.push(id);
  }
  entitlements.owned = ownedEntitlements;
  // `pendingUnlocks` (R2) entra por aca y NO necesita linea propia porque el
  // spread ya cubre cualquier campo nuevo de `collection`. Se deja el spread a
  // proposito: enumerar los campos a mano es exactamente la trampa que este
  // archivo documenta (un campo nuevo se descarta en silencio).
  const collection = { ...fallback.collection, ...((migrated['collection'] as object) ?? {}) };
  // v6: `ownedCounts` es un mapa id -> cantidad. Se descartan las entradas
  // basura (no numericas, negativas o cero) para que el badge de la Coleccion no
  // muestre "x-3" ni "xNaN" con un perfil editado a mano.
  const ownedRaw = (collection as UnknownRecord)['ownedCounts'];
  const ownedCounts: Record<string, number> = {};
  if (typeof ownedRaw === 'object' && ownedRaw !== null) {
    for (const [id, value] of Object.entries(ownedRaw as UnknownRecord)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        ownedCounts[id] = Math.floor(value);
      }
    }
  }
  collection.ownedCounts = ownedCounts;
  const cosmetics = { ...fallback.cosmetics, ...((migrated['cosmetics'] as object) ?? {}) };
  // Mismo criterio que los entitlements: los cosmeticos INCLUIDOS (dorso
  // clasico + el de la expansion) se garantizan. Un perfil viejo trae
  // `owned: ['default']` y el dorso nuevo no apareceria nunca en el panel.
  const ownedCosmetics = Array.isArray(cosmetics.owned) ? [...cosmetics.owned] : [];
  for (const id of fallback.cosmetics.owned) {
    if (!ownedCosmetics.includes(id)) ownedCosmetics.push(id);
  }
  cosmetics.owned = ownedCosmetics;
  // Slots equipados: strings no vacios. Cubre los de la Tarjeta de Jugador
  // (avatar/marco/titulo/fondo/efecto) y los clasicos. Un perfil editado a mano
  // que traiga un numero o un string vacio cae a 'default' en vez de romper el
  // resolvedor de arte.
  const equipSlots = [
    'equippedCardBack',
    'equippedFelt',
    'equippedAvatar',
    'equippedFrame',
    'equippedTitle',
    'equippedBackground',
    'equippedVictoryFx',
  ] as const;
  for (const slot of equipSlots) {
    const value = cosmetics[slot];
    if (typeof value !== 'string' || value.length === 0) cosmetics[slot] = 'default';
  }
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

  // Colonia Fungi (v4): OBJETO anidado ADITIVO. Un perfil v3 no lo tiene y cae
  // al default (cero Esporas). El merge sobre el default protege de un perfil
  // editado a mano al que le falte un campo.
  const colonyRaw = migrated['colony'];
  const colony = {
    ...fallback.colony,
    ...((typeof colonyRaw === 'object' && colonyRaw !== null ? colonyRaw : {}) as object),
  };
  // El nivel es DERIVADO de las Esporas: si un perfil llegara con un nivel
  // incoherente (editado a mano, o migrado de un formato futuro), se recalcula
  // para que la UI no muestre un estado imposible.
  colony.level = Math.max(1, Math.floor(levelForSpores(colony.lifetimeSpores)));
  if (!Array.isArray(colony.firstClears)) colony.firstClears = [];
  if (!Array.isArray(colony.unlockedRewards)) colony.unlockedRewards = [];
  // RECONCILIACION (fix): `unlockedRewards` es la fuente AUTORITATIVA del estado
  // de reclamo (`main.ts` enriquece cada fila con `unlockedRewards.has(id)`), pero
  // el nivel se DERIVA de las Esporas. Si un perfil guardado venia de antes del
  // sistema de recompensas nombradas —o si el nivel se recalculo alguna vez sin
  // empujar los desbloqueos— las recompensas de nivel alto quedaban "desbloqueadas"
  // para la vista (que usa el nivel) pero SIN boton de reclamar (que usa
  // `unlockedRewards`): el jugador las veia y no podia reclamarlas, asi que nunca
  // entraban a `cosmetics.owned` ni se podian equipar. Se rellena hacia adelante
  // con los `rewardId` de todos los niveles <= al nivel alcanzado.
  for (const def of COLONY_LEVELS) {
    if (def.level > colony.level) break;
    if (def.rewardId && !colony.unlockedRewards.includes(def.rewardId)) {
      colony.unlockedRewards.push(def.rewardId);
    }
  }
  // Recompensas de la Colonia (aditivo): los ids reclamados. Un perfil viejo no
  // lo tiene y cae a `[]` por el spread, pero un valor no-array (edicion a mano)
  // se corrige aca para que `claimableRewards` no explote con `.filter`.
  if (!Array.isArray(colony.claimedRewards)) colony.claimedRewards = [];

  // Sobres (v5): OBJETO anidado ADITIVO. Un perfil v4 no lo tiene y cae al
  // default (cero sobres). Si llegara con la forma equivocada (numero suelto,
  // edicion a mano), el spread sobre el default lo descarta. `pending` y
  // `opened` son contadores: se fuerzan a enteros >= 0 para que un valor
  // negativo o fractional de un perfil editado no deje la UI en un estado
  // imposible ("-3 sobres por abrir").
  const packsRaw = migrated['packs'];
  const packs = {
    ...fallback.packs,
    ...((typeof packsRaw === 'object' && packsRaw !== null ? packsRaw : {}) as object),
  };
  packs.pending = Math.max(0, Math.floor(packs.pending));
  packs.opened = Math.max(0, Math.floor(packs.opened));
  if (!Number.isFinite(packs.pending)) packs.pending = 0;
  if (!Number.isFinite(packs.opened)) packs.opened = 0;
  // v6: segundo tipo de sobre (expansion) + contador del pity de Jefes.
  packs.expansionPending = Math.max(0, Math.floor(packs.expansionPending));
  packs.expansionOpened = Math.max(0, Math.floor(packs.expansionOpened));
  packs.bossMisses = Math.max(0, Math.floor(packs.bossMisses));
  if (!Number.isFinite(packs.expansionPending)) packs.expansionPending = 0;
  if (!Number.isFinite(packs.expansionOpened)) packs.expansionOpened = 0;
  if (!Number.isFinite(packs.bossMisses)) packs.bossMisses = 0;

  // Cuenta (v4): OBJETO anidado ADITIVO.
  const accountRaw = migrated['account'];
  const account = {
    ...fallback.account,
    ...((typeof accountRaw === 'object' && accountRaw !== null ? accountRaw : {}) as object),
  };
  if (!Array.isArray(account.pendingResults)) account.pendingResults = [];
  // Ranking (V1.3): el tablero cacheado es un objeto ANIDADO. Si llegara con la
  // forma equivocada (edicion a mano, formato futuro), se cae al snapshot vacio
  // en vez de romper el panel al leer `entries`.
  const lbRaw = (account as UnknownRecord)['leaderboard'];
  account.leaderboard =
    typeof lbRaw === 'object' && lbRaw !== null
      ? { ...emptySnapshot(), ...(lbRaw as object) }
      : emptySnapshot();
  if (typeof account.verifiedSpores !== 'number') account.verifiedSpores = null;

  // Mazos personalizados (v7): OBJETO anidado ADITIVO. Un perfil v6 no lo tiene
  // y cae al default (preset vacio, ninguno elegido). Se valida la FORMA aca
  // (que `presets` sea array, que cada preset tenga id/entries validos) pero NO
  // el CONTENIDO: la migracion no conoce el registro de cartas. El filtrado por
  // `knownIds`/`ownedIds` lo hace `main.ts` al cargar, con `sanitizeDeck`.
  const decksRaw = migrated['decks'];
  const decks = {
    ...fallback.decks,
    ...((typeof decksRaw === 'object' && decksRaw !== null ? decksRaw : {}) as object),
  };
  decks.presets = normalizeDeckPresets(decks.presets);
  if (typeof decks.selectedId !== 'string') decks.selectedId = '';
  // Si el id elegido no apunta a ningun preset, se cae a "ninguno" (clasico):
  // un `selectedId` huerfano dejaria el panel sin nada marcado.
  if (!decks.presets.some((preset) => preset.id === decks.selectedId)) {
    decks.selectedId = '';
  }

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
    colony,
    account,
    packs,
    decks,
  };
}

/**
 * Normaliza la lista de presets de un guardado crudo.
 *
 * Reglas:
 *   - `presets` no-array o vacio -> un preset vacio por defecto (la UI necesita
 *     al menos uno para tener donde escribir).
 *   - Cada preset sin `id` string se descarta; sin `entries` array queda vacio.
 *   - Las entradas se limpian a `{cardId, copies}` con `copies` entero > 0.
 *   - Se capea a `MAX_DECK_PRESETS` para que un perfil editado a mano no llene
 *     el panel.
 *
 * NO filtra por catalogo: eso lo hace `sanitizeDeck` con el registro real.
 */
function normalizeDeckPresets(raw: unknown): ProfileSave['decks']['presets'] {
  const fallback = defaultDeckState().presets;
  if (!Array.isArray(raw)) return fallback;
  const out: ProfileSave['decks']['presets'] = [];
  for (const item of raw) {
    if (out.length >= MAX_DECK_PRESETS) break;
    if (typeof item !== 'object' || item === null) continue;
    const record = item as UnknownRecord;
    const id = record['id'];
    if (typeof id !== 'string' || id.length === 0) continue;
    const name = typeof record['name'] === 'string' ? record['name'] : '';
    const entries: Array<{ cardId: string; copies: number }> = [];
    const rawEntries = record['entries'];
    if (Array.isArray(rawEntries)) {
      for (const rawEntry of rawEntries) {
        if (typeof rawEntry !== 'object' || rawEntry === null) continue;
        const entry = rawEntry as UnknownRecord;
        const cardId = entry['cardId'];
        if (typeof cardId !== 'string' || cardId.length === 0) continue;
        const copies = numberOr(entry['copies'], 0);
        if (copies <= 0) continue;
        entries.push({ cardId, copies: Math.floor(copies) });
      }
    }
    out.push({ id, name, entries });
  }
  // Si TODO era basura, se cae al default: un array vacio dejaria la pestaña
  // sin ningun preset que seleccionar.
  return out.length > 0 ? out : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
