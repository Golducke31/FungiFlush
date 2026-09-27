/**
 * OfferService.ts — Sorteo de ofertas (tienda, recompensas, drafts).
 *
 * QUE REEMPLAZA
 * -------------
 * `GameEngine.rollOffers()` estaba hardcodeado: una carta fija + 50% de una
 * segunda carta o un joker + una mutacion, con ids generados con
 * `rng.int(1000, 9999)`. Eso tenia dos problemas:
 *
 *   1. Cualquier cambio de balance exigia tocar el motor.
 *   2. Los ids dependian del RNG, asi que no se podian diferenciar dos ofertas
 *      del mismo tipo ni reproducir una tienda desde una semilla.
 *
 * Ahora el balance vive en `offers.json` (contenido) y los ids son
 * DETERMINISTAS: `offer_<tabla>_<ante>_<blind>_<secuencia>_<indice>`.
 *
 * SEMANTICA DE UNA TABLA
 * ----------------------
 *   groups[]  se evaluan EN ORDEN. Cada grupo:
 *     - tira `chance` (default 1) para existir,
 *     - produce `count` ofertas (default 1),
 *     - y elige cada una por peso entre sus `options`.
 *
 * El orden importa: define el consumo del RNG, y por lo tanto que una partida
 * guardada siga siendo reproducible.
 */

import type { RNG } from '../rng';
import type { CardRegistry } from '../cards/CardRegistry';
import type {
  CardDefinition,
  JokerDefinition,
  OfferGroup,
  OfferOption,
  OfferPhase,
  OfferTable,
  ShopOffer,
} from '../types';

export interface RollContext {
  rng: RNG;
  ante: number;
  /** 0/1/2 dentro del ante. */
  blindIndex: number;
  /** Cuantas veces se re-tiro esta tabla (reroll de tienda). Hace unicos los ids. */
  sequence: number;
  /** Restringe el pool (por ejemplo: solo contenido habilitado por DLC). */
  cardFilter?: (def: CardDefinition) => boolean;
  jokerFilter?: (def: JokerDefinition) => boolean;
}

export class OfferService {
  private readonly byPhase = new Map<OfferPhase, OfferTable[]>();

  constructor(
    private readonly registry: CardRegistry,
    private readonly tables: readonly OfferTable[],
  ) {
    for (const table of tables) {
      const list = this.byPhase.get(table.phase) ?? [];
      list.push(table);
      this.byPhase.set(table.phase, list);
    }
  }

  get hasRewardTable(): boolean {
    return (this.byPhase.get('reward')?.length ?? 0) > 0;
  }

  tablesFor(phase: OfferPhase): OfferTable[] {
    return [...(this.byPhase.get(phase) ?? [])];
  }

  /**
   * Sortea una tabla concreta. Devuelve [] si la tabla no existe: una fase sin
   * tabla no es un error, es una fase sin ofertas.
   */
  roll(tableId: string, ctx: RollContext): ShopOffer[] {
    const table = this.tables.find((t) => t.id === tableId);
    if (!table) return [];

    const offers: ShopOffer[] = [];
    const used = new Set<string>();

    for (const [groupIndex, group] of table.groups.entries()) {
      if (group.chance !== undefined && group.chance < 1 && !ctx.rng.chance(group.chance)) continue;
      const count = Math.max(1, Math.floor(group.count || 1));

      for (let i = 0; i < count; i++) {
        const offer = this.rollOne(table, group, groupIndex, i, ctx, used);
        if (!offer) continue;
        offers.push(offer);
        if (!table.allowDuplicates) used.add(`${offer.kind}:${offer.refId}`);
      }
    }

    return offers;
  }

  /** Sortea la primera tabla de una fase. */
  rollPhase(phase: OfferPhase, ctx: RollContext): ShopOffer[] {
    const table = this.byPhase.get(phase)?.[0];
    if (!table) return [];
    return this.roll(table.id, ctx);
  }

  // -------------------------------------------------------------------------

  private rollOne(
    table: OfferTable,
    group: OfferGroup,
    groupIndex: number,
    slotIndex: number,
    ctx: RollContext,
    used: Set<string>,
  ): ShopOffer | undefined {
    const eligible = group.options.filter((option) => this.isEligible(option, ctx.ante));
    if (eligible.length === 0) return undefined;

    const picked = ctx.rng.weighted(
      eligible,
      eligible.map((o) => Math.max(0, o.weight)),
    );
    if (!picked) return undefined;

    const id = offerId(table.id, ctx, groupIndex, slotIndex);

    switch (picked.kind) {
      case 'card': {
        const def = this.registry.rollRandomCard(
          ctx.rng,
          (card) => this.cardAllowed(card, ctx, used, picked),
          picked.rarityWeights,
          picked.tag,
        );
        if (!def) return undefined;
        return {
          id,
          kind: 'card',
          refId: def.id,
          nameKey: def.nameKey,
          descKey: def.descKey,
          cost: def.cost,
          art: def.art,
          rarity: def.rarity,
          sold: false,
        };
      }

      case 'joker': {
        const def = this.registry.rollRandomJoker(
          ctx.rng,
          (joker) =>
            (!ctx.jokerFilter || ctx.jokerFilter(joker)) &&
            (table.allowDuplicates || !used.has(`joker:${joker.id}`)) &&
            (!picked.tag || (joker.tags ?? []).includes(picked.tag)),
          picked.rarityWeights,
        );
        if (!def) return undefined;
        return {
          id,
          kind: 'joker',
          refId: def.id,
          nameKey: def.nameKey,
          descKey: def.descKey,
          cost: def.cost,
          art: def.art,
          rarity: def.rarity,
          sold: false,
        };
      }

      case 'mutation': {
        const def = this.registry.rollRandomMutation(
          ctx.rng,
          (joker) => !used.has(`mutation:${joker.id}`),
        );
        if (!def) return undefined;
        return {
          id,
          kind: 'mutation',
          refId: def.id,
          nameKey: def.nameKey,
          descKey: def.descKey,
          cost: def.cost,
          art: def.art,
          rarity: def.rarity,
          sold: false,
        };
      }

      case 'voucher':
      case 'money':
        // Vouchers y recompensas de dinero todavia no tienen catalogo propio:
        // llegan con la tienda de la Fase 6. Declararlos en una tabla hoy no
        // rompe nada, simplemente no producen oferta.
        return undefined;
    }
  }

  private isEligible(option: OfferOption, ante: number): boolean {
    if (option.minAnte !== undefined && ante < option.minAnte) return false;
    if (option.maxAnte !== undefined && ante > option.maxAnte) return false;
    return option.weight > 0;
  }

  private cardAllowed(
    def: CardDefinition,
    ctx: RollContext,
    used: Set<string>,
    option: OfferOption,
  ): boolean {
    if (ctx.cardFilter && !ctx.cardFilter(def)) return false;
    if (used.has(`card:${def.id}`)) return false;
    if (option.packId && !def.id.startsWith(`${option.packId}_`)) return false;
    if (option.excludeTag && (def.tags ?? []).includes(option.excludeTag)) return false;
    return true;
  }
}

/**
 * Id determinista. Que sea predecible importa: permite que una tienda se
 * reproduzca desde la semilla, y que `buyOffer(id)` no dependa de un numero
 * aleatorio que puede colisionar.
 */
function offerId(tableId: string, ctx: RollContext, groupIndex: number, slotIndex: number): string {
  return `offer_${tableId}_${ctx.ante}_${ctx.blindIndex}_${ctx.sequence}_${groupIndex}${slotIndex}`;
}
