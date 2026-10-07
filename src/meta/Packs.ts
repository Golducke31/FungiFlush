/**
 * Packs.ts — Sobres ("packs") ganados al DERROTAR A UN JEFE.
 *
 * CAPA META, NO MOTOR. Un sobre no toca las reglas de la run: es una bolsita de
 * recompensa que se abre desde el menu y entrega cartas a la coleccion. Este
 * modulo sabe COMO se sortea un sobre (rareza + carta), SI CAE O NO al vencer a
 * un Jefe (`rollPackDrop`) y COMO se cuentan los sobres pendientes; NO conoce el
 * registro de contenido (que cartas existen) ni la UI. El pool real de `cardId`s
 * se lo pasa el llamador.
 *
 * POR QUE LA RAREZA ES UN SORTEO APARTE Y NO UNA PROPIEDAD DEL POOL:
 * porque el pool de cartas vive en datos (`src/data`) y las rarezas de las
 * cartas de un sobre son una decision de ECONOMIA meta. Manteniendolas aca, la
 * probabilidad de una epica se calibra en un solo lugar y no queda dependiendo
 * de cuantas cartas comunes haya cargadas.
 *
 * PURO Y DETERMINISTA: no toca el DOM, no lee el reloj por su cuenta
 * (`Date.now()` no se usa ni una vez) y TODO el azar sale del `RNG` que entra
 * por parametro. Misma semilla => mismo sobre, que es lo que hace que se pueda
 * testear sin mocks y que un bug de economia se reproduzca exacto.
 */

import { RNG } from '@engine/rng';

// ---------------------------------------------------------------------------
// Rarezas
// ---------------------------------------------------------------------------

/** Rareza de una carta salida de un sobre. */
export type PackRarity = 'comun' | 'rara' | 'epica';

/**
 * Peso relativo de cada rareza (suman 100 a proposito: leer `70/22/8` como
 * "70% comun, 22% rara, 8% epica" hace innecesario un comentario).
 *
 * La cola es corta por diseno: una epica tiene que SENTIRSE epica. Si subiera,
 * el jugador se acostumbraria y la palabra dejaria de significar nada.
 */
export const PACK_RARITY_WEIGHTS: Record<PackRarity, number> = {
  comun: 70,
  rara: 22,
  epica: 8,
};

/** Rarezas de comun a epica. Orden estable para el sorteo y para el HUD. */
export const PACK_RARITY_ORDER: PackRarity[] = ['comun', 'rara', 'epica'];

/** Cartas que entrega un sobre si el llamador no dice otra cosa. */
export const DEFAULT_CARDS_PER_PACK = 5;

/** Una carta salida de un sobre: su id + la rareza con la que se sorteo. */
export interface PackCard {
  /** Id de carta. Viene del pool que pasa el llamador: aca no se conoce el registro. */
  cardId: string;
  rarity: PackRarity;
}

// ---------------------------------------------------------------------------
// Sorteo del sobre
// ---------------------------------------------------------------------------

/**
 * Sortea un sobre: `cardsPerPack` cartas del `pool`.
 *
 * Por cada carta se decide PRIMERO la rareza (ponderada por
 * `PACK_RARITY_WEIGHTS`) y DESPUES se elige un `cardId`. Dentro de un mismo
 * sobre no se repite carta mientras el pool alcance: sacar la misma carta dos
 * veces en cinco es una decepcion, no una recompensa.
 *
 * Si el pool esta vacio devuelve `[]` sin gastar azar (el sobre no se consume:
 * eso lo decide el llamador con `consumePack`).
 */
export function drawPack(
  rng: RNG,
  pool: readonly string[],
  cardsPerPack = DEFAULT_CARDS_PER_PACK,
): PackCard[] {
  if (pool.length === 0) return [];
  const count = Math.max(0, Math.floor(cardsPerPack));

  // Se copia el pool una vez y se baraja: asi el "sin repetir" es sacar del
  // frente de la lista y agotar en orden distinto cada vez que se reengancha.
  const remaining = rng.shuffle([...pool]);
  const weights = PACK_RARITY_ORDER.map((rarity) => PACK_RARITY_WEIGHTS[rarity]);

  const cards: PackCard[] = [];
  for (let i = 0; i < count; i++) {
    if (remaining.length === 0) break;
    const rarity = rng.weighted(PACK_RARITY_ORDER, weights) ?? 'comun';
    // Si el pool ya se vacio no deberia llegar aca (corta el `break`), pero el
    // `?? ''` evita que un pool con huecos meta una carta inexistente.
    const cardId = remaining.shift() ?? '';
    cards.push({ cardId, rarity });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Drop: cuando cae un sobre
// ---------------------------------------------------------------------------

/**
 * Probabilidad de que un Jefe suelte un sobre.
 *
 * Antes el sobre era GARANTIZADO en cada ciego, lo que inflaba la economia meta:
 * cualquier run corta regalaba 3-4 sobres. Ahora solo cae el Jefe (el 3.er ciego
 * de cada ante) y no siempre.
 */
export const BOSS_PACK_DROP_CHANCE = 0.5;

/**
 * Pity: cuantos Jefes consecutivos SIN sobre hacen que el siguiente sea fijo.
 *
 * Con 50% puro, dos fallos seguidos pasan 1 de cada 4 veces y tres, 1 de cada 8:
 * suficiente para que alguien sienta que "los sobres no existen". A los 2 fallos
 * el 3.er Jefe lo entrega si o si, y el contador vuelve a cero.
 */
export const PACK_PITY_AFTER = 2;

/** Resultado de tirar el drop de un Jefe. */
export interface PackDropRoll {
  drop: boolean;
  /** Fallos CONSECUTIVOS acumulados DESPUES de esta tirada (0 si cayo). */
  misses: number;
}

/**
 * Que fraccion de los sobres que CAEN son de EXPANSION (el resto, base).
 *
 * Es un segundo sorteo, independiente del de `rollPackDrop`: primero se decide
 * SI cae un sobre, despues CUAL. El de expansion es mas raro a proposito — trae
 * contenido nuevo, no el catalogo base.
 */
export const EXPANSION_PACK_SHARE = 0.25;

/** Tipo de sobre que puede caer de un Jefe. */
export type PackDropKind = 'base' | 'expansion';

/**
 * Id del pack de contenido que alimenta el sobre de EXPANSION.
 *
 * Vive aca (y no en el registro de contenido) porque es una decision de
 * ECONOMIA meta, igual que `EXPANSION_PACK_SHARE`: que pack es "el de
 * expansion" cambia con el catalogo, no con las reglas.
 */
export const EXPANSION_PACK_ID = 'deep_mycelium';

/** Sortea QUE sobre cae, dado que ya se decidio que cae uno. */
export function rollPackKind(rng: RNG, expansionShare = EXPANSION_PACK_SHARE): PackDropKind {
  return rng.chance(expansionShare) ? 'expansion' : 'base';
}

/**
 * Tira el drop de un sobre al vencer a un Jefe.
 *
 * Puro y determinista: todo el azar sale del `RNG` que entra por parametro, asi
 * que un test fija la semilla y obtiene siempre el mismo resultado. El contador
 * `misses` lo persiste el llamador (es parte del perfil, no de este modulo).
 */
export function rollPackDrop(
  rng: RNG,
  misses: number,
  chance = BOSS_PACK_DROP_CHANCE,
  pityAfter = PACK_PITY_AFTER,
): PackDropRoll {
  const safeMisses = Number.isFinite(misses) ? Math.max(0, Math.floor(misses)) : 0;
  // El pity GANA sobre el azar: no se tira el dado si ya toca.
  const drop = safeMisses >= pityAfter || rng.chance(chance);
  return { drop, misses: drop ? 0 : safeMisses + 1 };
}

// ---------------------------------------------------------------------------
// Inventario de sobres
// ---------------------------------------------------------------------------

/**
 * Estado persistido de los sobres del jugador.
 *
 * `opened` es de por vida (no se resta nunca): sirve para medir cuantos sobres
 * abrio realmente y para futuras recompensas por cantidad. `pending` es el
 * contador vivo que el jugador ve como "sobres por abrir".
 *
 * Hay DOS familias de sobre: el BASE (cartas del pack base) y el de EXPANSION
 * (cartas del pack `deep_mycelium`). Se cuentan por separado porque abren pools
 * distintos; mezclarlos haria que el jugador no supiera que va a sacar.
 *
 * `bossMisses` es el contador del pity de `rollPackDrop`: Jefes consecutivos
 * vencidos sin sobre. Se resetea a 0 cada vez que cae uno.
 */
export interface PackInventory {
  /** Sobres base sin abrir. */
  pending: number;
  /** Sobres base abiertos de por vida. */
  opened: number;
  /** Sobres de expansion sin abrir. */
  expansionPending: number;
  /** Sobres de expansion abiertos de por vida. */
  expansionOpened: number;
  /** Jefes consecutivos sin soltar sobre (pity). */
  bossMisses: number;
}

export function defaultPackInventory(): PackInventory {
  return { pending: 0, opened: 0, expansionPending: 0, expansionOpened: 0, bossMisses: 0 };
}

/**
 * Suma sobres BASE pendientes. Devuelve el total pendiente.
 *
 * MUTA `inv` (el llamador lo envuelve en `profileStore.patch`), igual que las
 * mutaciones de `Colony.ts`.
 */
export function grantPack(inv: PackInventory, count = 1): number {
  const delta = Math.max(0, Math.floor(count));
  inv.pending = Math.max(0, inv.pending + delta);
  return inv.pending;
}

/** Suma sobres de EXPANSION pendientes. Devuelve el total pendiente. */
export function grantExpansionPack(inv: PackInventory, count = 1): number {
  const delta = Math.max(0, Math.floor(count));
  inv.expansionPending = Math.max(0, inv.expansionPending + delta);
  return inv.expansionPending;
}

/**
 * Consume un sobre base pendiente. Devuelve `false` si no habia ninguno (el
 * llamador decide que hacer: deshabilitar el boton, avisar, etc.). Al abrir se
 * incrementa `opened`, que es de por vida.
 */
export function consumePack(inv: PackInventory): boolean {
  if (inv.pending <= 0) return false;
  inv.pending -= 1;
  inv.opened += 1;
  return true;
}

/** Consume un sobre de EXPANSION pendiente. Mismo contrato que `consumePack`. */
export function consumeExpansionPack(inv: PackInventory): boolean {
  if (inv.expansionPending <= 0) return false;
  inv.expansionPending -= 1;
  inv.expansionOpened += 1;
  return true;
}
