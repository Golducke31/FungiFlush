/**
 * CardRegistry.ts — Indice de contenido cargado desde JSON.
 *
 * El registro NO sabe de donde vienen los datos. Recibe arrays ya parseados.
 * Eso permite el mismo motor corriendo en tres entornos distintos:
 *   - Vite (import.meta.glob de los .json)
 *   - Node / consola (fs.readdirSync)
 *   - Tests (fixtures en memoria)
 */

import type {
  AscensionDefinition,
  BlindDefinition,
  CardDefinition,
  CardInstance,
  EffectDefinition,
  FamilyType,
  EvolutionRule,
  JokerDefinition,
  JokerInstance,
  OfferTable,
  Rarity,
  UpgradeTrack,
  VoucherDefinition,
} from '../types';
import { TRIGGER_EVENTS, type TriggerEvent } from '../types';
import { supportedActions } from '../triggers/actions';
import type { RNG } from '../rng';

/** Peso de aparicion por rareza. Usado para tienda y recompensas. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 100,
  uncommon: 45,
  rare: 18,
  legendary: 6,
  mythic: 1.5,
};

export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'legendary', 'mythic'];

export interface ContentBundle {
  cards: CardDefinition[];
  jokers: JokerDefinition[];
  blinds: BlindDefinition[];
  /**
   * Objetivo base de puntaje por ante. Lo provee el contenido (tabla `antes`
   * del pack); si falta, el motor cae en `ANTE_BASE_TARGET` de constants.ts.
   * Hacerlo data-driven es lo que permite que una expansion agregue antes.
   */
  anteTargets?: Record<number, number>;
  /** Tablas de oferta (tienda, recompensas, drafts). */
  offers?: OfferTable[];
  /** Curvas de mejora de cartas. */
  upgrades?: UpgradeTrack[];
  /** Reglas de evolucion de cartas. */
  evolutions?: EvolutionRule[];
  /** Modificadores de run (vouchers). Ver `VoucherDefinition`. */
  vouchers?: VoucherDefinition[];
  /**
   * Niveles de dificultad progresiva. Ver `AscensionDefinition`.
   *
   * NO van indexados por `id` como el resto: la clave es el NIVEL. Por eso
   * tienen su propio mapa y no pasan por el camino generico de definiciones.
   */
  ascensions?: AscensionDefinition[];
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

const VALID_TRIGGERS = new Set<string>(TRIGGER_EVENTS as readonly string[]);

/**
 * La ascension neutra. A0 no esta declarada en el contenido: es la ausencia de
 * dificultad anadida. Devolver SIEMPRE un objeto (en vez de `undefined`) deja
 * que cada punto de uso lea `asc.modifiers.targetMultiplier ?? 1` sin ramas.
 */
function identityAscension(level: number): AscensionDefinition {
  return {
    level,
    nameKey: 'ascension.a0.name',
    descKey: 'ascension.a0.desc',
    modifiers: {},
  };
}

/** Acciones realmente implementadas en el registry de acciones. */
const KNOWN_ACTIONS = new Set<string>(supportedActions());

export class CardRegistry {
  private readonly cards = new Map<string, CardDefinition>();
  private readonly jokers = new Map<string, JokerDefinition>();
  private readonly blinds = new Map<string, BlindDefinition>();
  private readonly vouchers = new Map<string, VoucherDefinition>();
  private readonly ascensions = new Map<number, AscensionDefinition>();
  private anteTargets: Record<number, number> | null = null;

  private uidCounter = 0;

  load(bundle: ContentBundle): void {
    for (const card of bundle.cards) this.cards.set(card.id, card);
    for (const joker of bundle.jokers) this.jokers.set(joker.id, joker);
    for (const blind of bundle.blinds) this.blinds.set(blind.id, blind);
    for (const voucher of bundle.vouchers ?? []) this.vouchers.set(voucher.id, voucher);
    for (const asc of bundle.ascensions ?? []) this.ascensions.set(asc.level, asc);
    this.anteTargets = bundle.anteTargets ?? null;
  }

  /**
   * Objetivo base de un ante, o `undefined` si el contenido no lo define.
   * Extrapola del ultimo ante conocido (x2.4 por ante) para que una expansion
   * pueda agregar antess sin declararlos todos.
   */
  anteTarget(ante: number): number | undefined {
    if (!this.anteTargets) return undefined;
    const exact = this.anteTargets[ante];
    if (exact !== undefined) return exact;
    const keys = Object.keys(this.anteTargets).map(Number).sort((a, b) => a - b);
    const last = keys[keys.length - 1];
    if (last === undefined || ante < last) return undefined;
    return Math.round((this.anteTargets[last] ?? 0) * Math.pow(2.4, ante - last));
  }

  /** Ante mas alto declarado por el contenido (8 si no hay tabla). */
  maxAnte(): number {
    if (!this.anteTargets) return 8;
    const keys = Object.keys(this.anteTargets).map(Number);
    return keys.length > 0 ? Math.max(...keys) : 8;
  }

  // --- Acceso a definiciones -------------------------------------------------

  getCard(id: string): CardDefinition {
    const def = this.cards.get(id);
    if (!def) throw new Error(`[CardRegistry] Carta desconocida: "${id}"`);
    return def;
  }

  tryGetCard(id: string): CardDefinition | undefined {
    return this.cards.get(id);
  }

  getJoker(id: string): JokerDefinition {
    const def = this.jokers.get(id);
    if (!def) throw new Error(`[CardRegistry] Joker desconocido: "${id}"`);
    return def;
  }

  tryGetJoker(id: string): JokerDefinition | undefined {
    return this.jokers.get(id);
  }

  allCards(): CardDefinition[] {
    return [...this.cards.values()];
  }

  /** Jokers pasivos (excluye mutaciones, que son consumibles). */
  allJokers(): JokerDefinition[] {
    return [...this.jokers.values()].filter((j) => !(j.tags ?? []).includes('mutation'));
  }

  /** Mutaciones: se compran, se aplican al instante y no ocupan slot. */
  allMutations(): JokerDefinition[] {
    return [...this.jokers.values()].filter((j) => (j.tags ?? []).includes('mutation'));
  }

  isMutation(def: JokerDefinition): boolean {
    return (def.tags ?? []).includes('mutation');
  }

  // --- Vouchers (modificadores de run) --------------------------------------

  tryGetVoucher(id: string): VoucherDefinition | undefined {
    return this.vouchers.get(id);
  }

  getVoucher(id: string): VoucherDefinition {
    const def = this.vouchers.get(id);
    if (!def) throw new Error(`[CardRegistry] Voucher desconocido: "${id}"`);
    return def;
  }

  allVouchers(): VoucherDefinition[] {
    return [...this.vouchers.values()];
  }

  /**
   * Sortea un voucher. `exclude` es lo ya poseido: sin esto la tienda podria
   * ofrecer una regla que el jugador ya tiene, que es una oferta muerta.
   */
  rollRandomVoucher(
    rng: RNG,
    filter?: (v: VoucherDefinition) => boolean,
    exclude?: readonly string[],
  ): VoucherDefinition | undefined {
    const owned = new Set(exclude ?? []);
    const pool = this.allVouchers().filter((v) => (!filter || filter(v)) && !owned.has(v.id));
    if (pool.length === 0) return undefined;
    // Peso uniforme: un voucher no tiene rareza. El coste ya es el dial de
    // balance, y el filtro de elegibilidad lo pone la tabla de ofertas.
    return rng.weighted(
      pool,
      pool.map(() => 1),
    );
  }

  // --- Ascensiones (dificultad progresiva) ----------------------------------

  /** Nivel mas alto declarado por el contenido (0 = solo juego base). */
  maxAscension(): number {
    const keys = [...this.ascensions.keys()];
    return keys.length > 0 ? Math.max(...keys) : 0;
  }

  /**
   * Modificadores de un nivel. A0 y los niveles no declarados devuelven la
   * IDENTIDAD (un objeto vacio), no `undefined`: cada punto de uso tendria que
   * escribir `?? 1` y alguno se olvidaria.
   */
  ascension(level: number): AscensionDefinition {
    if (level <= 0) return identityAscension(0);
    const found = this.ascensions.get(level);
    if (!found) return identityAscension(0);
    return { ...found, modifiers: { ...found.modifiers } };
  }

  allAscensions(): AscensionDefinition[] {
    return [...this.ascensions.values()]
      .sort((a, b) => a.level - b.level)
      .map((def) => ({ ...def, modifiers: { ...def.modifiers } }));
  }

  blindsForAnte(ante: number): BlindDefinition[] {
    return [...this.blinds.values()]
      .filter((b) => b.ante === ante)
      .sort((a, b) => a.scoreMultiplier - b.scoreMultiplier);
  }

  // --- Instanciacion --------------------------------------------------------

  /** Crea una instancia jugable a partir de una definicion. */
  instantiate(defId: string): CardInstance {
    return this.instantiateFrom(this.getCard(defId));
  }

  instantiateFrom(def: CardDefinition): CardInstance {
    this.uidCounter += 1;
    return {
      uid: `${def.id}#${this.uidCounter}`,
      def,
      bonusSubstrate: 0,
      bonusSpores: 0,
      level: 1,
      statuses: [],
    };
  }

  instantiateJoker(defId: string): JokerInstance {
    this.uidCounter += 1;
    const def = this.getJoker(defId);
    return { uid: `${def.id}@${this.uidCounter}`, def, firedCount: 0 };
  }

  /**
   * Construye un mazo inicial: `copies` de cada id indicado.
   * El mazo base del juego son 52 cartas (4 familias x 13 especimenes) para
   * mantener la sensacion de naipe sin perder la tematica de hongos.
   *
   * `overrides` permite que un perfil cambie el mazo inicial (una recompensa,
   * un DLC o un modo). Reemplaza la lista de cartas `starter` por completo: si
   * el jugador eligio su mazo, no se mezcla con el base, se usa el suyo. Un id
   * desconocido se ignora en silencio: un guardado viejo no puede tumbar el
   * arranque de la run.
   */
  buildStarterDeck(
    rng: RNG,
    overrides?: Array<{ cardId: string; copies: number }>,
  ): CardInstance[] {
    const deck: CardInstance[] = [];

    if (overrides && overrides.length > 0) {
      for (const entry of overrides) {
        const def = this.cards.get(entry.cardId);
        if (!def) continue;
        const copies = Math.max(1, Math.floor(entry.copies));
        for (let i = 0; i < copies; i++) deck.push(this.instantiateFrom(def));
      }
      // Si NINGUN id del override existia (contenido retirado), no se devuelve
      // un mazo vacio: se cae al base. Una run sin cartas no es jugable.
      if (deck.length > 0) return rng.shuffle(deck);
    }

    const pool = this.allCards().filter((c) => (c.tags ?? []).includes('starter'));
    const source = pool.length > 0 ? pool : this.allCards();
    for (const def of source) {
      const copies = Math.max(1, def.copies ?? 1);
      for (let i = 0; i < copies; i++) deck.push(this.instantiateFrom(def));
    }
    return rng.shuffle(deck);
  }

  /**
   * Elige una carta aleatoria ponderada por rareza (para tienda / recompensas).
   *
   * `rarityWeights` permite que una tabla de oferta cambie el balance de un
   * draft concreto (por ejemplo, un draft de recompensa con mas raras) sin
   * tocar los pesos globales del juego.
   */
  rollRandomCard(
    rng: RNG,
    filter?: (c: CardDefinition) => boolean,
    rarityWeights?: Partial<Record<Rarity, number>>,
    tag?: string,
  ): CardDefinition | undefined {
    const pool = this.allCards().filter(
      (c) => (!filter || filter(c)) && (!tag || (c.tags ?? []).includes(tag)),
    );
    const weights = pool.map((c) => rarityWeights?.[c.rarity] ?? RARITY_WEIGHT[c.rarity]);
    return rng.weighted(pool, weights);
  }

  rollRandomJoker(
    rng: RNG,
    filter?: (j: JokerDefinition) => boolean,
    rarityWeights?: Partial<Record<Rarity, number>>,
  ): JokerDefinition | undefined {
    const pool = this.allJokers().filter((j) => !filter || filter(j));
    const weights = pool.map((j) => rarityWeights?.[j.rarity] ?? RARITY_WEIGHT[j.rarity]);
    return rng.weighted(pool, weights);
  }

  rollRandomMutation(rng: RNG, filter?: (j: JokerDefinition) => boolean): JokerDefinition | undefined {
    const pool = this.allMutations().filter((j) => !filter || filter(j));
    return rng.weighted(
      pool,
      pool.map((c) => RARITY_WEIGHT[c.rarity]),
    );
  }

  // --- Validacion ----------------------------------------------------------

  /**
   * Valida TODO el contenido. Pensado para correr en CI y en `npm run sim`.
   * Es lo que permite que agregar 100 cartas escribiendo JSON sea seguro:
   * un typo en un `trigger` o una condicion mal formada se detecta al instante.
   */
  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const checkId = (kind: string, id: string) => {
      if (!/^[a-z0-9_]+$/.test(id)) {
        issues.push({
          level: 'error',
          where: `${kind}:${id}`,
          message: 'El id debe ser snake_case en minusculas (a-z, 0-9, _).',
        });
      }
      if (!id.includes('_')) {
        issues.push({
          level: 'warning',
          where: `${kind}:${id}`,
          message: 'Convencion: los ids usan prefijo de familia (ej: amanita_toxica).',
        });
      }
    };

    const checkEffects = (where: string, effects: readonly EffectDefinition[] | undefined) => {
      for (const [i, raw] of (effects ?? []).entries()) {
        const tag = `${where} > effects[${i}]`;
        // Se valida contra una forma "suelta" a proposito: estos datos vienen
        // de JSON escrito a mano y pueden estar mal formados. El objetivo del
        // validador es justamente reportarlos, no asumir que son correctos.
        const effect = raw as Partial<EffectDefinition> & {
          actions?: Array<Record<string, unknown>>;
        };

        if (typeof effect.trigger !== 'string' || !VALID_TRIGGERS.has(effect.trigger)) {
          issues.push({ level: 'error', where: tag, message: `Trigger invalido: "${String(effect.trigger)}".` });
        }
        if (!Array.isArray(effect.actions) || effect.actions.length === 0) {
          issues.push({ level: 'error', where: tag, message: 'Un efecto sin acciones no hace nada.' });
        }
        for (const action of effect.actions ?? []) {
          const type = action['type'];
          if (typeof type !== 'string') {
            issues.push({ level: 'error', where: tag, message: 'Accion sin "type".' });
            continue;
          }
          if (!KNOWN_ACTIONS.has(type)) {
            issues.push({ level: 'error', where: tag, message: `Accion desconocida: "${type}".` });
          }
          const value = action['value'];
          if (value !== undefined && typeof value !== 'number') {
            issues.push({ level: 'error', where: tag, message: `"value" debe ser numero en ${type}.` });
          }
          if (type === 'CREATE_CARD' && typeof action['cardId'] !== 'string') {
            issues.push({ level: 'error', where: tag, message: 'CREATE_CARD necesita "cardId".' });
          }
        }
        if (effect.chance !== undefined && (effect.chance < 0 || effect.chance > 1)) {
          issues.push({ level: 'warning', where: tag, message: 'chance fuera de [0,1].' });
        }
        if (!effect.id) {
          issues.push({
            level: 'warning',
            where: tag,
            message: 'Sin "id": los efectos "once" podrian consumirse entre si.',
          });
        }
      }
    };

    for (const card of this.cards.values()) {
      const where = `card:${card.id}`;
      checkId('card', card.id);
      checkEffects(where, card.effects);
      if (!card.nameKey.startsWith('card.')) {
        issues.push({ level: 'warning', where, message: `nameKey deberia empezar con "card.": ${card.nameKey}` });
      }
      if (!card.descKey.startsWith('card.')) {
        issues.push({ level: 'warning', where, message: `descKey deberia empezar con "card.": ${card.descKey}` });
      }
      if (card.baseSubstrate < 0 || card.baseSpores < 0) {
        issues.push({ level: 'error', where, message: 'Valores base negativos.' });
      }
      if (card.baseSpores === 0) {
        issues.push({ level: 'warning', where, message: 'baseSpores = 0 anula todo el score de la carta.' });
      }
    }

    for (const joker of this.jokers.values()) {
      const where = `joker:${joker.id}`;
      checkId('joker', joker.id);
      checkEffects(where, joker.effects);
      if (!joker.effects || joker.effects.length === 0) {
        issues.push({ level: 'error', where, message: 'Un joker sin efectos es un joker muerto.' });
      }
    }

    const antes = new Set<number>();
    for (const blind of this.blinds.values()) {
      const where = `blind:${blind.id}`;
      checkId('blind', blind.id);
      checkEffects(where, blind.effects);
      if (blind.scoreMultiplier <= 0) {
        issues.push({ level: 'error', where, message: 'scoreMultiplier debe ser > 0.' });
      }
      antes.add(blind.ante);
    }

    // El tope lo define el contenido, no un 8 hardcodeado: una expansion
    // puede agregar antes y el validador los cubre solo.
    const maxAnte = this.maxAnte();
    for (let ante = 1; ante <= maxAnte; ante++) {
      const forAnte = this.blindsForAnte(ante);
      if (forAnte.length < 3) {
        issues.push({
          level: 'error',
          where: `blinds:ante${ante}`,
          message: `El ante ${ante} necesita al menos 3 blinds (small, big, boss) y tiene ${forAnte.length}.`,
        });
      }
    }

    // Cartas referenciadas por CREATE_CARD que no existen.
    for (const card of this.cards.values()) {
      for (const effect of card.effects ?? []) {
        for (const action of effect.actions) {
          if (action.type === 'CREATE_CARD' && !this.cards.has(action.cardId)) {
            issues.push({
              level: 'error',
              where: `card:${card.id}`,
              message: `CREATE_CARD apunta a una carta inexistente: "${action.cardId}".`,
            });
          }
        }
      }
    }

    return issues;
  }

  /** Resumen de cobertura de contenido. Util para ver el progreso de autoría. */
  stats() {
    const byRarity = {} as Record<Rarity, number>;
    for (const r of RARITY_ORDER) byRarity[r] = 0;
    for (const c of this.cards.values()) byRarity[c.rarity] += 1;

    const byElement: Partial<Record<string, number>> = {};
    for (const c of this.cards.values()) {
      byElement[c.element] = (byElement[c.element] ?? 0) + 1;
    }

    const byFamily: Partial<Record<FamilyType, number>> = {};
    for (const c of this.cards.values()) {
      byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
    }

    const triggersUsed = new Set<TriggerEvent>();
    for (const c of this.cards.values()) {
      for (const e of c.effects ?? []) triggersUsed.add(e.trigger);
    }
    for (const j of this.jokers.values()) {
      for (const e of j.effects) triggersUsed.add(e.trigger);
    }

    return {
      cards: this.cards.size,
      jokers: this.jokers.size,
      blinds: this.blinds.size,
      byRarity,
      byElement,
      byFamily,
      triggersUsed: [...triggersUsed].sort(),
    };
  }
}
