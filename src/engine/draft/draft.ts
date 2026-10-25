/**
 * draft.ts — Bendiciones y maldiciones (R3): el borrador de reglas de la run.
 *
 * QUE ES UN DRAFT
 * ---------------
 * Una parada donde el juego ofrece unas pocas opciones y el jugador se queda
 * con UNA. No es una tienda (no se paga) ni un interludio (no hay trato: no se
 * puede declinar). Es el dial con el que la run se aparta del juego base:
 *
 *   - BENDICION: al arrancar la partida, 3 ofertas, todas para bien.
 *   - MALDICION: cada 3 antes, 2 ofertas, todas para mal. El jugador elige
 *     COMO le va a doler, no si le duele.
 *
 * La maldicion obligatoria es a proposito: sin ella, "elegir entre dos
 * desventajas" se resolveria siempre con la mas floja y el ante 6 no cambiaria
 * nada. Con la eleccion forzada, lo interesante pasa a ser cual duele MENOS
 * contra el mazo que uno tiene (una suba de objetivo no raspa a quien punta
 * alto; un reroll mas caro no existe para quien no rerollea).
 *
 * REGLA DE ORO: una bendicion o maldicion NO tiene efectos inmediatos. Solo
 * cambia como se CALCULA la run, y lo hace por la misma via que un voucher:
 * `modifiers` es un subconjunto de `VoucherRunModifiers` y entra al agregado
 * (`GameEngine.modifiers`) por el mismo `combineModifiers`. Asi no hay una
 * segunda version de las reglas: "objetivo -10%" significa lo mismo venga de
 * un voucher comprado o de una bendicion sorteada.
 *
 * PURO: este modulo no conoce DOM, ni Three.js, ni el ContentRegistry. Recibe
 * datos planos y devuelve datos planos. Quien los APLICA es `GameEngine`.
 */

import type { VoucherRunModifiers } from '../types';
import type { RNG } from '../rng';

/** Los dos diales del borrador. */
export type DraftKind = 'blessing' | 'curse';

/** Cuantas bendiciones se ofrecen al arrancar la run. */
export const BLESSING_OFFERS = 3;
/** Cuantas maldiciones se ofrecen en cada parada. */
export const CURSE_OFFERS = 2;
/** Cada cuantos antes toca una maldicion (ante 3, 6, 9...). */
export const CURSE_EVERY_ANTES = 3;

/**
 * Campos de `VoucherRunModifiers` que un draft puede declarar.
 *
 * La lista existe para poder SANEAR el JSON: un campo mal escrito se descarta
 * en vez de viajar hasta el motor y hacer nada en silencio.
 */
const MODIFIER_KEYS: readonly (keyof VoucherRunModifiers)[] = [
  'rerollCostDelta',
  'targetMultiplier',
  'shopDiscount',
  'extraJokerSlots',
  'extraHands',
  'extraDiscards',
  'extraHandSize',
  'extraMoney',
];

export interface DraftDefinition {
  id: string;
  nameKey: string;
  descKey: string;
  kind: DraftKind;
  /** Peso relativo en el sorteo. Default 1. */
  weight?: number;
  /** Ante minimo para que la opcion pueda salir. Default 1. */
  minAnte?: number;
  /** Subconjunto de `VoucherRunModifiers`. Ver la cabecera del modulo. */
  modifiers?: VoucherRunModifiers;
}

/**
 * Campos que se aplican UNA VEZ al elegir, en vez de leerse del agregado.
 *
 * Son los que tocan un STOCK o un VALOR FIJO de la run (dinero, manos por
 * ciego, descartes, tamano de mano, slots). Se escriben directamente sobre el
 * estado —igual que la ascension hace al crear la run— y por tanto viajan
 * serializados con ella. El resto (`targetMultiplier`, `rerollCostDelta`,
 * `shopDiscount`) son tasas: se leen del agregado en cada consulta, porque
 * tienen que reflejar el TOTAL de vouchers + drafts.
 *
 * La distincion no es cosmetica: si `extraHands` se leyera del agregado Y se
 * aplicara al elegir, una mano extra contaria dos veces.
 */
export const BAKED_MODIFIER_KEYS: readonly (keyof VoucherRunModifiers)[] = [
  'extraJokerSlots',
  'extraHands',
  'extraDiscards',
  'extraHandSize',
  'extraMoney',
];

/** Campos que se leen del agregado en cada consulta (lo que NO se aplica ya). */
export const LIVE_MODIFIER_KEYS: readonly (keyof VoucherRunModifiers)[] = [
  'rerollCostDelta',
  'targetMultiplier',
  'shopDiscount',
];

/**
 * Parsea y valida el JSON de drafts. Cualquier entrada mala se DESCARTA en
 * silencio (no tumba el arranque), igual que `parseInterludes`: contenido roto
 * no puede impedir jugar. Lo que si se conserva es una entrada con
 * `modifiers` vacio: la reporta `ContentRegistry.validate`, que es donde el
 * autor del pack se entera.
 */
export function parseDrafts(raw: unknown, kind: DraftKind): DraftDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftDefinition[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const doc = entry as Record<string, unknown>;
    if (typeof doc.id !== 'string' || doc.id.length === 0) continue;
    if (seen.has(doc.id)) continue;
    if (typeof doc.nameKey !== 'string' || typeof doc.descKey !== 'string') continue;

    seen.add(doc.id);
    out.push({
      id: doc.id,
      nameKey: doc.nameKey,
      descKey: doc.descKey,
      kind,
      ...(typeof doc.weight === 'number' && doc.weight > 0 ? { weight: doc.weight } : {}),
      ...(typeof doc.minAnte === 'number' && doc.minAnte >= 1
        ? { minAnte: Math.floor(doc.minAnte) }
        : {}),
      ...(doc.modifiers && typeof doc.modifiers === 'object'
        ? { modifiers: sanitizeModifiers(doc.modifiers as Record<string, unknown>) }
        : {}),
    });
  }
  return out;
}

/** Se queda solo con los campos conocidos y numericos. El resto, afuera. */
function sanitizeModifiers(raw: Record<string, unknown>): VoucherRunModifiers {
  const out: VoucherRunModifiers = {};
  for (const key of MODIFIER_KEYS) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    // `targetMultiplier` es un multiplicador: 0 o negativo volveria el objetivo
    // imposible o gratis. `combineModifiers` lo clampea, pero un 0 en el JSON
    // es un error de autor, no una decision de balance.
    if (key === 'targetMultiplier' && value <= 0) continue;
    (out as Record<string, number>)[key] = value;
  }
  return out;
}

/** Un draft sin ningun modificador no hace nada: es contenido muerto. */
export function hasModifiers(def: DraftDefinition): boolean {
  const mods = def.modifiers;
  if (!mods) return false;
  return MODIFIER_KEYS.some((key) => typeof mods[key] === 'number' && mods[key] !== 0);
}

/**
 * Filtra las definiciones elegibles para un ante dado y que el jugador TODAVIA
 * no tiene. Un draft sin `minAnte` sale desde el ante 1.
 */
export function eligibleDrafts(
  defs: readonly DraftDefinition[],
  ante: number,
  owned: readonly string[] = [],
): DraftDefinition[] {
  const taken = new Set(owned);
  return defs.filter((def) => {
    if (taken.has(def.id)) return false;
    if (def.minAnte !== undefined && ante < def.minAnte) return false;
    return true;
  });
}

/**
 * Sorteo ponderado SIN repeticion. Devuelve hasta `count` ofertas (menos si el
 * pool no llega), en el orden en que salieron.
 *
 * `rng` tiene que ser un RNG SEMBRADO y, en el motor, DEDICADO: el borrador
 * no puede consumir el RNG de la run, o sortear una bendicion desplazaria la
 * tienda y las misiones de TODAS las partidas (ver `GameEngine.rollBlessingDraft`).
 */
export function pickDraftOffers(
  defs: readonly DraftDefinition[],
  ante: number,
  owned: readonly string[],
  count: number,
  rng: RNG,
): DraftDefinition[] {
  const pool = eligibleDrafts(defs, ante, owned);
  if (pool.length === 0 || count <= 0) return [];

  const remaining = [...pool];
  const out: DraftDefinition[] = [];
  const wanted = Math.min(count, remaining.length);

  for (let i = 0; i < wanted; i++) {
    let total = 0;
    for (const def of remaining) total += Math.max(0, def.weight ?? 1);
    let cursor = rng.next() * total;
    // El ultimo es el valor por defecto: si los pesos son todos 0 el cursor
    // nunca baja de 0 y hay que quedarse con algo.
    let index = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      cursor -= Math.max(0, remaining[j]?.weight ?? 1);
      if (cursor < 0) {
        index = j;
        break;
      }
    }
    const picked = remaining[index];
    if (!picked) break;
    out.push(picked);
    remaining.splice(index, 1);
  }

  return out;
}

/** Una linea de efecto de un draft, ya resuelta a clave i18n + parametros. */
export interface DraftModifierLine {
  key: string;
  params: Record<string, number>;
}

/**
 * Convierte los `modifiers` de un draft en las lineas que se le muestran al
 * jugador. Devuelve CLAVES, no texto: traduce la UI con `t(line.key, line.params)`.
 *
 * Por que aca y no en el HUD: el motor no depende de i18next (queda puro), y un
 * test puede verificar que TODAS las claves que puede producir esta funcion
 * existen en los dos diccionarios — `scanI18n` no las ve porque no son literales
 * en el codigo. El orden es fijo (primero lo que cambia la ronda, despues el
 * dinero, al final las tasas) para que dos ofertas similares se lean igual.
 */
export function draftModifierLines(mods: VoucherRunModifiers | undefined): DraftModifierLine[] {
  if (!mods) return [];
  const out: DraftModifierLine[] = [];
  const push = (key: string, params: Record<string, number> = {}) => out.push({ key, params });

  const hands = mods.extraHands;
  if (typeof hands === 'number' && hands !== 0) {
    push(hands > 0 ? 'draft.lineHandsPlus' : 'draft.lineHandsLess', { n: hands });
  }

  const discards = mods.extraDiscards;
  if (typeof discards === 'number' && discards !== 0) {
    push(discards > 0 ? 'draft.lineDiscardsPlus' : 'draft.lineDiscardsLess', { n: discards });
  }

  const handSize = mods.extraHandSize;
  if (typeof handSize === 'number' && handSize !== 0) {
    push(handSize > 0 ? 'draft.lineHandSizePlus' : 'draft.lineHandSizeLess', { n: handSize });
  }

  const slots = mods.extraJokerSlots;
  if (typeof slots === 'number' && slots !== 0) {
    push(slots > 0 ? 'draft.lineJokerSlotsPlus' : 'draft.lineJokerSlotsLess', { n: slots });
  }

  const money = mods.extraMoney;
  if (typeof money === 'number' && money !== 0) {
    push(money > 0 ? 'draft.lineMoneyPlus' : 'draft.lineMoneyLess', { n: money });
  }

  const target = mods.targetMultiplier;
  if (typeof target === 'number' && target !== 1) {
    const pct = Math.round(Math.abs(1 - target) * 100);
    push(target > 1 ? 'draft.lineTargetUp' : 'draft.lineTargetDown', { pct });
  }

  const reroll = mods.rerollCostDelta;
  if (typeof reroll === 'number' && reroll !== 0) {
    push(reroll < 0 ? 'draft.lineRerollCheaper' : 'draft.lineRerollPricier', {
      n: Math.abs(reroll),
    });
  }

  const discount = mods.shopDiscount;
  if (typeof discount === 'number' && discount !== 0) {
    push('draft.lineShopDiscount', { pct: Math.round(Math.abs(discount) * 100) });
  }

  return out;
}
