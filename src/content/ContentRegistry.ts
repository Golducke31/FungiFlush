/**
 * ContentRegistry.ts — Mezcla determinista de packs de contenido.
 *
 * Recibe packs ya cargados (bundled o remotos) y produce un `ContentBundle`
 * listo para el motor. El motor no sabe que existen los packs.
 *
 * TRES PROPIEDADES QUE IMPORTA GARANTIZAR
 * ---------------------------------------
 * 1. **Determinismo.** El orden de merge sale del manifiesto, no del
 *    filesystem. Renombrar un archivo no cambia ninguna partida.
 * 2. **Aditividad.** Un pack nuevo agrega contenido; no puede romper lo
 *    existente salvo que lo pida expresamente (`allowOverride`).
 * 3. **Trazabilidad.** Cada definicion sabe de que pack viene (`__pack`), asi
 *    un error de validacion apunta al responsable y el gating por DLC puede
 *    filtrar sin adivinar.
 */

import {
  CardRegistry,
  type BlindDefinition,
  type CardDefinition,
  type ContentBundle,
  type EvolutionRule,
  type JokerDefinition,
  type UpgradeTrack,
  type VoucherDefinition,
} from '@engine/index';
// El validador vive en la capa de contenido y solo toma el TIPO del tablero:
// asi el arranque no arrastra el chunk diferido del duelo.
import { validateBoardDefs } from './boardValidation';
import type { BoardCardDef } from '@engine/board/types';

import {
  comparePacks,
  compareVersion,
  entitlementFor,
  type AnteRow,
  type LoadedPack,
  type OfferTable,
  type PackManifest,
} from './types';

type AnyDefinition = CardDefinition | JokerDefinition | BlindDefinition | VoucherDefinition;

export interface PackIssue {
  level: 'error' | 'warning';
  /** Pack responsable, o '<registry>' para problemas globales. */
  pack: string;
  where: string;
  message: string;
}

export interface Collision {
  kind: 'card' | 'joker' | 'blind' | 'voucher' | 'ante';
  id: string;
  winner: string;
  loser: string;
}

export interface SkippedPack {
  id: string;
  reason: string;
}

/** Filtro de contenido por DLC. Lo produce `PackGate` (src/meta). */
export interface ContentGate {
  cardFilter?(): (def: CardDefinition) => boolean;
  jokerFilter?(): (def: JokerDefinition) => boolean;
  blindFilter?(): (def: BlindDefinition) => boolean;
}

type Tagged<T> = T & { __pack: string };

export class ContentRegistry {
  readonly packs: LoadedPack[] = [];
  readonly skipped: SkippedPack[] = [];
  readonly collisions: Collision[] = [];

  private readonly cards = new Map<string, Tagged<CardDefinition>>();
  private readonly jokers = new Map<string, Tagged<JokerDefinition>>();
  private readonly blinds = new Map<string, Tagged<BlindDefinition>>();
  private readonly antes = new Map<number, number>();
  private readonly anteOwner = new Map<number, string>();
  private readonly offers: OfferTable[] = [];
  private readonly upgrades: UpgradeTrack[] = [];
  private readonly evolutions: EvolutionRule[] = [];
  private readonly vouchers = new Map<string, Tagged<VoucherDefinition>>();
  /** Flechas del modo tablero, indexadas por `cardId`. */
  private readonly board: BoardCardDef[] = [];

  private readonly appVersion: string;

  constructor(appVersion = '1.0.0') {
    this.appVersion = appVersion;
  }

  // -------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------

  /** Agrega un pack. Devuelve false si quedo omitido por sus requisitos. */
  add(pack: LoadedPack): boolean {
    this.packs.push(pack);
    this.merge();
    return !this.skipped.some((s) => s.id === pack.manifest.id);
  }

  /**
   * Re-mergea todo desde cero en cada `add`, porque el orden de llegada no es
   * confiable (un pack remoto puede resolverse antes que el base). Reconstruir
   * es O(contenido) y ocurre una sola vez, al arrancar.
   */
  private merge(): void {
    this.cards.clear();
    this.jokers.clear();
    this.blinds.clear();
    this.antes.clear();
    this.anteOwner.clear();
    this.offers.length = 0;
    this.upgrades.length = 0;
    this.evolutions.length = 0;
    this.vouchers.clear();
    this.board.length = 0;
    this.collisions.length = 0;
    this.skipped.length = 0;

    const present = new Set(this.packs.map((p) => p.manifest.id));
    const active: LoadedPack[] = [];

    for (const pack of this.packs) {
      const appMin = pack.manifest.requires?.appMin;
      if (appMin && compareVersion(this.appVersion, appMin) < 0) {
        this.skipped.push({ id: pack.manifest.id, reason: `requires app >= ${appMin}` });
        continue;
      }
      const missing = (pack.manifest.requires?.packs ?? []).filter((id) => !present.has(id));
      if (missing.length > 0) {
        this.skipped.push({ id: pack.manifest.id, reason: `missing packs: ${missing.join(', ')}` });
        continue;
      }
      active.push(pack);
    }

    const ordered = [...active].sort((a, b) => comparePacks(a.manifest, b.manifest));

    for (const pack of ordered) {
      const id = pack.manifest.id;
      for (const def of pack.cards) this.insert('card', this.cards, def.id, def, id, pack.manifest);
      for (const def of pack.jokers) this.insert('joker', this.jokers, def.id, def, id, pack.manifest);
      for (const def of pack.mutations) this.insert('joker', this.jokers, def.id, def, id, pack.manifest);
      for (const def of pack.blinds) this.insert('blind', this.blinds, def.id, def, id, pack.manifest);
      for (const row of pack.antes) this.insertAnte(row, id, pack.manifest);
      this.offers.push(...pack.offers);
      this.upgrades.push(...pack.upgrades);
      this.evolutions.push(...pack.evolutions);
      for (const def of pack.vouchers) this.insert('voucher', this.vouchers, def.id, def, id, pack.manifest);
      // Mismo criterio que upgrades y evolutions: se acumulan y el validador
      // del tipo detecta duplicados. Un `cardId` repetido entre packs es un
      // error de contenido, no un override silencioso.
      this.board.push(...pack.board);
    }
  }

  private insert<T extends AnyDefinition>(
    kind: 'card' | 'joker' | 'blind' | 'voucher',
    map: Map<string, Tagged<T>>,
    key: string,
    def: T,
    packId: string,
    manifest: PackManifest,
  ): void {
    const incumbent = map.get(key);
    if (!incumbent) {
      map.set(key, { ...def, __pack: packId });
      return;
    }
    const canOverride =
      manifest.gating?.allowOverride === true &&
      manifest.version > (this.versionOf(incumbent.__pack) ?? 0);

    if (canOverride) {
      map.set(key, { ...def, __pack: packId });
      this.collisions.push({ kind, id: key, winner: packId, loser: incumbent.__pack });
      return;
    }
    this.collisions.push({ kind, id: key, winner: incumbent.__pack, loser: packId });
  }

  private insertAnte(row: AnteRow, packId: string, manifest: PackManifest): void {
    const owner = this.anteOwner.get(row.ante);
    if (owner === undefined) {
      this.antes.set(row.ante, row.baseTarget);
      this.anteOwner.set(row.ante, packId);
      return;
    }
    const canOverride =
      manifest.gating?.allowOverride === true && manifest.version > (this.versionOf(owner) ?? 0);

    if (canOverride) {
      this.antes.set(row.ante, row.baseTarget);
      this.anteOwner.set(row.ante, packId);
      this.collisions.push({ kind: 'ante', id: String(row.ante), winner: packId, loser: owner });
      return;
    }
    this.collisions.push({ kind: 'ante', id: String(row.ante), winner: owner, loser: packId });
  }

  private versionOf(packId: string): number | undefined {
    return this.packs.find((p) => p.manifest.id === packId)?.manifest.version;
  }

  // -------------------------------------------------------------------------
  // Salida
  // -------------------------------------------------------------------------

  /**
   * Bundle para el motor. Mantiene el ORDEN DE DECLARACION del manifiesto:
   * es lo que hace que una partida de hoy se reproduzca igual manana.
   */
  toBundle(gate?: ContentGate): ContentBundle {
    const cardFilter = gate?.cardFilter?.();
    const jokerFilter = gate?.jokerFilter?.();
    const blindFilter = gate?.blindFilter?.();

    const cards = [...this.cards.values()].filter((c) => !cardFilter || cardFilter(c));
    const jokers = [...this.jokers.values()].filter((j) => !jokerFilter || jokerFilter(j));
    const blinds = [...this.blinds.values()].filter((b) => !blindFilter || blindFilter(b));

    return {
      cards: cards.map(stripPack) as CardDefinition[],
      jokers: jokers.map(stripPack) as JokerDefinition[],
      blinds: blinds.map(stripPack) as BlindDefinition[],
      ...(this.antes.size > 0 ? { anteTargets: Object.fromEntries(this.antes) } : {}),
      ...(this.offers.length > 0 ? { offers: [...this.offers] } : {}),
      ...(this.upgrades.length > 0 ? { upgrades: [...this.upgrades] } : {}),
      ...(this.evolutions.length > 0 ? { evolutions: [...this.evolutions] } : {}),
      ...(this.vouchers.size > 0
        ? { vouchers: [...this.vouchers.values()].map(stripPack) as VoucherDefinition[] }
        : {}),
    };
  }

  /** Pool estable para sorteos: ordenado por id, inmune al orden de carga. */
  poolOf(kind: 'card' | 'joker'): AnyDefinition[] {
    const defs: AnyDefinition[] =
      kind === 'card'
        ? ([...this.cards.values()].map(stripPack) as CardDefinition[])
        : ([...this.jokers.values()].map(stripPack) as JokerDefinition[]);
    return defs.sort((a, b) => a.id.localeCompare(b.id));
  }

  offerTables(): OfferTable[] {
    return [...this.offers];
  }

  /** Entradas del modo tablero, tal como las consume `createMatch()`. */
  boardDefs(): BoardCardDef[] {
    return this.board.map((def) => ({ ...def, arrows: [...def.arrows] }));
  }

  /** Objetivo base de un ante. Extrapola si el contenido definio mas antes. */
  anteTarget(ante: number): number | undefined {
    const exact = this.antes.get(ante);
    if (exact !== undefined) return exact;
    const keys = [...this.antes.keys()].sort((a, b) => a - b);
    const last = keys[keys.length - 1];
    if (last === undefined || ante < last) return undefined;
    const lastTarget = this.antes.get(last) ?? 0;
    return Math.round(lastTarget * Math.pow(2.4, ante - last));
  }

  /** Ante mas alto definido por el contenido (8 en el juego base). */
  maxAnte(): number {
    const keys = [...this.antes.keys()];
    return keys.length > 0 ? Math.max(...keys) : 8;
  }

  /** Diccionarios de los packs, por idioma. Se mezclan sobre el base. */
  packDictionaries(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const pack of this.packs) {
      for (const [lang, path] of Object.entries(pack.manifest.i18n ?? {})) {
        const slice = pack.files[path];
        if (!slice || typeof slice !== 'object') continue;
        out[lang] = { ...(out[lang] ?? {}), ...(slice as Record<string, unknown>) };
      }
    }
    return out;
  }

  /**
   * Hash del contenido declarado. Se guarda en la partida para poder avisar
   * "el balance cambio" sin invalidar el guardado.
   */
  contentHash(): string {
    const ids: string[] = [];
    for (const id of this.cards.keys()) ids.push(`card:${id}`);
    for (const id of this.jokers.keys()) ids.push(`joker:${id}`);
    for (const id of this.blinds.keys()) ids.push(`blind:${id}`);
    ids.sort();
    return fnv1a(ids.join('|'));
  }

  // -------------------------------------------------------------------------
  // Validacion
  // -------------------------------------------------------------------------

  /** Manifiestos activos, en orden de merge. */
  activeManifests(): PackManifest[] {
    const present = new Set(this.packs.map((p) => p.manifest.id));
    return this.packs
      .filter((p) => {
        const appMin = p.manifest.requires?.appMin;
        if (appMin && compareVersion(this.appVersion, appMin) < 0) return false;
        return (p.manifest.requires?.packs ?? []).every((id) => present.has(id));
      })
      .map((p) => p.manifest)
      .sort(comparePacks);
  }

  /** Claves de entitlement que el juego puede llegar a consultar. */
  entitlements(): string[] {
    return this.activeManifests().map(entitlementFor);
  }

  validate(options?: { dictionaries?: Record<string, Record<string, unknown>> }): PackIssue[] {
    const issues: PackIssue[] = [];

    // --- Reglas del manifiesto ---
    const seen = new Set<string>();
    for (const manifest of this.activeManifests()) {
      if (seen.has(manifest.id)) {
        issues.push({ level: 'error', pack: manifest.id, where: 'pack.json', message: 'id de pack duplicado' });
      }
      seen.add(manifest.id);

      if (!/^[a-z0-9_]+$/.test(manifest.id)) {
        issues.push({ level: 'error', pack: manifest.id, where: 'pack.json', message: 'el id debe ser snake_case' });
      }
      if (!Number.isInteger(manifest.version) || manifest.version < 1) {
        issues.push({ level: 'error', pack: manifest.id, where: 'pack.json', message: 'version debe ser un entero >= 1' });
      }
    }

    // --- Colisiones (las legitimas por allowOverride se omiten) ---
    const winners = new Map(this.packs.map((p) => [p.manifest.id, p.manifest] as const));
    for (const collision of this.collisions) {
      if (winners.get(collision.winner)?.gating?.allowOverride) continue;
      issues.push({
        level: 'warning',
        pack: collision.loser,
        where: collision.kind,
        message: `${collision.kind} "${collision.id}" ya lo declaraba ${collision.winner}; se ignora`,
      });
    }

    // --- Cobertura de la tabla de antes ---
    if (this.antes.size === 0) {
      issues.push({ level: 'error', pack: '<registry>', where: 'antes', message: 'ningun pack declara la tabla de antes' });
    } else {
      for (let ante = 1; ante <= this.maxAnte(); ante++) {
        if (!this.antes.has(ante)) {
          issues.push({
            level: 'warning',
            pack: '<registry>',
            where: 'antes',
            message: `falta el ante ${ante}; se extrapolara desde el ultimo definido`,
          });
        }
      }
    }

    // --- Mejoras ---
    for (const track of this.upgrades) {
      if (!(track.baseCost > 0)) {
        issues.push({ level: 'error', pack: this.ownerOf(track.id), where: `upgrade:${track.id}`, message: 'baseCost debe ser > 0' });
      }
      if (!(track.growth >= 1)) {
        issues.push({ level: 'error', pack: this.ownerOf(track.id), where: `upgrade:${track.id}`, message: 'growth debe ser >= 1' });
      }
      if (track.maxLevel < 0) {
        issues.push({ level: 'error', pack: this.ownerOf(track.id), where: `upgrade:${track.id}`, message: 'maxLevel no puede ser negativo (0 = sin techo)' });
      }
    }

    // --- Evoluciones ---
    const evolvedTargets = new Set<string>();
    const evolutionIds = new Set<string>();
    for (const voucher of this.vouchers.values()) {
      if (!voucher.nameKey || !voucher.descKey) {
        issues.push({
          level: 'error',
          where: `voucher:${voucher.id}`,
          pack: voucher.__pack,
          message: 'falta nameKey o descKey',
        });
      }
      if (!Number.isFinite(voucher.cost) || voucher.cost < 0) {
        issues.push({
          level: 'error',
          where: `voucher:${voucher.id}`,
          pack: voucher.__pack,
          message: 'cost invalido',
        });
      }
      // Un voucher sin efectos NI modificadores no hace nada: es contenido
      // muerto que ocupa un lugar en la tienda.
      if ((voucher.effects?.length ?? 0) === 0 && !voucher.runModifiers) {
        issues.push({
          level: 'warning',
          where: `voucher:${voucher.id}`,
          pack: voucher.__pack,
          message: 'sin effects ni runModifiers: no hace nada',
        });
      }
    }

    for (const rule of this.evolutions) {
      const where = `evolution:${rule.id}`;
      if (evolutionIds.has(rule.id)) {
        issues.push({ level: 'error', pack: this.ownerOf(rule.from), where, message: 'id de evolucion duplicado' });
      }
      evolutionIds.add(rule.id);

      if (!this.cards.has(rule.from)) {
        issues.push({ level: 'error', pack: this.ownerOf(rule.id), where, message: `"from" apunta a una carta inexistente: ${rule.from}` });
      }
      if (!this.cards.has(rule.to)) {
        issues.push({ level: 'error', pack: this.ownerOf(rule.id), where, message: `"to" apunta a una carta inexistente: ${rule.to}` });
      } else {
        evolvedTargets.add(rule.to);
      }
      if (rule.from === rule.to) {
        issues.push({ level: 'error', pack: this.ownerOf(rule.id), where, message: 'una carta no puede evolucionar a si misma' });
      }
    }

    // Una carta marcada como evolucionada a la que NADIE puede evolucionar es
    // contenido muerto: ocupa lugar en la coleccion y no se puede obtener.
    for (const card of this.cards.values()) {
      if (!(card.tags ?? []).includes('evolved')) continue;
      if (evolvedTargets.has(card.id)) continue;
      issues.push({
        level: 'warning',
        pack: card.__pack,
        where: `card:${card.id}`,
        message: 'tiene el tag "evolved" pero ninguna evolucion apunta a ella',
      });
    }

    // --- Tablero (Tetra Master) ---
    // Se valida contra las cartas del registro: una flecha que apunta a un id
    // inexistente es contenido muerto y el duelo se rompe al repartir.
    if (this.board.length > 0) {
      for (const issue of validateBoardDefs(this.board, new Set(this.cards.keys()))) {
        issues.push({
          level: issue.level,
          pack: this.packOf(issue.where.replace(/^board:/, '')) ?? '<registry>',
          where: issue.where,
          message: issue.message,
        });
      }
    }

    // --- Validacion semantica del motor, etiquetada por pack ---
    const registry = new CardRegistry();
    registry.load(this.toBundle());
    for (const issue of registry.validate()) {
      issues.push({ level: issue.level, pack: this.ownerOf(issue.where), where: issue.where, message: issue.message });
    }

    // --- Cobertura i18n del contenido ---
    const dicts = options?.dictionaries;
    if (dicts) {
      for (const key of this.contentKeys()) {
        for (const [lang, dict] of Object.entries(dicts)) {
          if (lookup(dict, key) === undefined) {
            issues.push({ level: 'error', pack: this.ownerOf(key), where: `i18n.${lang}`, message: `falta la clave "${key}"` });
          }
        }
      }
    }

    return issues;
  }

  /** Claves i18n que declara el contenido (nameKey / descKey). */
  private contentKeys(): string[] {
    const keys: string[] = [];
    for (const def of this.cards.values()) keys.push(def.nameKey, def.descKey);
    for (const def of this.jokers.values()) keys.push(def.nameKey, def.descKey);
    for (const def of this.blinds.values()) keys.push(def.nameKey, def.descKey);
    return keys;
  }

  /** A que pack pertenece una definicion (por id o por clave i18n). */
  ownerOf(where: string): string {
    const idMatch = /(?:card|joker|blind)[.:]([a-z0-9_]+)/.exec(where);
    const id = idMatch?.[1];
    if (id) {
      const owner = this.cards.get(id)?.__pack ?? this.jokers.get(id)?.__pack ?? this.blinds.get(id)?.__pack;
      if (owner) return owner;
    }
    for (const def of [...this.cards.values(), ...this.jokers.values(), ...this.blinds.values()]) {
      if (where.includes(def.nameKey) || where.includes(def.descKey)) return def.__pack;
    }
    return '<registry>';
  }

  // -------------------------------------------------------------------------
  // Indice para gating (DLC)
  // -------------------------------------------------------------------------

  /** Pack al que pertenece una carta/joker/blind. */
  packOf(contentId: string): string | undefined {
    return (
      this.cards.get(contentId)?.__pack ??
      this.jokers.get(contentId)?.__pack ??
      this.blinds.get(contentId)?.__pack ??
      this.vouchers.get(contentId)?.__pack
    );
  }

  /**
   * Ids que son DESTINO de una regla de evolucion.
   *
   * El gating necesita saberlo: una carta evolucionada se obtiene evolucionando,
   * asi que su condicion de acceso YA es el requisito de la evolucion. Si
   * ademas estuviera detras de una puerta, quedaria FUERA del `CardRegistry` y
   * `EvolutionService.apply()` no podria resolver el destino: la evolucion
   * devolveria `null` en silencio y el contenido quedaria inalcanzable para
   * siempre. Es un fallo mudo, de los peores.
   */
  evolutionTargets(): Set<string> {
    const out = new Set<string>();
    for (const rule of this.evolutions) out.add(rule.to);
    return out;
  }

  manifestOf(packId: string): PackManifest | undefined {
    return this.packs.find((p) => p.manifest.id === packId)?.manifest;
  }

  /** Estado declarado por cada pack: como se bloquea y que contenido aporta. */
  packEntries(): Array<{
    id: string;
    titleKey: string;
    entitlement: string;
    lockedVisibility: 'visible' | 'hidden';
    contentIds: string[];
    seasonId?: string;
  }> {
    return this.activeManifests().map((manifest) => {
      const id = manifest.id;
      const contentIds: string[] = [];
      for (const [key, def] of this.cards) if (def.__pack === id) contentIds.push(key);
      for (const [key, def] of this.jokers) if (def.__pack === id) contentIds.push(key);
      for (const [key, def] of this.blinds) if (def.__pack === id) contentIds.push(key);
      for (const [key, def] of this.vouchers) if (def.__pack === id) contentIds.push(key);
      return {
        id,
        titleKey: manifest.titleKey,
        entitlement: entitlementFor(manifest),
        lockedVisibility: manifest.gating?.lockedVisibility ?? 'visible',
        contentIds,
        ...(manifest.gating?.seasonId ? { seasonId: manifest.gating.seasonId } : {}),
      };
    });
  }

  // -------------------------------------------------------------------------

  stats(): {
    packs: number;
    cards: number;
    jokers: number;
    vouchers: number;
    blinds: number;
    antes: number;
    offers: number;
    upgrades: number;
    evolutions: number;
    board: number;
  } {
    return {
      packs: this.packs.length,
      cards: this.cards.size,
      jokers: this.jokers.size,
      vouchers: this.vouchers.size,
      blinds: this.blinds.size,
      antes: this.antes.size,
      offers: this.offers.length,
      upgrades: this.upgrades.length,
      evolutions: this.evolutions.length,
      board: this.board.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripPack<T extends { __pack: string }>(value: T): Omit<T, '__pack'> {
  const clone: Record<string, unknown> = { ...value };
  delete clone['__pack'];
  return clone as Omit<T, '__pack'>;
}

/** FNV-1a de 32 bits. Estable entre plataformas; suficiente para detectar cambios. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function lookup(dict: Record<string, unknown>, dotted: string): unknown {
  let node: unknown = dict;
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}
