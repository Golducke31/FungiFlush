/**
 * missions.ts — Misiones de run (P2.6).
 *
 * Una mision es un OBJETIVO CORTO dentro de la run ("juga una mano de 500",
 * "compra 3 cosas en la tienda") que paga dinero al cumplirse. El plan pide
 * "misiones de run y objetivos a largo plazo": sin un objetivo intermedio, la
 * unica meta visible es el ante final, que esta a 40 minutos de distancia.
 *
 * DIFERENCIA CON LOS LOGROS
 * -------------------------
 * Un logro (`src/retention/AchievementTracker.ts`) es PERMANENTE del perfil y
 * su recompensa entra a la coleccion. Una mision es EFIMERA: vive en la run
 * activa, paga dinero en el momento y desaparece al terminar. Comparten el
 * mini-lenguaje de predicados, pero el ciclo de vida es distinto.
 *
 * PURO: no conoce DOM, ni Three.js, ni el bus. Recibe eventos ya extraidos y
 * devuelve que misiones avanzaron. Quien las aplica es `GameEngine` o el
 * controlador de la run.
 */

export type MissionPredicate =
  | { op: 'always' }
  | { op: 'gte'; path: string; value: number }
  | { op: 'lte'; path: string; value: number }
  | { op: 'eq'; path: string; value: number | string };

export interface MissionDef {
  id: string;
  nameKey: string;
  descKey: string;
  /** Evento del bus que la evalua. */
  event: string;
  /** Condicion. Se ignora si es `incremental`. */
  when?: MissionPredicate;
  /** Mision acumulativa: suma en CADA evento hasta llegar a `max`. */
  incremental?: { max: number; inc?: number };
  /** Dinero que paga al completarse. */
  reward: number;
  /** Ante minimo en el que puede salir. */
  minAnte?: number;
}

/** Estado de UNA mision dentro de la run. */
export interface MissionState {
  id: string;
  /** Progreso para las incrementales; 0 para las de condicion unica. */
  progress: number;
  completed: boolean;
}

export interface MissionWorld {
  payload: unknown;
  ctx: Record<string, number | string | boolean>;
}

const OPS = new Set(['always', 'gte', 'lte', 'eq']);

function readPath(root: MissionWorld, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function evaluate(predicate: MissionPredicate, world: MissionWorld): boolean {
  switch (predicate.op) {
    case 'always':
      return true;
    case 'gte':
      return Number(readPath(world, predicate.path)) >= predicate.value;
    case 'lte':
      return Number(readPath(world, predicate.path)) <= predicate.value;
    case 'eq':
      return readPath(world, predicate.path) === predicate.value;
  }
}

/**
 * Elige `count` misiones para un ante, sin repetir las ya activas ni las
 * completadas. Devuelve menos si no hay suficientes candidatas.
 *
 * `roll` es una funcion que devuelve [0,1): el RNG sembrado del motor. El
 * sorteo tiene que ser reproducible.
 */
export function pickMissions(
  defs: readonly MissionDef[],
  ante: number,
  exclude: readonly string[],
  count: number,
  roll: () => number,
): MissionDef[] {
  const taken = new Set(exclude);
  const pool = defs.filter((def) => {
    if (taken.has(def.id)) return false;
    if (def.minAnte !== undefined && ante < def.minAnte) return false;
    return true;
  });
  // Fisher-Yates parcial: se detiene cuando ya hay `count`. Usa el RNG inyectado
  // para que el orden no dependa del motor de JavaScript.
  const out: MissionDef[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(roll() * pool.length);
    const [picked] = pool.splice(Math.min(idx, pool.length - 1), 1);
    if (picked) out.push(picked);
  }
  return out;
}

/**
 * Aplica un evento a las misiones activas y devuelve las que se COMPLETARON
 * en esta llamada. No muta la entrada: crea estados nuevos (el motor decide
 * donde guardarlos).
 */
export function advanceMissions(
  states: readonly MissionState[],
  defs: readonly MissionDef[],
  event: string,
  world: MissionWorld,
): { next: MissionState[]; completed: MissionDef[] } {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const next: MissionState[] = [];
  const completed: MissionDef[] = [];

  for (const state of states) {
    const def = byId.get(state.id);
    if (!def || state.completed || def.event !== event) {
      next.push(state);
      continue;
    }

    if (def.incremental) {
      const max = Math.max(1, def.incremental.max);
      const step = def.incremental.inc ?? 1;
      const progress = Math.min(max, state.progress + step);
      const done = progress >= max;
      next.push({ id: state.id, progress, completed: done });
      if (done) completed.push(def);
      continue;
    }

    if (def.when && evaluate(def.when, world)) {
      next.push({ id: state.id, progress: 1, completed: true });
      completed.push(def);
    } else {
      next.push(state);
    }
  }

  return { next, completed };
}

/** Eventos del bus que una mision puede escuchar. */
export const MISSION_EVENTS: readonly string[] = [
  'run:start',
  'round:start',
  'round:win',
  'round:loss',
  'card:played',
  'card:discarded',
  'card:destroyed',
  'card:created',
  'card:levelup',
  'card:evolved',
  'score:hand',
  'joker:added',
  'money:changed',
  'shop:purchase',
  'shop:reroll',
  'deck:purged',
  'reward:pick',
];

function parsePredicate(raw: unknown): MissionPredicate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const op = entry['op'];
  if (typeof op !== 'string' || !OPS.has(op)) return null;
  if (op === 'always') return { op: 'always' };
  const path = entry['path'];
  const value = entry['value'];
  if (typeof path !== 'string') return null;
  if (op === 'eq') {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    return { op: 'eq', path, value };
  }
  if (typeof value !== 'number') return null;
  return { op, path, value } as MissionPredicate;
}

/**
 * Lee `src/data/missions.json`. Una definicion invalida se descarta: una mision
 * rota no puede tumbar el arranque ni bloquear a las demas.
 */
export function parseMissions(raw: unknown): MissionDef[] {
  if (!Array.isArray(raw)) return [];
  const out: MissionDef[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = entry['id'];
    const nameKey = entry['nameKey'];
    const descKey = entry['descKey'];
    const event = entry['event'];
    const reward = entry['reward'];
    if (typeof id !== 'string' || seen.has(id)) continue;
    if (typeof nameKey !== 'string' || typeof descKey !== 'string') continue;
    if (typeof event !== 'string' || !MISSION_EVENTS.includes(event)) continue;
    if (typeof reward !== 'number' || reward <= 0) continue;

    const def: MissionDef = { id, nameKey, descKey, event, reward };

    const incremental = entry['incremental'];
    if (typeof incremental === 'object' && incremental !== null) {
      const max = (incremental as Record<string, unknown>)['max'];
      if (typeof max === 'number' && max > 0) {
        const inc = (incremental as Record<string, unknown>)['inc'];
        def.incremental = typeof inc === 'number' && inc > 0 ? { max, inc } : { max };
      }
    }

    if (!def.incremental) {
      const when = parsePredicate(entry['when']);
      if (!when) continue; // sin condicion ni incremental, la mision no dice nada
      def.when = when;
    }

    const minAnte = entry['minAnte'];
    if (typeof minAnte === 'number' && minAnte > 0) def.minAnte = minAnte;

    seen.add(id);
    out.push(def);
  }
  return out;
}

/** Cuantas misiones activas hay como maximo en una run. */
export const MAX_ACTIVE_MISSIONS = 2;
