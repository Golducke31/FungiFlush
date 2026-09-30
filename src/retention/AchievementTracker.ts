/**
 * AchievementTracker.ts — Logros permanentes del perfil.
 *
 * Es un OBSERVADOR del bus, no parte del motor: se suscribe a eventos de
 * gameplay y traduce "paso algo" a "este logro se cumplio". El motor no sabe
 * que existe (regla de oro: engine puro).
 *
 * Tampoco conoce el DOM ni el reloj: el contexto (ante, jokers, ...) lo pide
 * por callback, asi que el mismo modulo se testea con un contexto inventado.
 *
 * Los predicados vienen del JSON como un mini-lenguaje (`{op, path, value}`) en
 * vez de codigo evaluado: `eval` sobre datos de contenido seria la puerta mas
 * ancha que le podemos abrir a un pack.
 */

import type { GameEventMap, GameEventName, Emitter } from '../engine/events';
import type { ProfileSave } from '../meta/ProfileState';
import { applyReward } from './rewards';
import type { RetentionReward } from './types';

export type AchievementPredicate =
  | { op: 'always' }
  | { op: 'gte'; path: string; value: number }
  | { op: 'lte'; path: string; value: number }
  | { op: 'eq'; path: string; value: number | string };

export interface AchievementDef {
  id: string;
  nameKey: string;
  descKey: string;
  /** Evento del bus que lo evalua. */
  event: string;
  /** Condicion. Se ignora si el logro es `incremental`. */
  when?: AchievementPredicate;
  /** Logro acumulativo: suma en CADA evento hasta llegar a `max`. */
  incremental?: { max: number; inc?: number };
  reward?: RetentionReward;
}

/** Contexto de partida que el controlador expone para los predicados. */
export type AchievementContext = Record<string, number | string | boolean>;

/**
 * Lo minimo que el tracker necesita del perfil. `ProfileStore` lo cumple por
 * forma, y un test puede pasar un doble sin tocar el almacenamiento real.
 */
export interface ProfileHandle {
  current: ProfileSave;
  patch(mutate: (profile: ProfileSave) => void): void;
}

export interface AchievementTrackerOptions {
  bus: Emitter<GameEventMap>;
  defs: AchievementDef[];
  profile: ProfileHandle;
  /** Snapshot de la partida en curso (ante, jokers, dinero...). */
  getContext: () => AchievementContext;
}

type Root = { payload: unknown; ctx: AchievementContext; profile: ProfileSave };

function readPath(root: Root, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function evaluate(predicate: AchievementPredicate, root: Root): boolean {
  switch (predicate.op) {
    case 'always':
      return true;
    case 'gte':
      return Number(readPath(root, predicate.path)) >= predicate.value;
    case 'lte':
      return Number(readPath(root, predicate.path)) <= predicate.value;
    case 'eq':
      return readPath(root, predicate.path) === predicate.value;
  }
}

export class AchievementTracker {
  private readonly bus: Emitter<GameEventMap>;
  private readonly defs: AchievementDef[];
  private readonly profile: ProfileHandle;
  private readonly getContext: () => AchievementContext;
  private readonly unsubscribes: Array<() => void> = [];
  /** Cache de lo ya desbloqueado: evita leer el perfil en cada evento. */
  private readonly unlocked = new Set<string>();

  constructor(options: AchievementTrackerOptions) {
    this.bus = options.bus;
    this.defs = options.defs;
    this.profile = options.profile;
    this.getContext = options.getContext;
    for (const id of this.profile.current.achievements.unlockedIds) this.unlocked.add(id);
  }

  /** Empieza a escuchar. Devuelve la funcion para parar (util en tests). */
  start(): () => void {
    // Se agrupa por evento: un logro se suscribe UNA vez, no uno por definicion.
    const byEvent = new Map<string, AchievementDef[]>();
    for (const def of this.defs) {
      if (this.unlocked.has(def.id)) continue;
      const list = byEvent.get(def.event) ?? [];
      list.push(def);
      byEvent.set(def.event, list);
    }

    for (const [event, list] of byEvent) {
      // El evento viene del JSON: se valida contra el mapa tipado con un cast
      // acotado. Si un id esta mal escrito, simplemente nadie lo emite.
      this.unsubscribes.push(
        this.bus.on(event as GameEventName, (payload) => {
          this.handle(list, payload);
        }),
      );
    }

    return () => this.stop();
  }

  stop(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  /** Progreso actual de un logro (0 si no es incremental). */
  progressOf(id: string): number {
    return this.profile.current.achievements.progress[id] ?? 0;
  }

  private handle(defs: AchievementDef[], payload: unknown): void {
    const root: Root = { payload, ctx: this.getContext(), profile: this.profile.current };

    for (const def of defs) {
      if (this.unlocked.has(def.id)) continue;

      if (def.incremental) {
        const max = Math.max(1, def.incremental.max);
        const step = def.incremental.inc ?? 1;
        const next = Math.min(max, this.progressOf(def.id) + step);
        this.profile.patch((p) => {
          p.achievements.progress[def.id] = next;
        });
        if (next >= max) this.unlock(def);
        continue;
      }

      if (def.when && evaluate(def.when, root)) this.unlock(def);
    }
  }

  private unlock(def: AchievementDef): void {
    this.unlocked.add(def.id);
    this.profile.patch((p) => {
      if (!p.achievements.unlockedIds.includes(def.id)) p.achievements.unlockedIds.push(def.id);
      if (def.incremental) p.achievements.progress[def.id] = Math.max(1, def.incremental.max);
      if (def.reward) applyReward(p, def.reward, 'achievement');
    });
    this.bus.emit('achievement:unlocked', {
      id: def.id,
      nameKey: def.nameKey,
      ...(def.reward ? { reward: def.reward } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Parseo de las definiciones
// ---------------------------------------------------------------------------

const OPS = new Set(['always', 'gte', 'lte', 'eq']);
const VALID_EVENTS = new Set<string>([
  'run:start',
  'blind:selected',
  'round:start',
  'round:win',
  'round:loss',
  'game:over',
  'hand:dealt',
  'card:drawn',
  'card:selected',
  'card:played',
  'card:discarded',
  'card:destroyed',
  'card:created',
  'score:step',
  'score:hand',
  'score:changed',
  'joker:added',
  'joker:sold',
  'joker:triggered',
  'money:changed',
  'reward:pick',
  'shop:purchase',
  'shop:reroll',
  'deck:purged',
  'card:levelup',
  'card:evolved',
]);

function parsePredicate(raw: unknown): AchievementPredicate | null {
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
  return { op, path, value } as AchievementPredicate;
}

/**
 * Lee `src/data/achievements.json`. Una definicion invalida se descarta: un
 * logro roto no puede tumbar el arranque ni bloquear a los demas.
 */
export function parseAchievements(raw: unknown): AchievementDef[] {
  if (!Array.isArray(raw)) return [];
  const out: AchievementDef[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = entry['id'];
    const nameKey = entry['nameKey'];
    const descKey = entry['descKey'];
    const event = entry['event'];
    if (typeof id !== 'string' || typeof nameKey !== 'string' || typeof descKey !== 'string') continue;
    if (typeof event !== 'string' || !VALID_EVENTS.has(event)) continue;

    const def: AchievementDef = { id, nameKey, descKey, event };

    const incremental = entry['incremental'];
    if (typeof incremental === 'object' && incremental !== null) {
      const max = (incremental as Record<string, unknown>)['max'];
      if (typeof max === 'number' && max > 0) {
        const inc = (incremental as Record<string, unknown>)['inc'];
        def.incremental =
          typeof inc === 'number' && inc > 0 ? { max, inc } : { max };
      }
    }

    if (!def.incremental) {
      const when = parsePredicate(entry['when']);
      if (!when) continue; // sin condicion ni incremental, el logro no dice nada
      def.when = when;
    }

    const reward = entry['reward'] ? parseRewardRef(entry['reward']) : null;
    if (reward) def.reward = reward;

    out.push(def);
  }
  return out;
}

function parseRewardRef(raw: unknown): RetentionReward | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const type = entry['type'];
  const id = entry['id'];
  if (typeof type !== 'string' || typeof id !== 'string') return null;
  if (!['card', 'joker', 'cosmetic', 'cardBack', 'felt'].includes(type)) return null;
  return { type, id } as RetentionReward;
}
