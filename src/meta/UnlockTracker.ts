/**
 * UnlockTracker.ts — Desbloqueo de contenido por JUGAR.
 *
 * POR QUE NO ES UN LOGRO
 * ----------------------
 * `AchievementTracker` y este modulo se parecen mucho y hacen cosas distintas:
 *
 *   - Un logro es una MEDALLA. Se puede perder de vista sin que nada se rompa:
 *     es la Coleccion diciendo "mirá lo que hiciste".
 *   - Un desbloqueo es una PUERTA. Hasta que no se abre, ese contenido NO
 *     EXISTE en los sorteos. Si el tracker falla, el jugador juega un juego
 *     mas chico y nunca se entera.
 *
 * Por eso la condicion se sella en el PERFIL (`pendingUnlocks`) y la lee el
 * `PackGate`: la Coleccion tiene que poder explicar CUAL ES la puerta, no solo
 * mostrar un candado. Un logro no necesita eso.
 *
 * POR QUE EL JSON NO PUEDE EVALUAR CODIGO
 * ---------------------------------------
 * Mismo mini-lenguaje de predicados que los logros (`{op, path, value}`), por
 * la misma razon: `eval` sobre contenido de un pack es la puerta mas ancha que
 * se le puede abrir a un tercero. El contenido describe, el motor decide.
 *
 * EL TRACKER NO TOCA EL MOTOR
 * ---------------------------
 * Es un observador del bus, como todo lo de retencion. El motor no sabe que
 * existe el concepto de "desbloqueo": recive filtros ya resueltos del
 * `PackGate`.
 */

import type { GameEventMap, GameEventName, Emitter } from '../engine/events';
import type { ProfileSave } from '../meta/ProfileState';
import { applyReward } from '../retention/rewards';
import type { RetentionReward } from '../retention/types';

export type UnlockPredicate =
  | { op: 'always' }
  | { op: 'gte'; path: string; value: number }
  | { op: 'lte'; path: string; value: number }
  | { op: 'eq'; path: string; value: number | string };

/** Que tipo de contenido abre la regla. Debe coincidir con `RetentionReward`. */
export type UnlockKind = 'card' | 'joker';

export interface UnlockDef {
  id: string;
  /** Id del contenido que se abre (`oyster_cluster`, `joker_first_spore`...). */
  contentId: string;
  kind: UnlockKind;
  nameKey: string;
  descKey: string;
  /** Evento del bus que la evalua. */
  event: string;
  when: UnlockPredicate;
}

/** Contexto de partida que el controlador expone para los predicados. */
export type UnlockContext = Record<string, number | string | boolean>;

export interface UnlockTrackerOptions {
  bus: Emitter<GameEventMap>;
  defs: UnlockDef[];
  profile: { current: ProfileSave; patch(mutate: (profile: ProfileSave) => void): void };
  /** Snapshot de la partida en curso (ante, jokers, dinero...). */
  getContext: () => UnlockContext;
}

type Root = { payload: unknown; ctx: UnlockContext; profile: ProfileSave };

function readPath(root: Root, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function evaluate(predicate: UnlockPredicate, root: Root): boolean {
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

export class UnlockTracker {
  private readonly bus: Emitter<GameEventMap>;
  private readonly defs: UnlockDef[];
  private readonly profile: UnlockTrackerOptions['profile'];
  private readonly getContext: () => UnlockContext;
  private readonly unsubscribes: Array<() => void> = [];
  /** Cache de lo ya abierto: evita leer el perfil en cada evento. */
  private readonly unlocked = new Set<string>();

  constructor(options: UnlockTrackerOptions) {
    this.bus = options.bus;
    this.defs = options.defs;
    this.profile = options.profile;
    this.getContext = options.getContext;
    for (const def of this.defs) {
      if (this.isUnlocked(def)) this.unlocked.add(def.id);
    }
  }

  /**
   * Publica las condiciones en el perfil para que la Coleccion pueda explicar
   * cada candado. Se llama UNA vez al arrancar y reescribe el mapa entero: es
   * una copia de las reglas, no estado del jugador.
   *
   * SE MUTA EN SITIO, no se reasigna. El `PackGate` guarda una REFERENCIA a
   * este mapa (para no reconstruirse en cada consulta), asi que hacer
   * `p.collection.pendingUnlocks = {...}` romperia el enlace en silencio: el
   * gate seguiria mirando el objeto viejo y el candado nunca aparecería.
   */
  publishConditions(): void {
    this.profile.patch((p) => {
      const target = p.collection.pendingUnlocks;
      for (const key of Object.keys(target)) delete target[key];
      for (const def of this.defs) {
        // Lo ya abierto no necesita condicion: no es un candado.
        if (this.isUnlocked(def)) continue;
        target[def.contentId] = def.descKey;
      }
    });
  }

  /** Empieza a escuchar. Devuelve la funcion para parar (util en tests). */
  start(): () => void {
    // Se agrupa por evento: una regla se suscribe UNA vez, no una por definicion.
    const byEvent = new Map<string, UnlockDef[]>();
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

  /** ¿Ya esta abierto este contenido? Lo consulta la Coleccion. */
  isContentUnlocked(contentId: string): boolean {
    return this.profile.current.collection.unlockedCardIds.includes(contentId)
      || this.profile.current.collection.unlockedJokerIds.includes(contentId);
  }

  private isUnlocked(def: UnlockDef): boolean {
    const p = this.profile.current;
    return def.kind === 'card'
      ? p.collection.unlockedCardIds.includes(def.contentId)
      : p.collection.unlockedJokerIds.includes(def.contentId);
  }

  private handle(defs: UnlockDef[], payload: unknown): void {
    const root: Root = { payload, ctx: this.getContext(), profile: this.profile.current };

    for (const def of defs) {
      if (this.unlocked.has(def.id)) continue;
      if (!evaluate(def.when, root)) continue;
      this.grant(def);
    }
  }

  private grant(def: UnlockDef): void {
    this.unlocked.add(def.id);
    const reward: RetentionReward = { type: def.kind, id: def.contentId };
    let added = false;
    this.profile.patch((p) => {
      added = applyReward(p, reward, 'unlock');
      // Ya no es un candado: la condicion se retira del mapa publicado.
      delete p.collection.pendingUnlocks[def.contentId];
    });
    // Idempotencia: si ya lo tenia, no se emite el aviso. Un toast de "ya lo
    // tenias" es ruido, y el aviso dispara una animacion.
    if (!added) return;
    this.bus.emit('unlock:granted', {
      contentId: def.contentId,
      kind: def.kind,
      nameKey: def.nameKey,
    });
  }
}

// ---------------------------------------------------------------------------
// Parseo de las reglas
// ---------------------------------------------------------------------------

const OPS = new Set(['always', 'gte', 'lte', 'eq']);
const KINDS = new Set<string>(['card', 'joker']);

/**
 * Los eventos validos son los MISMOS que los de logros: una regla de
 * desbloqueo no puede escuchar algo que los logros no puedan. Compartir la
 * lista evita que las dos se desincronicen cuando se agregue un evento.
 */
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

function parsePredicate(raw: unknown): UnlockPredicate | null {
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
  return { op, path, value } as UnlockPredicate;
}

/**
 * Lee `src/data/unlock-rules.json`. Una regla invalida se descarta: una puerta
 * rota no puede tumbar el arranque ni bloquear a las demas.
 *
 * A diferencia de los logros, `when` NO es opcional: una regla sin condicion no
 * dice nada, y "siempre" ya existe como condicion explicita.
 */
export function parseUnlockRules(raw: unknown): UnlockDef[] {
  if (!Array.isArray(raw)) return [];
  const out: UnlockDef[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = entry['id'];
    const contentId = entry['contentId'];
    const kind = entry['kind'];
    const nameKey = entry['nameKey'];
    const descKey = entry['descKey'];
    const event = entry['event'];
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof contentId !== 'string' || contentId.length === 0) continue;
    if (typeof kind !== 'string' || !KINDS.has(kind)) continue;
    if (typeof nameKey !== 'string' || typeof descKey !== 'string') continue;
    if (typeof event !== 'string' || !VALID_EVENTS.has(event)) continue;

    const when = parsePredicate(entry['when']);
    if (!when) continue;

    out.push({
      id,
      contentId,
      kind: kind as UnlockKind,
      nameKey,
      descKey,
      event,
      when,
    });
  }
  return out;
}
