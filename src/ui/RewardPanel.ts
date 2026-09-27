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

export interface RewardState {
  offers: ShopOffer[];
  pick: number;
  allowSkip: boolean;
  /** Cuantas ya se tomaron (para drafts de mas de una carta). */
  taken: number;
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
