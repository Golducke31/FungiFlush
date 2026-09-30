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

export type CollectionState = 'owned' | 'locked' | 'hidden' | 'unlocked';

export interface CollectionEntry {
  id: string;
  nameKey: string;
  element: ElementType;
  rarity: Rarity;
  kind: 'card' | 'joker';
  state: CollectionState;
  /** Clave i18n del pack que aporta el contenido (para el rotulo de bloqueo). */
  packTitleKey?: string;
  /** Origen del desbloqueo de retencion ('daily' | 'achievement' | 'season'). */
  unlockSource?: string;
  /** El jugador ya la vio en una partida. */
  seen: boolean;
}

export interface CollectionCallbacks {
  onClose: () => void;
  /** Opcional: abrir la tienda de expansiones desde una carta bloqueada. */
  onOpenStore?: () => void;
  /** Opcional: abrir el pase de temporada. */
  onOpenPass?: () => void;
}

type Filter = 'all' | 'cards' | 'jokers' | 'locked' | 'unlocked';

/** Marco DOM de la coleccion cuando el protagonista es el carrusel 3D. */
export interface CollectionCarouselFrame {
  panel: HTMLElement;
  /** Actualiza el recuadro de detalle con la entrada enfocada. */
  setFocus: (index: number) => void;
}

/**
 * Coleccion sobre el CARRUSEL 3D.
 *
 * El panel es un MARCO: titulo, chips de filtro, detalle de la carta enfocada y
 * cerrar. El centro queda libre y sin capturar punteros, porque ahi vive el
 * anillo (canvas): rueda, arrastre y tap llegan a la escena, no al DOM.
 *
 * No dibuja cartas: cuando cambia el filtro avisa por `onFiltered` para que el
 * controlador vuelva a alimentar el carrusel.
 */
export function buildCollectionCarousel(
  entries: CollectionEntry[],
  callbacks: {
    onClose: () => void;
    onFiltered: (filtered: CollectionEntry[]) => void;
    onOpenStore?: () => void;
    onOpenPass?: () => void;
  },
): CollectionCarouselFrame {
  const panel = document.createElement('div');
  panel.className = 'panel is-collection is-carousel-frame';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('collection.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';

  const toolbar = document.createElement('div');
  toolbar.className = 'deck-toolbar is-floating';

  // Detalle de la carta enfocada: va abajo, para no tapar el anillo.
  const detail = document.createElement('div');
  detail.className = 'carousel-detail';
  const detailName = document.createElement('div');
  detailName.className = 'carousel-detail-name';
  const detailMeta = document.createElement('div');
  detailMeta.className = 'carousel-detail-meta';
  detail.append(detailName, detailMeta);

  const actions = document.createElement('div');
  actions.className = 'panel-actions is-floating';

  let filter: Filter = 'all';
  let filtered: CollectionEntry[] = [];

  const applyFilter = (): CollectionEntry[] => {
    const visible = entries.filter((e) => e.state !== 'hidden');
    filtered = visible.filter((entry) => {
      if (filter === 'cards') return entry.kind === 'card';
      if (filter === 'jokers') return entry.kind === 'joker';
      if (filter === 'locked') return entry.state === 'locked';
      if (filter === 'unlocked') return entry.state === 'unlocked';
      return true;
    });
    const seenCount = filtered.filter((e) => e.seen).length;
    subtitle.textContent = t('collection.seen', { seen: seenCount, total: filtered.length });
    return filtered;
  };

  const setFocus = (index: number): void => {
    const entry = filtered[index];
    if (!entry) {
      detailName.textContent = '';
      detailMeta.textContent = '';
      return;
    }
    detailName.textContent = entry.seen ? t(entry.nameKey) : t('collection.unknown');
    detailName.style.color = entry.seen
      ? hexToCss(RARITY_COLOR[entry.rarity] ?? ELEMENT_COLOR.neutral)
      : 'var(--frame-dim)';
    const kind = entry.kind === 'joker' ? t('collection.jokers') : t('collection.cards');
    const state =
      entry.state === 'locked'
        ? t('collection.locked', { pack: entry.packTitleKey ? t(entry.packTitleKey) : entry.id })
        : entry.state === 'unlocked' && entry.unlockSource
          ? `${t('collection.unlocked')} · ${t(`collection.unlockSource.${entry.unlockSource}`)}`
          : '';
    detailMeta.textContent = state ? `${kind} · ${state}` : kind;
  };

  const filters: Array<[Filter, string]> = [
    ['all', 'collection.all'],
    ['cards', 'collection.cards'],
    ['jokers', 'collection.jokers'],
    ['locked', 'collection.locked'],
    ['unlocked', 'collection.unlocked'],
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
      const list = applyFilter();
      callbacks.onFiltered(list);
      setFocus(0);
    });
    toolbar.appendChild(button);
  }

  if (callbacks.onOpenStore) {
    const store = document.createElement('button');
    store.className = 'btn is-ghost';
    store.textContent = t('menu.expansions');
    store.dataset['act'] = 'expansions';
    store.addEventListener('click', () => callbacks.onOpenStore?.());
    actions.appendChild(store);
  }
  if (callbacks.onOpenPass) {
    const pass = document.createElement('button');
    pass.className = 'btn is-ghost';
    pass.textContent = t('menu.pass');
    pass.dataset['act'] = 'pass';
    pass.addEventListener('click', () => callbacks.onOpenPass?.());
    actions.appendChild(pass);
  }

  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  // El CENTRO del panel queda VACIO a proposito: ahi vive el anillo y tiene que
  // recibir rueda/arrastre/tap. Todo lo interactivo se agrupa arriba o abajo.
  const top = document.createElement('div');
  top.className = 'carousel-top';
  top.append(title, subtitle, toolbar);
  const bottom = document.createElement('div');
  bottom.className = 'carousel-bottom';
  bottom.append(detail, actions);
  panel.append(top, bottom);

  applyFilter();
  setFocus(0);

  return { panel, setFocus };
}

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
      if (filter === 'unlocked') return entry.state === 'unlocked';
      return true;
    });

    for (const entry of list) {
      const cell = document.createElement('div');
      const locked = entry.state === 'locked';
      const unlocked = entry.state === 'unlocked';
      // Un desbloqueo de retencion se muestra completo aunque tecnicamente no
      // lo hayas "visto": lo ganaste, es tuyo.
      const undiscovered = !entry.seen && !locked && !unlocked;
      cell.className = `collection-card${locked ? ' is-locked' : ''}${unlocked ? ' is-unlocked' : ''}${undiscovered ? ' is-unknown' : ''}`;

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
      } else if (unlocked && entry.unlockSource) {
        // "Desbloqueado · Racha diaria" — distinto del candado generico.
        const badge = document.createElement('span');
        badge.className = 'collection-unlock';
        badge.textContent = `${t('collection.unlocked')} · ${t('collection.unlockSource.' + entry.unlockSource)}`;
        cell.appendChild(badge);
      }

      grid.appendChild(cell);
    }
  };

  const filters: Array<[Filter, string]> = [
    ['all', 'collection.all'],
    ['cards', 'collection.cards'],
    ['jokers', 'collection.jokers'],
    ['locked', 'collection.locked'],
    ['unlocked', 'collection.unlocked'],
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

  // La tienda de expansiones y el pase viven aca: son contenido, y esta es la
  // pantalla de contenido. Asi ya no ocupan lugar en el menu principal.
  if (callbacks.onOpenStore) {
    const store = document.createElement('button');
    store.className = 'btn is-ghost';
    store.textContent = t('menu.expansions');
    store.dataset['act'] = 'expansions';
    store.addEventListener('click', () => callbacks.onOpenStore?.());
    actions.appendChild(store);
  }
  if (callbacks.onOpenPass) {
    const pass = document.createElement('button');
    pass.className = 'btn is-ghost';
    pass.textContent = t('menu.pass');
    pass.dataset['act'] = 'pass';
    pass.addEventListener('click', () => callbacks.onOpenPass?.());
    actions.appendChild(pass);
  }

  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  panel.append(title, subtitle, toolbar, grid, actions);
  return panel;
}
