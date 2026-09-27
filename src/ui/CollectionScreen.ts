/**
 * CollectionScreen.ts — La coleccion permanente del jugador.
 *
 * Dos cosas que la hacen valiosa mas alla de "una lista de cartas":
 *
 *  1. **Muestra lo que falta.** Una carta no descubierta aparece como silueta:
 *     da un objetivo concreto ("me faltan 3 amanitas").
 *  2. **Muestra lo bloqueado con el nombre del pack.** El contenido de un DLC
 *     que no se compro se ve grisado y con su origen. Es la superficie de venta
 *     dentro del juego: un DLC que no se ve no se vende.
 *
 * El panel no conoce ni el registro ni los entitlements: recibe entradas ya
 * resueltas. Eso lo mantiene testeable y desacoplado.
 */

import type { ElementType, Rarity } from '@engine/index';
import { t } from '@i18n/index';
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';

export type CollectionState = 'owned' | 'locked' | 'hidden';

export interface CollectionEntry {
  id: string;
  nameKey: string;
  element: ElementType;
  rarity: Rarity;
  kind: 'card' | 'joker';
  state: CollectionState;
  /** Clave i18n del pack que aporta el contenido (para el rotulo de bloqueo). */
  packTitleKey?: string;
  /** El jugador ya la vio en una partida. */
  seen: boolean;
}

export interface CollectionCallbacks {
  onClose: () => void;
  /** Opcional: abrir la tienda de expansiones desde una carta bloqueada. */
  onOpenStore?: () => void;
}

type Filter = 'all' | 'cards' | 'jokers' | 'locked';

export function buildCollectionPanel(
  entries: CollectionEntry[],
  callbacks: CollectionCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-collection';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('collection.title');

  const seenCount = entries.filter((e) => e.seen && e.state !== 'hidden').length;
  const visible = entries.filter((e) => e.state !== 'hidden');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = t('collection.seen', { seen: seenCount, total: visible.length });

  const toolbar = document.createElement('div');
  toolbar.className = 'deck-toolbar';

  const grid = document.createElement('div');
  grid.className = 'collection-grid';

  let filter: Filter = 'all';

  const render = () => {
    grid.innerHTML = '';
    const list = visible.filter((entry) => {
      if (filter === 'cards') return entry.kind === 'card';
      if (filter === 'jokers') return entry.kind === 'joker';
      if (filter === 'locked') return entry.state === 'locked';
      return true;
    });

    for (const entry of list) {
      const cell = document.createElement('div');
      const locked = entry.state === 'locked';
      const undiscovered = !entry.seen && !locked;
      cell.className = `collection-card${locked ? ' is-locked' : ''}${undiscovered ? ' is-unknown' : ''}`;

      const swatch = document.createElement('span');
      swatch.className = 'collection-swatch';
      swatch.style.background = hexToCss(
        locked ? 0x2a3440 : ELEMENT_COLOR[entry.element] ?? ELEMENT_COLOR.neutral,
      );

      const name = document.createElement('span');
      name.className = 'collection-name';
      name.textContent = undiscovered ? t('collection.unknown') : t(entry.nameKey);
      name.style.color = locked
        ? 'var(--dim)'
        : undiscovered
          ? 'var(--dim)'
          : hexToCss(RARITY_COLOR[entry.rarity] ?? ELEMENT_COLOR.neutral);

      cell.append(swatch, name);

      if (locked) {
        const badge = document.createElement('span');
        badge.className = 'collection-lock';
        badge.textContent = t('collection.locked', {
          pack: entry.packTitleKey ? t(entry.packTitleKey) : entry.id,
        });
        cell.appendChild(badge);
        if (callbacks.onOpenStore) {
          cell.addEventListener('click', () => callbacks.onOpenStore?.());
          cell.classList.add('is-clickable');
        }
      }

      grid.appendChild(cell);
    }
  };

  const filters: Array<[Filter, string]> = [
    ['all', 'collection.all'],
    ['cards', 'collection.cards'],
    ['jokers', 'collection.jokers'],
    ['locked', 'collection.locked'],
  ];
  for (const [mode, key] of filters) {
    const button = document.createElement('button');
    button.className = `btn is-ghost is-small${mode === filter ? ' is-current' : ''}`;
    button.textContent = mode === 'locked' ? t('store.locked') : t(key);
    button.dataset['act'] = `filter-${mode}`;
    button.addEventListener('click', () => {
      filter = mode;
      for (const sibling of toolbar.querySelectorAll('button')) {
        sibling.classList.toggle('is-current', sibling === button);
      }
      render();
    });
    toolbar.appendChild(button);
  }

  render();

  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  panel.append(title, subtitle, toolbar, grid, actions);
  return panel;
}
