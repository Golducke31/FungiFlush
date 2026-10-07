/**
 * RewardPanel.ts — Draft de recompensa al ganar un blind.
 *
 * Antes, ganar un blind solo daba dinero y un toast. Ahora el flujo es
 * `playing -> reward -> shop`, y esta pantalla es el paso del medio: elegir
 * una carta para el mazo (o saltar, si la tabla lo permite).
 *
 * Es la decision de deckbuilding mas frecuente del juego, asi que muestra lo
 * que importa para decidir: elemento, familia, rareza y valores.
 */

import type { Rarity, ShopOffer } from '@engine/index';
import { t } from '@i18n/index';
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';

export interface RewardCallbacks {
  onPick: (offerId: string) => void;
  onSkip: () => void;
}

/**
 * Cara ya compuesta de una oferta, como data-URL. Lo inyecta el HUD (que tiene
 * el motor y las imagenes del render) para que este panel siga siendo una
 * funcion pura de los datos y no arrastre dependencias.
 */
export type RewardArtFor = (offer: ShopOffer) => string | null;

export interface RewardState {
  offers: ShopOffer[];
  pick: number;
  allowSkip: boolean;
  /** Cuantas ya se tomaron (para drafts de mas de una carta). */
  taken: number;
  /** Compositor opcional de la cara de cada carta. */
  artFor?: RewardArtFor;
}

export function buildRewardPanel(state: RewardState, callbacks: RewardCallbacks): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-reward';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('reward.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = t('reward.subtitle');

  const grid = document.createElement('div');
  grid.className = 'reward-grid';

  for (const offer of state.offers) {
    const card = document.createElement('div');
    card.className = `reward-card${offer.sold ? ' is-sold' : ''}`;

    // La cara real de la carta arriba de todo: es lo que el jugador va a tener
    // en la mano. Sin arte (voucher, o render sin la imagen) no se reserva el
    // hueco: la tarjeta se achica sola.
    const artUrl = state.artFor?.(offer) ?? null;
    if (artUrl) {
      const frame = document.createElement('div');
      frame.className = 'reward-art';
      const img = document.createElement('img');
      img.className = 'reward-art-img';
      img.src = artUrl;
      img.alt = t(offer.nameKey);
      img.loading = 'lazy';
      img.draggable = false;
      frame.appendChild(img);
      card.appendChild(frame);
    }

    const element = document.createElement('div');
    element.className = 'reward-element';
    element.style.background = hexToCss(ELEMENT_COLOR.neutral);

    const name = document.createElement('div');
    name.className = 'reward-name';
    name.textContent = t(offer.nameKey);
    name.style.color = hexToCss(RARITY_COLOR[offer.rarity ?? 'common']);

    const desc = document.createElement('div');
    desc.className = 'reward-desc';
    desc.textContent = t(offer.descKey);

    const take = document.createElement('button');
    take.className = 'btn is-play';
    take.textContent = offer.sold ? t('reward.taken') : t('reward.pick');
    take.disabled = offer.sold;
    take.dataset['act'] = 'pick';
    take.dataset['offer'] = offer.id;
    take.addEventListener('click', () => callbacks.onPick(offer.id));

    card.append(element, name, desc, take);
    grid.appendChild(card);
  }

  const actions = document.createElement('div');
  actions.className = 'panel-actions';

  if (state.allowSkip) {
    const hint = document.createElement('span');
    hint.className = 'panel-subtitle';
    hint.style.margin = '0';
    hint.textContent = t('reward.skipHint');

    const skip = document.createElement('button');
    skip.className = 'btn is-ghost';
    skip.textContent = t('reward.skip');
    skip.dataset['act'] = 'skip';
    skip.addEventListener('click', () => callbacks.onSkip());

    actions.append(hint, skip);
  }

  panel.append(title, subtitle, grid, actions);
  return panel;
}

/** Rareza de una oferta, con fallback seguro. */
export function rarityOfOffer(offer: ShopOffer): Rarity {
  return offer.rarity ?? 'common';
}

/**
 * Frame del draft de recompensa con las 3 ofertas en un CARRUSEL 3D horizontal.
 *
 * POR QUE EXISTE: en landscape movil (915x412) la fila `.reward-grid` de
 * tarjetas DOM usaba `width: clamp(96px, 27vh, 118px)` por tarjeta, o sea unos
 * 357px de los ~847px utiles (~58% del ancho desperdiciado) y ademas dibujaba
 * el arte recortado en una ventana 2:3. Aqui las 3 cartas son `Card3D` REALES
 * (la misma cara que el jugador tendra en la mano, a tamano completo) puestas
 * en un arco, y el panel DOM solo aporta el marco: titulo arriba, accion abajo.
 *
 * El centro queda LIBRE para el anillo: por eso el panel es
 * `.panel.is-carousel-frame` (cabecera y pie absolutos, `pointer-events:none`)
 * y los callbacks de seleccion viajan al `SceneManager` por `onFocus`.
 */
export interface RewardCarouselFrame {
  panel: HTMLElement;
  /**
   * Refleja en el pie cual es la oferta ENFOCADA. El anillo llama a esto cada
   * vez que cambia el foco, para que el nombre/precio del boton correspondan a
   * la carta que el jugador tiene centrada.
   */
  setFocus: (index: number) => void;
}

export function buildRewardCarouselFrame(
  state: RewardState,
  callbacks: RewardCallbacks,
): RewardCarouselFrame {
  const panel = document.createElement('div');
  panel.className = 'panel is-reward is-carousel-frame';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('reward.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = t('reward.subtitle');

  const top = document.createElement('div');
  top.className = 'carousel-top';
  top.append(title, subtitle);

  // Detalle de la oferta enfocada: nombre + rareza + descripcion. Sin esto el
  // anillo sola no dice QUE se esta eligiendo; la cara 3D ya trae nombre y
  // numeros, pero no la descripcion larga de la habilidad.
  const detail = document.createElement('div');
  detail.className = 'carousel-detail reward-carousel-detail';
  const detailName = document.createElement('div');
  detailName.className = 'carousel-detail-name';
  const detailMeta = document.createElement('div');
  detailMeta.className = 'carousel-detail-meta';
  const detailDesc = document.createElement('div');
  detailDesc.className = 'reward-carousel-desc';
  detail.append(detailName, detailMeta, detailDesc);

  const actions = document.createElement('div');
  actions.className = 'panel-actions is-floating';

  const pick = document.createElement('button');
  pick.className = 'btn is-play';
  pick.dataset['act'] = 'pick';

  const skipHint = document.createElement('span');
  skipHint.className = 'panel-subtitle';
  skipHint.style.margin = '0';
  skipHint.textContent = t('reward.skipHint');

  const skip = document.createElement('button');
  skip.className = 'btn is-ghost';
  skip.textContent = t('reward.skip');
  skip.dataset['act'] = 'skip';
  skip.addEventListener('click', () => callbacks.onSkip());

  let focusIndex = 0;

  /** Recoloca el boton de elegir sobre la oferta enfocada. */
  const setFocus = (index: number): void => {
    const offer = state.offers[index];
    focusIndex = index;
    if (!offer) {
      detailName.textContent = '';
      detailMeta.textContent = '';
      detailDesc.textContent = '';
      pick.disabled = true;
      return;
    }
    detailName.textContent = t(offer.nameKey);
    detailName.style.color = hexToCss(RARITY_COLOR[offer.rarity ?? 'common']);
    detailMeta.textContent = t(`rarity.${offer.rarity ?? 'common'}`);
    detailDesc.textContent = t(offer.descKey);
    // El "pick:1" de la tabla se respeta: una oferta ya tomada no se puede
    // volver a elegir, y el boton lo dice.
    pick.textContent = offer.sold ? t('reward.taken') : t('reward.pick');
    pick.disabled = offer.sold;
    pick.dataset['offer'] = offer.id;
  };

  // El boton se re-engancha en cada cambio de foco: conserva el ULTIMO indice
  // enfocado, que es el que el jugador ve centrado.
  pick.addEventListener('click', () => {
    const offer = state.offers[focusIndex];
    if (offer && !offer.sold) callbacks.onPick(offer.id);
  });

  actions.append(pick);
  if (state.allowSkip) actions.append(skipHint, skip);

  const bottom = document.createElement('div');
  bottom.className = 'carousel-bottom';
  bottom.append(detail, actions);

  panel.append(top, bottom);
  setFocus(0);
  return { panel, setFocus };
}
