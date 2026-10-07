/**
 * DeckPresets.ts — Mazos personalizados del jugador (capa META).
 *
 * QUE ES ESTO
 * -----------
 * Un "Deck personalizado" es un preset con nombre: una lista de `{cardId,
 * copies}` con la que arrancar una run, guardada en el perfil. NO es contenido
 * (no vive en `src/data/`), es una PREFERENCIA del jugador, igual que el
 * arquetipo elegido o el dorso equipado.
 *
 * POR QUE ES PURO
 * ---------------
 * Este modulo no toca el DOM, no importa el motor y no lee el perfil. Recibe
 * el catalogo como parametro (`knownIds`, `ownedIds`) y devuelve un veredicto.
 * Asi la validacion se testea sin mocks —que es exactamente lo que este archivo
 * documenta: un mazo degenerado rompe el balance de 8 antes— y la UI queda
 * libre de decidir que es legal.
 *
 * LA PALANCA DEL MOTOR
 * --------------------
 * No hay sistema de mazos nuevo. `GameEngine.setArchetypeLoadout(entries, bias)`
 * ya acepta un mazo arbitrario (lo usa el arquetipo; ver `src/meta/Archetypes.ts`)
 * y `CardRegistry.buildStarterDeck(rng, entries)` instancia las copias. Un deck
 * custom es alimentar ese override desde el perfil en vez de desde
 * `archetypes.json`.
 *
 * INVARIANTES QUE PROTEGE
 * -----------------------
 *   1. El mazo nunca sale vacio ni con ids que no existen (el motor descarta
 *      ids desconocidos en silencio, pero un deck de 1 carta seria una run
 *      injugable que el jugador no pidio).
 *   2. Ninguna carta se repite mas de `MAX_COPIES_PER_CARD` veces: sin tope, 40
 *      copias de la carta mas fuerte trivializan el juego.
 *   3. El tamano esta dentro de `[DECK_MIN, DECK_MAX]`: por debajo el mazo no
 *      aguanta una run de 8 antes; por arriba el reciclado se vuelve trivial.
 */

import type { ElementType } from '@engine/index';

/** Tamano minimo jugable. Debajo de esto el reciclado se dispara enseguida. */
export const DECK_MIN = 20;
/** Tamano maximo. El mazo clasico son 40: es el techo historico. */
export const DECK_MAX = 40;
/**
 * Copias maximas de una misma carta.
 *
 * Se elige 4 (no 1) porque es el lenguaje del naipe: "cuatro de cada palo". Un
 * mazo puede especializarse en su carta estrella, pero no volverse monotematico.
 */
export const MAX_COPIES_PER_CARD = 4;

/** Cuantos presets puede guardar un jugador (v1: uno solo, sin nombre libre). */
export const MAX_DECK_PRESETS = 3;

/** Nombre maximo del preset. Recortado al guardar, no una puerta. */
export const DECK_NAME_MAX = 24;

/** Id del preset por defecto. Es el que la UI abre si no hay ninguno elegido. */
export const DEFAULT_DECK_ID = 'custom';

/** Una entrada del mazo: la misma forma que consume `buildStarterDeck`. */
export interface DeckEntry {
  cardId: string;
  copies: number;
}

/** Un mazo guardado. */
export interface DeckPreset {
  id: string;
  /** Nombre visible. La UI lo deja editar; default "Mazo propio". */
  name: string;
  entries: DeckEntry[];
}

/**
 * El deck elegido y la lista de presets. Es lo que se persiste en el perfil.
 *
 * `selectedId` apunta a un id de `presets` o a `''` (ninguno: la run arranca
 * con el clasico). Se guarda el id y no el objeto para poder rebalancear sin
 * invalidar guardados, igual que `archetype.selected`.
 */
export interface DeckState {
  selectedId: string;
  presets: DeckPreset[];
}

export type DeckErrorCode = 'size' | 'unknown_card' | 'not_owned' | 'too_many_copies' | 'duplicate_entry';

export interface DeckValidationError {
  code: DeckErrorCode;
  cardId?: string;
  /** Valor que disparo el error (tamano, copias), para el mensaje de la UI. */
  value?: number;
}

export interface DeckValidation {
  ok: boolean;
  size: number;
  errors: DeckValidationError[];
}

/**
 * Valida un mazo contra el catalogo y la coleccion del jugador.
 *
 * PURA: todo lo que necesita entra por parametro.
 *
 *   - `entries`   el mazo propuesto
 *   - `knownIds`  ids que existen en el contenido cargado
 *   - `ownedIds`  ids que el jugador posee (packs comprados + desbloqueos)
 *
 * Errores NO excluyentes: se devuelven TODOS para que la UI pueda pintarlos
 * juntos. Un mazo con una carta desconocida y tamano corto debe decir las dos
 * cosas, no una.
 *
 * El orden de los chequeos importa poco porque todos se acumulan, pero se
 * mantiene estable (tamano primero) para que el primer error sea el mas obvio.
 */
export function validateDeck(
  entries: readonly DeckEntry[],
  ownedIds: readonly string[],
  knownIds: readonly string[],
): DeckValidation {
  const errors: DeckValidationError[] = [];
  const known = new Set(knownIds);
  const owned = new Set(ownedIds);
  const seen = new Set<string>();
  let size = 0;

  for (const entry of entries) {
    const copies = Math.floor(entry.copies);
    if (!Number.isFinite(copies) || copies <= 0) continue;
    size += copies;

    // Una entrada repetida (mismo cardId dos veces) no es ilegal para el motor
    // —`buildStarterDeck` las suma— pero la UI nunca la produce y significa que
    // dos toques se separaron. Se marca para que el guardado la limpie.
    if (seen.has(entry.cardId)) {
      errors.push({ code: 'duplicate_entry', cardId: entry.cardId });
      continue;
    }
    seen.add(entry.cardId);

    if (!known.has(entry.cardId)) {
      errors.push({ code: 'unknown_card', cardId: entry.cardId });
      continue;
    }
    if (!owned.has(entry.cardId)) {
      errors.push({ code: 'not_owned', cardId: entry.cardId });
    }
    if (copies > MAX_COPIES_PER_CARD) {
      errors.push({ code: 'too_many_copies', cardId: entry.cardId, value: copies });
    }
  }

  if (size < DECK_MIN || size > DECK_MAX) {
    errors.push({ code: 'size', value: size });
  }

  return { ok: errors.length === 0, size, errors };
}

/**
 * Colapsa entradas repetidas del mismo `cardId` en una sola con la suma.
 *
 * La UI ya no produce duplicados, pero un perfil editado a mano si podria. Se
 * usa al SANEAR un mazo (antes de validar/guardar), no al validar: validar debe
 * decir la verdad sobre lo que le pasaron.
 */
export function collapseDeckEntries(entries: readonly DeckEntry[]): DeckEntry[] {
  const total = new Map<string, number>();
  for (const entry of entries) {
    const copies = Math.floor(entry.copies);
    if (!Number.isFinite(copies) || copies <= 0) continue;
    total.set(entry.cardId, (total.get(entry.cardId) ?? 0) + copies);
  }
  return [...total].map(([cardId, copies]) => ({ cardId, copies }));
}

/**
 * Recorta un mazo a algo seguro: sin duplicados, sin ids desconocidos, sin
 * pasarse del tope por carta, sin pasarse del tamano maximo.
 *
 * NO garantiza que pase `validateDeck` (puede quedar por debajo de `DECK_MIN`:
 * eso no se puede inventar, el jugador tiene que agregar cartas). Garantiza que
 * lo que devuelve no rompe el motor.
 *
 * Se corre al CARGAR un perfil: un guardado viejo apuntando a una carta retirada
 * no debe romper el panel.
 */
export function sanitizeDeck(
  entries: readonly DeckEntry[],
  knownIds: readonly string[],
): DeckEntry[] {
  const known = new Set(knownIds);
  const out: DeckEntry[] = [];
  let size = 0;
  for (const entry of collapseDeckEntries(entries)) {
    if (!known.has(entry.cardId)) continue;
    const copies = Math.min(entry.copies, MAX_COPIES_PER_CARD);
    const room = DECK_MAX - size;
    if (room <= 0) break;
    const take = Math.min(copies, room);
    out.push({ cardId: entry.cardId, copies: take });
    size += take;
  }
  return out;
}

/**
 * Sesgo de tienda derivado del mazo: los elementos DOMINANTES del preset.
 *
 * Es el equivalente a `biasFor(archetypeId)` del arquetipo con nombre: la
 * tienda ofrece en la misma linea que el mazo. Devuelve 1 o 2 elementos (los
 * mas frecuentes) y `[]` si el mazo esta vacio — un mazo vacio NO debe sesgar,
 * o el balance historico del clasico se rompe.
 *
 * `elementOf` lo aporta el llamador (que conoce el registro): este modulo no
 * importa el contenido. Se cuentan las CARTAS (no las copias): el peso de un
 * elemento es en cuantas cartas distintas aparece, no en cuantas copias hay.
 */
export function biasFromDeck(
  entries: readonly DeckEntry[],
  elementOf: (cardId: string) => ElementType | undefined,
  maxElements = 2,
): ElementType[] {
  const counts = new Map<ElementType, number>();
  // Una carta cuenta UNA vez, aunque tenga 4 copias.
  for (const entry of collapseDeckEntries(entries)) {
    const element = elementOf(entry.cardId);
    if (!element) continue;
    counts.set(element, (counts.get(element) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, maxElements))
    .map(([element]) => element);
}

/** El preset elegido, o `undefined` si no hay ninguno valido (`selectedId: ''`). */
export function selectedPreset(state: DeckState): DeckPreset | undefined {
  return state.presets.find((preset) => preset.id === state.selectedId);
}

/** Un preset nuevo y vacio, listo para que la UI lo llene. */
export function emptyDeckPreset(id: string = DEFAULT_DECK_ID, name = ''): DeckPreset {
  return { id, name, entries: [] };
}

/** Estado de decks por defecto: un preset vacio, ninguno elegido. */
export function defaultDeckState(): DeckState {
  return { selectedId: '', presets: [emptyDeckPreset()] };
}

/**
 * Suma una copia de `cardId` al mazo, respetando el tope por carta y el tope
 * de tamano. Devuelve el mazo NUEVO (no muta) para que la UI compare por
 * referencia y no tenga que clonar.
 *
 * Es la unica operacion de alta que la UI necesita: "tocar para sumar". La de
 * baja es `removeCopy`. Tenerlas aca (y testeadas) evita que la UI duplique la
 * regla del tope y se desincronice del validador.
 */
export function addCopy(entries: readonly DeckEntry[], cardId: string): DeckEntry[] {
  const next = entries.map((e) => ({ ...e }));
  const existing = next.find((e) => e.cardId === cardId);
  const size = next.reduce((sum, e) => sum + e.copies, 0);
  if (size >= DECK_MAX) return next;
  if (existing) {
    if (existing.copies >= MAX_COPIES_PER_CARD) return next;
    existing.copies += 1;
    return next;
  }
  next.push({ cardId, copies: 1 });
  return next;
}

/**
 * Quita una copia de `cardId`. Si llega a cero, se ELIMINA la entrada: un mazo
 * con `{cardId, copies: 0}` es una entrada muerta que el validador ignoraria
 * pero que la UI mostraria como "0 copias" al lado de la carta.
 */
export function removeCopy(entries: readonly DeckEntry[], cardId: string): DeckEntry[] {
  const next: DeckEntry[] = [];
  for (const entry of entries) {
    if (entry.cardId !== cardId) {
      next.push({ ...entry });
      continue;
    }
    if (entry.copies > 1) next.push({ cardId: entry.cardId, copies: entry.copies - 1 });
  }
  return next;
}
