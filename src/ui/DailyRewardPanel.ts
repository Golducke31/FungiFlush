/**
 * DailyRewardPanel.ts — Recompensa diaria y escalera de racha.
 *
 * Espejo de `buildCollectionPanel`: recibe TODO resuelto y no conoce el
 * perfil ni el registro de contenido. El nombre de la recompensa lo traduce
 * `nameOf` (que inyecta el controlador, el unico que tiene el registry).
 *
 * Disenado para HORIZONTAL: la escalera de 7 dias es una FILA, no una columna.
 * En landscape de celular el alto es el recurso escaso, asi que nada de esto
 * puede crecer hacia abajo.
 */

import { t } from '@i18n/index';
import type { DailyEvaluation, DailyRewardTable } from '../retention/DailyReward';
import type { RetentionReward } from '../retention/types';

export interface DailyPanelCallbacks {
  onClaim: () => void;
  onClose: () => void;
  /** Nombre legible de un reward (lo resuelve el controlador). */
  nameOf: (reward: RetentionReward) => string;
}

export function buildDailyRewardPanel(
  state: DailyEvaluation,
  table: DailyRewardTable,
  callbacks: DailyPanelCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-daily';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('daily.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = t('daily.subtitle', {
    streak: state.streak,
    best: state.bestStreak,
  });

  // --- Escalera de la racha: una fila de 7 ---
  const ladder = document.createElement('div');
  ladder.className = 'daily-ladder';

  const currentIndex = state.day - 1;
  for (let index = 0; index < table.cycleDays; index++) {
    const reward = table.rewards.find((entry) => entry.day === index + 1)?.reward ?? null;

    const cell = document.createElement('div');
    const done = index < currentIndex || (state.alreadyClaimedToday && index === currentIndex);
    cell.className = `daily-day${done ? ' is-done' : ''}${
      index === currentIndex ? ' is-current' : ''
    }`;

    const dayLabel = document.createElement('span');
    dayLabel.className = 'daily-day-number';
    dayLabel.textContent = t('daily.day', { day: index + 1 });

    const name = document.createElement('span');
    name.className = 'daily-day-name';
    name.textContent = reward ? callbacks.nameOf(reward) : '—';

    cell.append(dayLabel, name);
    ladder.appendChild(cell);
  }

  // --- Recompensa de hoy ---
  const focus = document.createElement('div');
  focus.className = 'daily-focus';

  const focusLabel = document.createElement('span');
  focusLabel.className = 'daily-focus-label';
  focusLabel.textContent = t('daily.reward');

  const focusName = document.createElement('strong');
  focusName.className = 'daily-focus-name';
  focusName.textContent = state.reward ? callbacks.nameOf(state.reward) : t('daily.empty');

  focus.append(focusLabel, focusName);

  const status = document.createElement('p');
  status.className = 'daily-status';
  status.textContent = state.alreadyClaimedToday ? t('daily.claimedToday') : t('daily.ready');

  // --- Acciones ---
  const actions = document.createElement('div');
  actions.className = 'panel-actions';

  const claim = document.createElement('button');
  claim.className = 'btn is-play';
  claim.dataset['act'] = 'daily-claim';
  claim.textContent = state.alreadyClaimedToday ? t('daily.claimed') : t('daily.claim');
  claim.disabled = state.alreadyClaimedToday;
  claim.addEventListener('click', () => callbacks.onClaim());
  actions.appendChild(claim);

  const close = document.createElement('button');
  close.className = 'btn is-ghost';
  close.dataset['act'] = 'daily-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  panel.append(title, subtitle, ladder, focus, status, actions);
  return panel;
}
