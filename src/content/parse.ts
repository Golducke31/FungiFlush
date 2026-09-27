/**
 * parse.ts — Convierte un pack crudo (manifiesto + archivos) en contenido tipado.
 *
 * Esta en un modulo aparte y sin `import.meta.glob` a proposito: el harness de
 * Node (`tools/`) tambien lo usa, y ahi no existe el glob de Vite.
 */

import type {
  BlindDefinition,
  CardDefinition,
  EvolutionRule,
  JokerDefinition,
  UpgradeTrack,
} from '@engine/index';
import type { BoardCardDef } from '@engine/board/types';

import type { AnteRow, LoadedPack, OfferTable, RawPack } from './types';

function asArray<T>(value: unknown, where: string): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`[content] ${where} deberia ser un array.`);
  }
  return value as T[];
}

/** Lee un archivo declarado en el manifiesto. Falta = error: el manifiesto miente. */
function read<T>(pack: RawPack, path: string): T[] {
  const raw = pack.files[path];
  if (raw === undefined) {
    throw new Error(`[content] El pack "${pack.manifest.id}" declara "${path}" pero el archivo no existe.`);
  }
  return asArray<T>(raw, `${pack.manifest.id}:${path}`);
}

export function parsePack(pack: RawPack): LoadedPack {
  const { manifest } = pack;
  const contents = manifest.contents ?? {};

  const cards: CardDefinition[] = [];
  for (const path of contents.cards ?? []) cards.push(...read<CardDefinition>(pack, path));

  const jokers: JokerDefinition[] = [];
  for (const path of contents.jokers ?? []) jokers.push(...read<JokerDefinition>(pack, path));

  const mutations: JokerDefinition[] = [];
  for (const path of contents.mutations ?? []) mutations.push(...read<JokerDefinition>(pack, path));

  const blinds: BlindDefinition[] = [];
  for (const path of contents.blinds ?? []) blinds.push(...read<BlindDefinition>(pack, path));

  const offers: OfferTable[] = [];
  for (const path of contents.offers ?? []) offers.push(...read<OfferTable>(pack, path));

  const antes: AnteRow[] = [];
  for (const path of contents.antes ?? []) antes.push(...read<AnteRow>(pack, path));

  const upgrades: UpgradeTrack[] = [];
  for (const path of contents.upgrades ?? []) upgrades.push(...read<UpgradeTrack>(pack, path));

  const evolutions: EvolutionRule[] = [];
  for (const path of contents.evolutions ?? []) evolutions.push(...read<EvolutionRule>(pack, path));

  const board: BoardCardDef[] = [];
  for (const path of contents.board ?? []) board.push(...read<BoardCardDef>(pack, path));

  return {
    ...pack,
    cards,
    jokers,
    mutations,
    blinds,
    offers,
    antes,
    upgrades,
    evolutions,
    board,
  };
}
