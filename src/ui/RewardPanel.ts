/**
 * RewardPanel.ts — Draft de recompensa al ganar un blind.
 *
 * El flujo es `playing -> reward -> shop`, y esta pantalla es el paso del
 * medio: elegir una carta para el mazo (o saltar, si la tabla lo permite).
 *
 * POR QUE USA EL MISMO MARKUP QUE LA TIENDA
 * -----------------------------------------
 * Antes la recompensa se dibujaba en un CARRUSEL 3D propio (arcos de `Card3D`
 * sobre el canvas). El problema no era el arte — era que el jugador tenia que
 * aprender DOS lenguajes para la misma decision ("elegir una carta entre N") y
 * la de la tienda es la que ve mucho mas seguido. Ahora comparte el grid
 * `.offer-grid` / `.offer` del Mercado del Micelio: la cara de la carta es la
 * ficha, y el pie trae el boton en vez del precio.
 *
 * Sigue siendo una funcion PURA de los datos: no conoce el motor ni las
 * imagenes. La cara la inyecta el HUD por `artFor` y la etiqueta de clase por
 * `labelFor`.
 */

import type { Rarity, ShopOffer } from '@engine/index';
import { t } from '@i18n/index';

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

/** Etiqueta legible de la clase de oferta. La resuelve el HUD (`offerLabel`). */
export type RewardLabelFor = (kind: ShopOffer['kind']) => string;

export interface RewardState {
  offers: ShopOffer[];
  pick: number;
  allowSkip: boolean;
  /** Cuantas ya se tomaron (para drafts de mas de una carta). */
  taken: number;
  /** Compositor opcional de la cara de cada carta. */
  artFor?: RewardArtFor;
  /** Etiqueta de clase para `data-kind-label` / `aria-label`. */
  labelFor?: RewardLabelFor;
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

  // Mismo grid que la tienda: `--offer-cols` = numero de ofertas, para que la
  // fila llene SIEMPRE el ancho del panel.
  const grid = document.createElement('div');
  grid.className = 'offer-grid';
  if (state.offers.length > 0) {
    grid.style.setProperty('--offer-cols', String(Math.min(6, state.offers.length)));
  }

  for (const offer of state.offers) {
    const card = document.createElement('div');
    card.className = `offer${offer.sold ? ' is-sold' : ''}`;
    if (offer.kind === 'voucher') card.classList.add('is-voucher');

    // La cara REAL de la carta: es lo que el jugador va a tener en la mano.
    const artUrl = state.artFor?.(offer) ?? null;
    if (artUrl) {
      const art = document.createElement('img');
      art.className = 'offer-art';
      art.src = artUrl;
      art.alt = t(offer.nameKey);
      art.loading = 'lazy';
      art.draggable = false;
      card.appendChild(art);
    } else {
      // Sin cara no se colapsa la tarjeta: el hueco mantiene la fila pareja.
      const spacer = document.createElement('div');
      spacer.className = 'offer-art is-placeholder';
      spacer.setAttribute('aria-hidden', 'true');
      card.appendChild(spacer);
    }

    // La cara ya trae nombre, habilidad y numeros: aca solo van el boton y los
    // ganchos de accesibilidad (un lector de pantalla no ve la cara, y el smoke
    // verifica la traduccion por `data-kind-label`).
    const kindLabel = state.labelFor?.(offer.kind) ?? offer.kind.toUpperCase();
    card.dataset['kind'] = offer.kind;
    card.dataset['kindLabel'] = kindLabel;
    card.setAttribute('aria-label', `${kindLabel}: ${t(offer.nameKey)}`);

    const footer = document.createElement('div');
    footer.className = 'offer-footer';

    const take = document.createElement('button');
    take.className = 'btn is-small';
    take.textContent = offer.sold ? t('reward.taken') : t('reward.pick');
    take.disabled = offer.sold;
    take.dataset['act'] = 'pick';
    take.dataset['offer'] = offer.id;
    take.addEventListener('click', () => callbacks.onPick(offer.id));

    footer.appendChild(take);
    card.appendChild(footer);

    // Sello de "ya elegida", en el mismo lenguaje que el de la tienda.
    const stamp = document.createElement('span');
    stamp.className = 'offer-sold';
    stamp.textContent = t('reward.taken');
    stamp.hidden = !offer.sold;
    card.appendChild(stamp);

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
