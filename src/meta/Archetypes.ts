/**
 * Archetypes.ts — Los 4 arquetipos de run (marco mayor del deckbuilding).
 *
 * QUE SON
 * -------
 * Un arquetipo es una FORMA de puntuar, no una etiqueta de fantasia. Cada uno
 * trae:
 *
 *   - `starter`: el mazo con el que arranca la run (reemplaza el mazo base).
 *   - `bias`:   los elementos que la TIENDA prioriza al ofrecer cartas.
 *   - `element`: el elemento firma, que la coleccion y el HUD usan de acento.
 *
 * POR QUE VIVE ACA Y NO EN EL MOTOR
 * ----------------------------------
 * El motor es puro y no conoce archivos. Este modulo es el unico punto que lee
 * `src/data/archetypes.json`, valida cada entrada y la expone tipada. Una
 * entrada mal escrita se DESCARTA en vez de romper el arranque: un JSON a medio
 * editar no puede tumbar el juego entero.
 *
 * El arquetipo de una run se guarda como STRING en `RunState.archetype` (mismo
 * criterio que `vouchers`/`ascension`): solo ids, nunca objetos, para poder
 * rebalancear el arquetipo sin invalidar guardados.
 */

import raw from '@data/archetypes.json';

import type { ElementType } from '@engine/index';

export interface ArchetypeStarterEntry {
  cardId: string;
  copies: number;
}

export interface ArchetypeDefinition {
  id: string;
  nameKey: string;
  taglineKey: string;
  descKey: string;
  howKey: string;
  weaknessKey: string;
  /** Elemento firma: acento visual y eje de la fantasia. */
  element: ElementType;
  /** Segundo elemento que la tienda tambien favorece. */
  accentElement: ElementType;
  starter: ArchetypeStarterEntry[];
  /** Elementos que la tienda prioriza (normalmente `[element, accentElement]`). */
  bias: ElementType[];
}

/**
 * El arquetipo "clasico": sin sesgo, con el mazo base de siempre.
 *
 * No es una entrada del JSON a proposito. Es el ESTADO POR DEFECTO (archetype
 * vacio), y quien no elige nada juega exactamente como antes de que existiera
 * esta funcion. Asi el cambio es aditivo y no rebalancea la run base.
 */
export const CLASSIC_ARCHETYPE_ID = '';

const ELEMENTS: readonly ElementType[] = [
  'neutral',
  'poison',
  'spore',
  'decay',
  'symbiosis',
  'crystal',
  'mycelium',
  'parasite',
];

function isElement(value: unknown): value is ElementType {
  return typeof value === 'string' && (ELEMENTS as readonly string[]).includes(value);
}

function parseEntry(value: unknown): ArchetypeStarterEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const cardId = record['cardId'];
  if (typeof cardId !== 'string' || cardId.length === 0) return null;
  const copiesRaw = record['copies'];
  const copies = typeof copiesRaw === 'number' ? Math.floor(copiesRaw) : 1;
  return { cardId, copies: Math.max(1, copies) };
}

/**
 * Lee y valida una entrada cruda. Devuelve `null` si le falta lo minimo
 * (id o claves i18n): una entrada sin nombre seria una tarjeta en blanco.
 */
function parseArchetype(value: unknown): ArchetypeDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = record['id'];
  if (typeof id !== 'string' || id.length === 0) return null;

  const element = record['element'];
  const accentElement = record['accentElement'];
  if (!isElement(element) || !isElement(accentElement)) return null;

  const starter: ArchetypeStarterEntry[] = [];
  const rawStarter = record['starter'];
  if (Array.isArray(rawStarter)) {
    for (const item of rawStarter) {
      const entry = parseEntry(item);
      if (entry) starter.push(entry);
    }
  }
  // Un arquetipo sin mazo no es jugable: cae al mazo base (`buildStarterDeck`
  // ya lo hace cuando el override queda vacio), pero entonces el arquetipo solo
  // seria una etiqueta. Mejor descartarlo.
  if (starter.length === 0) return null;

  const bias: ElementType[] = [];
  const rawBias = record['bias'];
  if (Array.isArray(rawBias)) {
    for (const item of rawBias) if (isElement(item)) bias.push(item);
  }

  const str = (key: string): string =>
    typeof record[key] === 'string' && (record[key] as string).length > 0
      ? (record[key] as string)
      : `archetype.${id}.${key.replace(/Key$/, '')}`;

  return {
    id,
    nameKey: str('nameKey'),
    taglineKey: str('taglineKey'),
    descKey: str('descKey'),
    howKey: str('howKey'),
    weaknessKey: str('weaknessKey'),
    element,
    accentElement,
    starter,
    bias: bias.length > 0 ? bias : [element, accentElement],
  };
}

const PARSED: ArchetypeDefinition[] = (() => {
  if (!Array.isArray(raw)) return [];
  const out: ArchetypeDefinition[] = [];
  for (const item of raw) {
    const parsed = parseArchetype(item);
    if (parsed) out.push(parsed);
  }
  return out;
})();

/** Todos los arquetipos validos, en el orden del archivo. */
export const ARCHETYPES: readonly ArchetypeDefinition[] = PARSED;

/** Busca un arquetipo por id. `undefined` si no existe (o si es el clasico). */
export function getArchetype(id: string): ArchetypeDefinition | undefined {
  if (!id) return undefined;
  return PARSED.find((a) => a.id === id);
}

/**
 * Mazo inicial de un arquetipo, listo para `starterOverrides`.
 *
 * Devuelve `undefined` para el arquetipo clasico: asi el motor usa su mazo
 * `starter` de siempre y no se duplica la tabla de balance aca.
 */
export function starterFor(id: string): ArchetypeStarterEntry[] | undefined {
  const archetype = getArchetype(id);
  if (!archetype) return undefined;
  // Copia defensiva: el motor puede reordenarla (shuffle) y no queremos mutar
  // el modulo de contenido.
  return archetype.starter.map((e) => ({ ...e }));
}

/**
 * Elementos que la tienda debe favorecer para un arquetipo.
 *
 * Devuelve `[]` para el clasico: ese caso NO debe sesgar el sorteo, o el
 * balance historico se rompe para quien no eligio arquetipo.
 */
export function biasFor(id: string): ElementType[] {
  return getArchetype(id)?.bias ?? [];
}
