/**
 * interlude.ts — Eventos entre Ciegos (P2.4) y decisiones de riesgo/recompensa
 * (P2.3).
 *
 * QUE ES UN INTERLUDIO
 * --------------------
 * Es una parada breve ENTRE dos ciegos donde el jugador elige entre aceptar un
 * trato (con una ventaja y un coste) o seguir de largo. Existe para que la run
 * no sea una sucesion de "elegir ciego -> jugar -> tienda -> repetir": el plan
 * pide decisiones de riesgo/recompensa, y sin una parada intermedia no hay
 * momento donde tomarlas.
 *
 * REGLA DE ORO: nada se aplica solo. Cada opcion declara sus `effects` y el
 * motor los aplica cuando el jugador confirma. La `decline` no tiene efectos:
 * es la linea base contra la que se mide el riesgo.
 *
 * PURO: este modulo no conoce DOM, ni Three.js, ni el ContentRegistry. Recibe
 * datos planos y devuelve datos planos. Quien aplica los efectos es
 * `GameEngine.applyInterludeEffects`.
 */

/** Efecto concreto de una opcion de interludio. */
export type InterludeEffect =
  /** Suma (o resta, si es negativa) dinero. */
  | { type: 'MONEY'; value: number }
  /** Multiplica el objetivo de los ciegos que vienen. Acumulativo entre interludios. */
  | { type: 'TARGET_MULTIPLIER'; value: number }
  /** Suma slots de joker. */
  | { type: 'JOKER_SLOT'; value: number }
  /** Suma manos disponibles por ciego. */
  | { type: 'HANDS_DELTA'; value: number }
  /** Suma cartas al tamano de mano. */
  | { type: 'HAND_SIZE'; value: number }
  /** Agrega cartas nuevas al mazo, sorteando por rareza. */
  | { type: 'CARD'; rarity?: string; count?: number }
  /** Purga cartas al azar (destruccion explicita PERO aleatoria). */
  | { type: 'PURGE_RANDOM'; count?: number }
  /** Mejora cartas al azar. */
  | { type: 'UPGRADE_RANDOM'; count?: number };

export interface InterludeChoice {
  id: string;
  labelKey: string;
  detailKey: string;
  effects?: InterludeEffect[];
}

export interface InterludeDefinition {
  id: string;
  nameKey: string;
  descKey: string;
  /** Clave de arte del pool de ciegos (reutiliza esas ilustraciones). */
  art?: string;
  /** Ante minimo para que el evento pueda salir. */
  minAnte?: number;
  /** Ante maximo (exclusivo). */
  maxAnte?: number;
  /** Peso relativo en el sorteo. Default 1. */
  weight?: number;
  choices: InterludeChoice[];
}

/** Efecto de run persistente (sobrevive al interludio y se resetea por run). */
export interface InterludeModifiers {
  /** Multiplicador de objetivo acumulado por interludios [0.5, 2]. */
  targetMultiplier: number;
}

export const DEFAULT_INTERLUDE_MODIFIERS: InterludeModifiers = {
  targetMultiplier: 1,
};

/** Cuantos efectos de tipo `CARD` puede meter como maximo una opcion. */
export const MAX_INTERLUDE_CARDS = 3;
/** Cuantos efectos de tipo `PURGE_RANDOM` puede meter como maximo una opcion. */
export const MAX_INTERLUDE_PURGES = 3;
/** Tope del multiplicador acumulado de objetivo entre interludios. */
export const INTERLUDE_TARGET_MIN = 0.5;
export const INTERLUDE_TARGET_MAX = 2;

/**
 * Filtra las definiciones elegibles para un ante dado. Un interludio sin
 * `minAnte` sale desde el ante 1; sin `maxAnte` sale hasta el final.
 */
export function eligibleInterludes(
  defs: readonly InterludeDefinition[],
  ante: number,
): InterludeDefinition[] {
  return defs.filter((def) => {
    if (def.minAnte !== undefined && ante < def.minAnte) return false;
    if (def.maxAnte !== undefined && ante >= def.maxAnte) return false;
    return def.choices.length > 1;
  });
}

/**
 * Sorteo ponderado determinista. Devuelve `null` si no hay candidatos.
 *
 * `roll` es un numero en [0,1) que viene del RNG SEMBRADO del motor: el sorteo
 * tiene que ser reproducible, o dos partidas con la misma semilla dejan de ser
 * iguales.
 */
export function pickInterlude(
  defs: readonly InterludeDefinition[],
  ante: number,
  roll: number,
): InterludeDefinition | null {
  const pool = eligibleInterludes(defs, ante);
  if (pool.length === 0) return null;

  const total = pool.reduce((sum, def) => sum + (def.weight ?? 1), 0);
  if (total <= 0) return pool[0] ?? null;

  let cursor = roll * total;
  for (const def of pool) {
    cursor -= def.weight ?? 1;
    if (cursor < 0) return def;
  }
  return pool[pool.length - 1] ?? null;
}

/**
 * Parsea y valida el JSON de interludios. Cualquier entrada mala se DESCARTA
 * en silencio (no tumba el arranque), igual que en SeasonTracker: contenido
 * roto no puede impedir jugar.
 */
export function parseInterludes(raw: unknown): InterludeDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: InterludeDefinition[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const doc = entry as Record<string, unknown>;
    if (typeof doc.id !== 'string' || doc.id.length === 0) continue;
    if (seen.has(doc.id)) continue;
    if (typeof doc.nameKey !== 'string' || typeof doc.descKey !== 'string') continue;
    if (!Array.isArray(doc.choices) || doc.choices.length < 2) continue;

    const choices: InterludeChoice[] = [];
    for (const rawChoice of doc.choices) {
      if (!rawChoice || typeof rawChoice !== 'object') continue;
      const c = rawChoice as Record<string, unknown>;
      if (typeof c.id !== 'string' || typeof c.labelKey !== 'string') continue;
      if (typeof c.detailKey !== 'string') continue;
      const effects = Array.isArray(c.effects) ? parseEffects(c.effects) : [];
      choices.push({ id: c.id, labelKey: c.labelKey, detailKey: c.detailKey, effects });
    }
    if (choices.length < 2) continue;
    // La opcion de declinar tiene que existir: sin salida, un interludio es un
    // castigo disfrazado de decision.
    if (!choices.some((c) => !c.effects || c.effects.length === 0)) continue;

    seen.add(doc.id);
    out.push({
      id: doc.id,
      nameKey: doc.nameKey,
      descKey: doc.descKey,
      ...(typeof doc.art === 'string' ? { art: doc.art } : {}),
      ...(typeof doc.minAnte === 'number' ? { minAnte: doc.minAnte } : {}),
      ...(typeof doc.maxAnte === 'number' ? { maxAnte: doc.maxAnte } : {}),
      ...(typeof doc.weight === 'number' ? { weight: doc.weight } : {}),
      choices,
    });
  }
  return out;
}

function parseEffects(raw: unknown[]): InterludeEffect[] {
  const out: InterludeEffect[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.type !== 'string') continue;
    const value = typeof e.value === 'number' ? e.value : undefined;
    const count = typeof e.count === 'number' ? e.count : undefined;
    const rarity = typeof e.rarity === 'string' ? e.rarity : undefined;

    switch (e.type) {
      case 'MONEY':
        if (value !== undefined) out.push({ type: 'MONEY', value });
        break;
      case 'TARGET_MULTIPLIER':
        if (value !== undefined && value > 0) out.push({ type: 'TARGET_MULTIPLIER', value });
        break;
      case 'JOKER_SLOT':
        if (value !== undefined) out.push({ type: 'JOKER_SLOT', value });
        break;
      case 'HANDS_DELTA':
        if (value !== undefined) out.push({ type: 'HANDS_DELTA', value });
        break;
      case 'HAND_SIZE':
        if (value !== undefined) out.push({ type: 'HAND_SIZE', value });
        break;
      case 'CARD':
        out.push({
          type: 'CARD',
          count: clampInt(count ?? 1, 1, MAX_INTERLUDE_CARDS),
          ...(rarity ? { rarity } : {}),
        });
        break;
      case 'PURGE_RANDOM':
        out.push({ type: 'PURGE_RANDOM', count: clampInt(count ?? 1, 1, MAX_INTERLUDE_PURGES) });
        break;
      case 'UPGRADE_RANDOM':
        out.push({ type: 'UPGRADE_RANDOM', count: clampInt(count ?? 1, 1, MAX_INTERLUDE_CARDS) });
        break;
      default:
        break;
    }
  }
  return out;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(value)));
}

/**
 * Compone los modificadores de interludio sobre los ya existentes.
 * `TARGET_MULTIPLIER` se MULTIPLICA (1.15 seguido de 0.85 vuelve a ~0.98, no a
 * 1.0 por suma) y se clampea para que una cadena de eventos no vuelva el juego
 * imposible ni trivial.
 */
export function applyInterludeModifiers(
  current: InterludeModifiers,
  effects: readonly InterludeEffect[],
): InterludeModifiers {
  let targetMultiplier = current.targetMultiplier;
  for (const effect of effects) {
    if (effect.type === 'TARGET_MULTIPLIER') targetMultiplier *= effect.value;
  }
  targetMultiplier = Math.min(
    INTERLUDE_TARGET_MAX,
    Math.max(INTERLUDE_TARGET_MIN, targetMultiplier),
  );
  return { targetMultiplier };
}

/** Efectos que tocan el estado de la run (no los modificadores acumulados). */
export function immediateInterludeEffects(
  effects: readonly InterludeEffect[],
): InterludeEffect[] {
  return effects.filter((e) => e.type !== 'TARGET_MULTIPLIER');
}
