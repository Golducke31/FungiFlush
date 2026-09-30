/**
 * EventPassPanel.ts — El Pase de Temporada (P4).
 *
 * Lista los tiers de la temporada activa con su recompensa y el estado de
 * cada uno (reclamado / reclamable / bloqueado por XP). La barra de progreso
 * va del nivel actual al siguiente. El panel no conoce el perfil: recibe el
 * PassState ya resuelto y un `rewardName` para traducir ids a nombres.
 */

import { t } from '@i18n/index';
import type { RetentionReward } from '@retention/types';
import type { SeasonDef, SeasonTierView } from '@retention/SeasonTracker';

interface PassStateLike {
  xp: number;
  claimed: string[];
}

export interface PassCallbacks {
  onClaim: (level: number) => void;
  onClose: () => void;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function buildPassPanel(
  def: SeasonDef,
  pass: PassStateLike,
  rewardName: (reward: RetentionReward) => string,
  callbacks: PassCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-pass';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t(def.nameKey);

  // --- Barra de XP: del nivel actual al siguiente ---
  const reached = def.tiers.filter((tier) => pass.xp >= tier.xp).length;
  const next = def.tiers.find((tier) => tier.xp > pass.xp);
  const prevXp = reached > 0 ? def.tiers[reached - 1]?.xp ?? 0 : 0;
  const nextXp = next ? next.xp : pass.xp;
  const pct = next ? clampPct(((pass.xp - prevXp) / (nextXp - prevXp)) * 100) : 100;

  const xpRow = document.createElement('div');
  xpRow.className = 'pass-xp';
  const xpLabel = document.createElement('span');
  xpLabel.className = 'pass-xp-label';
  xpLabel.textContent = next
    ? t('pass.xp', { current: pass.xp, required: next.xp })
    : `${pass.xp} XP`;
  const xpBar = document.createElement('div');
  xpBar.className = 'pass-xp-bar';
  const xpFill = document.createElement('div');
  xpFill.className = 'pass-xp-fill';
  xpFill.style.width = `${pct}%`;
  xpBar.appendChild(xpFill);
  xpRow.append(xpLabel, xpBar);

  const grid = document.createElement('div');
  grid.className = 'pass-tiers';

  const views: SeasonTierView[] = def.tiers.map((tier) => {
    const claimed = pass.claimed.includes(`f${tier.level}`);
    const reachedTier = pass.xp >= tier.xp;
    const state = claimed ? 'claimed' : reachedTier ? 'claimable' : 'locked';
    return { level: tier.level, xp: tier.xp, reward: tier.reward, state };
  });

  for (const view of views) {
    const cell = document.createElement('div');
    cell.className = `pass-tier is-${view.state}`;

    const head = document.createElement('div');
    head.className = 'pass-tier-head';
    const lvl = document.createElement('span');
    lvl.className = 'pass-tier-level';
    lvl.textContent = t('pass.tier', { n: view.level });
    head.appendChild(lvl);

    const reward = document.createElement('span');
    reward.className = 'pass-tier-reward';
    reward.textContent = rewardName(view.reward);
    cell.appendChild(head);
    cell.appendChild(reward);

    const action = document.createElement('div');
    action.className = 'pass-tier-action';
    if (view.state === 'claimed') {
      const done = document.createElement('span');
      done.className = 'pass-tier-done';
      done.textContent = t('pass.claimed');
      action.appendChild(done);
    } else if (view.state === 'claimable') {
      const btn = document.createElement('button');
      btn.className = 'btn is-ghost is-small';
      btn.textContent = t('pass.claim');
      btn.dataset['act'] = `claim-${view.level}`;
      btn.addEventListener('click', () => callbacks.onClaim(view.level));
      action.appendChild(btn);
    } else {
      const lock = document.createElement('span');
      lock.className = 'pass-tier-lock';
      lock.textContent = t('pass.requireXp', { xp: view.xp });
      action.appendChild(lock);
    }
    cell.appendChild(action);

    grid.appendChild(cell);
  }

  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  panel.append(title, xpRow, grid, actions);
  return panel;
}
