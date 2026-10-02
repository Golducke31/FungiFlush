/**
 * DeckBuilderScreen.ts — Ver y editar el mazo de la run.
 *
 * Tres operaciones, en orden de frecuencia:
 *   1. **Mejorar** — sube el nivel de una carta pagando una curva geometrica.
 *      Sin techo: "ilimitado" significa que no hay un muro, no que sea gratis.
 *   2. **Evolucionar** — convierte una carta en otra especie cuando cumple su
 *      requisito (nivel o cantidad de jugadas). Irreversible en la run.
 *   3. **Purgar** — elimina una carta para siempre.
 *
 * El panel es una funcion pura de los datos que recibe: no toca el motor ni
 * conoce el registro. Ordenar y filtrar es estado local de la vista.
 */

import type { CardDefinition, CardInstance, Rarity } from '@engine/index';
import { t } from '@i18n/index';
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';
import { createCardCanvas, type CardTextureSpec } from '@render/index';

/** Orden disponible para los filtros del mazo. */
export type DeckSort = 'element' | 'family' | 'rarity' | 'level';

export interface DeckBuilderCallbacks {
  onPurge: (uid: string) => void;
  onUpgrade: (uid: string) => void;
  onEvolve: (uid: string) => void;
  onClose: () => void;
}

/** Lo que la vista necesita saber de cada carta, ya resuelto por el HUD. */
export interface DeckCardInfo {
  /** null = no se puede mejorar (sin tracks o al maximo). */
  upgradeCost: number | null;
  atMaxLevel: boolean;
  /** Texto del boton de evolucion, o null si no hay ninguna. */
  evolveLabel: string | null;
  /** La evolucion se puede hacer ya (se resalta). */
  evolveReady: boolean;
}

export interface DeckBuilderState {
  cards: CardInstance[];
  money: number;
  purgeCost: number;
  canEdit: boolean;
  /** uid -> info de mejora/evolucion. */
  info: Record<string, DeckCardInfo>;
  /** Carta a resaltar tras una accion (feedback visual). */
  highlightUid?: string;
  /**
   * Ilustracion REAL de una carta (el WebP del catalogo). La provee el render,
   * que es quien tiene los assets cargados: la UI no los conoce.
   *
   * Si falta, la celda cae al canvas procedural. Preferimos una silueta
   * distinta a ninguna miniatura, pero la silueta NO es la ilustracion: por eso
   * el camino normal es este.
   */
  cardArt?: (def: CardDefinition) => HTMLImageElement | undefined;
}

const RARITY_RANK: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
  mythic: 4,
};

/** Ordena el mazo segun el modo elegido. El carrusel y el preview lo llaman
 *  a la vez para que el indice de la carta enfocada apunte siempre al mismo
 *  card: el orden visual del anillo es el mismo que el orden del detalle. */
export function sortCards(cards: CardInstance[], mode: DeckSort): CardInstance[] {
  const copy = [...cards];
  copy.sort((a, b) => {
    switch (mode) {
      case 'element':
        return a.def.element.localeCompare(b.def.element) || a.def.id.localeCompare(b.def.id);
      case 'family':
        return a.def.family.localeCompare(b.def.family) || a.def.id.localeCompare(b.def.id);
      case 'rarity':
        return RARITY_RANK[b.def.rarity] - RARITY_RANK[a.def.rarity] || a.def.id.localeCompare(b.def.id);
      case 'level':
        return b.level - a.level || a.def.id.localeCompare(b.def.id);
    }
  });
  return copy;
}

/** Marco DOM del mazo cuando el protagonista es el carrusel 3D. */
export interface DeckCarouselFrame {
  panel: HTMLElement;
  /** Actualiza el detalle con la carta enfocada (la reporta la escena). */
  setFocus: (index: number) => void;
  /**
   * Sincroniza el orden del DOM con el del carrusel: cuando se cambia el
   * orden hay que volver a llamar al preview con la carta enfocada, porque el
   * indice de la escena ya no apunta a la misma carta que antes.
   *
   * `focusUid` (opcional) mantiene el foco en ESA carta: al mejorar una carta,
   * el panel se reconstruye con la lista nueva y hay que volver a pararse en la
   * misma, no en la primera.
   */
  setSorted: (cards: CardInstance[], focusUid?: string) => void;
}

/**
 * Mazo sobre el CARRUSEL 3D.
 *
 * El marco muestra SOLO la carta enfocada (nombre, meta, stats, nivel) y sus
 * acciones; el anillo vive en el canvas, asi que el centro del panel queda
 * libre y sin capturar punteros. Cuando cambia el ORDEN se avisa por
 * `onSorted` para que el carrusel muestre exactamente la misma lista.
 */
export function buildDeckCarouselFrame(
  state: DeckBuilderState,
  callbacks: {
    onPurge: (uid: string) => void;
    onUpgrade: (uid: string) => void;
    onEvolve: (uid: string) => void;
    onClose: () => void;
    onSorted: (cards: CardInstance[]) => void;
  },
): DeckCarouselFrame {
  const panel = document.createElement('div');
  panel.className = 'panel is-deck is-carousel-frame';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('deck.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = `${t('deck.size', { count: state.cards.length })} · ${t('hud.money')} ${state.money}`;

  const toolbar = document.createElement('div');
  toolbar.className = 'deck-toolbar is-floating';

  const detail = document.createElement('div');
  detail.className = 'carousel-detail';
  const detailName = document.createElement('div');
  detailName.className = 'carousel-detail-name';
  const detailMeta = document.createElement('div');
  detailMeta.className = 'carousel-detail-meta';
  const detailStats = document.createElement('div');
  detailStats.className = 'carousel-detail-stats';
  const detailActions = document.createElement('div');
  detailActions.className = 'deck-card-actions';
  detail.append(detailName, detailMeta, detailStats, detailActions);

  const actions = document.createElement('div');
  actions.className = 'panel-actions is-floating';

  let sort: DeckSort = 'element';
  let sorted: CardInstance[] = sortCards(state.cards, sort);

  /**
   * Reordena la lista. `focusUid` permite MANTENER el foco en la carta que el
   * jugador estaba mirando (p. ej. la que acaba de mejorar): sin esto el foco
   * saltaba siempre al indice 0 y la carta mejorada "se iba" a otra posicion
   * del anillo, que es el bug reportado.
   */
  const setSorted = (cards: CardInstance[], focusUid?: string): void => {
    sorted = cards;
    const index = focusUid ? Math.max(0, sorted.findIndex((c) => c.uid === focusUid)) : 0;
    setFocus(index);
  };

  const setFocus = (index: number): void => {
    const card = sorted[index];
    detailActions.innerHTML = '';
    if (!card) {
      detailName.textContent = '';
      detailMeta.textContent = '';
      return;
    }
    const info = state.info[card.uid];
    detailName.textContent = t(card.def.nameKey);
    detailName.style.color = hexToCss(ELEMENT_COLOR[card.def.element] ?? ELEMENT_COLOR.neutral);

    const bits = [
      t(`element.${card.def.element}`),
      t(`family.${card.def.family}`),
      t(`rarity.${card.def.rarity}`),
      t('deck.level', { level: card.level }),
    ];
    if (info?.evolveLabel != null) bits.push(`${card.plays ?? 0}×`);
    detailMeta.textContent = bits.join(' · ');

    // P2/Deck — Substrato y Esporas CON su aumento de nivel. El detalle antes
    // solo listaba elemento/familia/rareza/nivel: el jugador mejoraba la carta
    // y "quedaba igual" porque los numeros que cambian no estaban. Se muestra el
    // total y, entre parentesis, lo ganado por mejoras (`+n`).
    detailStats.innerHTML = '';
    const substrateTotal = card.def.baseSubstrate + card.bonusSubstrate;
    const sporesTotal = card.def.baseSpores + card.bonusSpores;
    const statItems: Array<[string, number, number, string]> = [
      [t('deck.substrate'), substrateTotal, card.bonusSubstrate, '#f2a63b'],
      [t('deck.spores'), sporesTotal, card.bonusSpores, '#4fd18b'],
    ];
    for (const [label, total, bonus, color] of statItems) {
      const stat = document.createElement('span');
      stat.className = 'carousel-detail-stat';
      const value = document.createElement('strong');
      value.style.color = color;
      value.textContent = label === t('deck.spores') ? `x${total}` : String(total);
      stat.appendChild(value);
      if (bonus > 0) {
        const delta = document.createElement('em');
        delta.className = 'carousel-detail-stat-bonus';
        delta.textContent = `+${bonus}`;
        stat.appendChild(delta);
      }
      const tag = document.createElement('span');
      tag.className = 'carousel-detail-stat-label';
      tag.textContent = label;
      stat.appendChild(tag);
      detailStats.appendChild(stat);
    }

    if (info && info.upgradeCost !== null) {
      const upgrade = document.createElement('button');
      upgrade.className = 'btn is-small';
      upgrade.textContent = t('deck.upgrade', { cost: info.upgradeCost });
      upgrade.dataset['act'] = 'upgrade';
      upgrade.dataset['uid'] = card.uid;
      upgrade.disabled = !state.canEdit || state.money < info.upgradeCost;
      upgrade.addEventListener('click', () => callbacks.onUpgrade(card.uid));
      detailActions.appendChild(upgrade);
    } else if (info?.atMaxLevel) {
      const maxed = document.createElement('span');
      maxed.className = 'deck-card-maxed';
      maxed.textContent = t('deck.maxLevel');
      detailActions.appendChild(maxed);
    }

    if (info?.evolveLabel != null) {
      const evolve = document.createElement('button');
      evolve.className = `btn is-small${info.evolveReady ? ' is-evolve' : ' is-ghost'}`;
      evolve.textContent = info.evolveLabel;
      evolve.dataset['act'] = 'evolve';
      evolve.dataset['uid'] = card.uid;
      evolve.disabled = !state.canEdit || !info.evolveReady;
      evolve.addEventListener('click', () => callbacks.onEvolve(card.uid));
      detailActions.appendChild(evolve);
    }

    const purge = document.createElement('button');
    purge.className = 'btn is-ghost is-small';
    purge.textContent = t('deck.purge', { cost: state.purgeCost });
    purge.dataset['act'] = 'purge';
    purge.dataset['uid'] = card.uid;
    purge.disabled = !state.canEdit || state.money < state.purgeCost;
    purge.addEventListener('click', () => callbacks.onPurge(card.uid));
    detailActions.appendChild(purge);
  };

  const sorts: DeckSort[] = ['element', 'family', 'rarity', 'level'];
  for (const mode of sorts) {
    const button = document.createElement('button');
    button.className = `btn is-ghost is-small${mode === sort ? ' is-current' : ''}`;
    button.textContent = t(`deck.sort${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
    button.dataset['act'] = `sort-${mode}`;
    button.addEventListener('click', () => {
      sort = mode;
      for (const sibling of toolbar.querySelectorAll('button')) {
        sibling.classList.toggle('is-current', sibling === button);
      }
      sorted = sortCards(state.cards, sort);
      callbacks.onSorted(sorted);
      setFocus(0);
    });
    toolbar.appendChild(button);
  }

  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  const top = document.createElement('div');
  top.className = 'carousel-top';
  top.append(title, subtitle, toolbar);
  const bottom = document.createElement('div');
  bottom.className = 'carousel-bottom';
  bottom.append(detail, actions);
  panel.append(top, bottom);

  setFocus(0);
  return { panel, setFocus, setSorted };
}

export function buildDeckBuilderPanel(
  state: DeckBuilderState,
  callbacks: DeckBuilderCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-deck';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('deck.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = `${t('deck.size', { count: state.cards.length })} · ${t('hud.money')} ${state.money}`;

  const toolbar = document.createElement('div');
  toolbar.className = 'deck-toolbar';

  const grid = document.createElement('div');
  grid.className = 'deck-grid';

  let sort: DeckSort = 'element';

  const render = () => {
    grid.innerHTML = '';
    const cards = sortCards(state.cards, sort);
    if (cards.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'offer-desc';
      empty.textContent = t('deck.empty');
      grid.appendChild(empty);
      return;
    }

    for (const card of cards) {
      const info = state.info[card.uid];
      const cell = document.createElement('div');
      cell.className = `deck-card${card.uid === state.highlightUid ? ' is-flash' : ''}`;
      cell.dataset['uid'] = card.uid;

      // Ilustracion de la carta. Lo normal es el WebP REAL: la misma imagen que
      // el jugador ve en la mano. Antes esto dibujaba la silueta procedural, o
      // sea que la MISMA carta tenia dos ilustraciones distintas segun donde la
      // miraras. El canvas procedural queda solo como respaldo.
      try {
        const art = document.createElement('img');
        art.className = 'deck-card-art';

        const image = state.cardArt?.(card.def);
        if (image) {
          art.src = image.src;
        } else {
          const spec: CardTextureSpec = {
            kind: 'card',
            name: t(card.def.nameKey),
            desc: t(card.def.descKey),
            element: card.def.element,
            family: card.def.family,
            rarity: card.def.rarity,
            art: card.def.art,
            substrate: card.def.baseSubstrate + card.bonusSubstrate,
            spores: card.def.baseSpores + card.bonusSpores,
            level: card.level,
          };
          const canvas = createCardCanvas(spec);
          try {
            art.src = canvas.toDataURL('image/webp', 0.85);
          } catch {
            art.src = canvas.toDataURL('image/png');
          }
        }

        art.alt = t(card.def.nameKey);
        art.loading = 'lazy';
        cell.appendChild(art);
      } catch {
        // Si el canvas falla (ej. navegador sin webp), seguimos con texto solo.
      }

      const name = document.createElement('div');
      name.className = 'deck-card-name';
      name.textContent = t(card.def.nameKey);
      name.style.color = hexToCss(ELEMENT_COLOR[card.def.element] ?? ELEMENT_COLOR.neutral);

      const meta = document.createElement('div');
      meta.className = 'deck-card-meta';
      meta.textContent = `${t(`element.${card.def.element}`)} · ${t(`family.${card.def.family}`)}`;

      const stats = document.createElement('div');
      stats.className = 'deck-card-stats';
      const substrate = document.createElement('span');
      substrate.style.color = hexToCss(0xf2a63b);
      substrate.textContent = String(card.def.baseSubstrate + card.bonusSubstrate);
      if (card.bonusSubstrate > 0) {
        const delta = document.createElement('em');
        delta.className = 'deck-card-stat-bonus';
        delta.style.color = hexToCss(0xf2a63b);
        delta.textContent = `+${card.bonusSubstrate}`;
        substrate.appendChild(delta);
      }
      const spores = document.createElement('span');
      spores.style.color = hexToCss(0x4fd18b);
      spores.textContent = `x${card.def.baseSpores + card.bonusSpores}`;
      if (card.bonusSpores > 0) {
        const delta = document.createElement('em');
        delta.className = 'deck-card-stat-bonus';
        delta.style.color = hexToCss(0x4fd18b);
        delta.textContent = `+${card.bonusSpores}`;
        spores.appendChild(delta);
      }
      const rarity = document.createElement('span');
      rarity.style.color = hexToCss(RARITY_COLOR[card.def.rarity]);
      rarity.textContent = t(`rarity.${card.def.rarity}`);
      stats.append(substrate, spores, rarity);

      cell.append(name, meta, stats);

      // --- Nivel (y contador de jugadas si la carta tiene una evolucion) ---
      const level = document.createElement('div');
      level.className = 'deck-card-level';
      level.textContent = t('deck.level', { level: card.level });
      cell.appendChild(level);

      const hasEvolution = info?.evolveLabel !== null && info?.evolveLabel !== undefined;
      if (hasEvolution) {
        const plays = document.createElement('div');
        plays.className = 'deck-card-plays';
        plays.textContent = `${card.plays ?? 0}×`;
        plays.title = t('evolve.title');
        cell.appendChild(plays);
      }

      // --- Acciones ---
      const actions = document.createElement('div');
      actions.className = 'deck-card-actions';

      if (info && info.upgradeCost !== null) {
        const upgrade = document.createElement('button');
        upgrade.className = 'btn is-small';
        upgrade.textContent = t('deck.upgrade', { cost: info.upgradeCost });
        upgrade.dataset['act'] = 'upgrade';
        upgrade.dataset['uid'] = card.uid;
        upgrade.disabled = !state.canEdit || state.money < info.upgradeCost;
        upgrade.addEventListener('click', () => callbacks.onUpgrade(card.uid));
        actions.appendChild(upgrade);
      } else if (info?.atMaxLevel) {
        const maxed = document.createElement('span');
        maxed.className = 'deck-card-maxed';
        maxed.textContent = t('deck.maxLevel');
        actions.appendChild(maxed);
      }

      if (hasEvolution) {
        const evolve = document.createElement('button');
        evolve.className = `btn is-small${info.evolveReady ? ' is-evolve' : ' is-ghost'}`;
        evolve.textContent = info.evolveLabel ?? t('evolve.button');
        evolve.dataset['act'] = 'evolve';
        evolve.dataset['uid'] = card.uid;
        evolve.disabled = !state.canEdit || !info.evolveReady;
        evolve.addEventListener('click', () => callbacks.onEvolve(card.uid));
        actions.appendChild(evolve);
      }

      const purge = document.createElement('button');
      purge.className = 'btn is-ghost is-small';
      purge.textContent = t('deck.purge', { cost: state.purgeCost });
      purge.dataset['act'] = 'purge';
      purge.dataset['uid'] = card.uid;
      purge.disabled = !state.canEdit || state.money < state.purgeCost;
      purge.addEventListener('click', () => callbacks.onPurge(card.uid));
      actions.appendChild(purge);

      cell.appendChild(actions);
      grid.appendChild(cell);
    }
  };

  const sorts: DeckSort[] = ['element', 'family', 'rarity', 'level'];
  for (const mode of sorts) {
    const button = document.createElement('button');
    button.className = `btn is-ghost is-small${mode === sort ? ' is-current' : ''}`;
    button.textContent = t(`deck.sort${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
    button.dataset['act'] = `sort-${mode}`;
    button.addEventListener('click', () => {
      sort = mode;
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
