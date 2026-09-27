/**
 * data/index.ts — Carga de contenido en el navegador / WebView.
 *
 * Usa `import.meta.glob` para descubrir AUTOMATICAMENTE todos los .json de
 * `src/data/cards/`. Esto es lo que cumple la promesa de la Fase 1:
 * agregar 100 cartas nuevas = crear archivos .json, cero cambios de codigo.
 */

import type {
  BlindDefinition,
  CardDefinition,
  ContentBundle,
  JokerDefinition,
} from '@engine/index';

// eager: true -> se resuelven en build time, sin fetch asincrono.
const cardModules = import.meta.glob<CardDefinition[]>('./cards/*.json', {
  eager: true,
  import: 'default',
});

const jokerModules = import.meta.glob<JokerDefinition[]>('./jokers.json', {
  eager: true,
  import: 'default',
});

const mutationModules = import.meta.glob<JokerDefinition[]>('./mutations.json', {
  eager: true,
  import: 'default',
});

const blindModules = import.meta.glob<BlindDefinition[]>('./blinds.json', {
  eager: true,
  import: 'default',
});

function flatten<T>(modules: Record<string, T[]>): T[] {
  return Object.keys(modules)
    .sort()
    .flatMap((key) => modules[key] ?? []);
}

export const contentBundle: ContentBundle = {
  cards: flatten(cardModules),
  jokers: [...flatten(jokerModules), ...flatten(mutationModules)],
  blinds: flatten(blindModules),
};

/** Nombres de archivo cargados (para el panel de debug). */
export const loadedFiles = {
  cards: Object.keys(cardModules).sort(),
  jokers: Object.keys(jokerModules),
  mutations: Object.keys(mutationModules),
  blinds: Object.keys(blindModules),
};
