/**
 * AchievementsScreen.ts — Logros del perfil.
 *
 * Igual que la coleccion: recibe las entradas YA resueltas (nombre y
 * descripcion traducidos, progreso, si esta desbloqueado) y solo dibuja. Quien
 * sabe de logros es `src/retention/AchievementTracker.ts`.
 *
 * Landscape-first: grilla que se reparte en columnas y se scrollea en vertical
 * SOLO si no entra. El alto en horizontal es corto, asi que el area de la lista
 * tiene un tope en `vh` y el panel nunca empuja los botones fuera.
 */

import { t } from '@i18n/index';

export interface AchievementView {
  id: string;
  name: string;
  desc: string;
  unlocked: boolean;
  /** Progreso parcial de un logro incremental (0 si no aplica). */
  current: number;
  /** Meta del incremental. 0 = no es incremental. */
  max: number;
  /** Nombre del desbloqueo que otorga, o null si no da nada. */
  rewardLabel: string | null;
}

export interface AchievementsCallbacks {
  onClose: () => void;
}

export function buildAchievementsPanel(
  entries: AchievementView[],
  callbacks: AchievementsCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-achievements';

  const unlocked = entries.filter((e) => e.unlocked).length;

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('achievement.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = t('achievement.total', { unlocked, total: entries.length });

  const grid = document.createElement('div');
  grid.className = 'achievement-grid';

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'offer-desc';
    empty.textContent = t('achievement.empty');
    grid.appendChild(empty);
  }

  // Primero lo que YA se logro: es lo que se viene a mirar. Despues lo que
  // falta, que es la lista de objetivos.
  const ordered = [...entries].sort(
    (a, b) => Number(b.unlocked) - Number(a.unlocked) || a.id.localeCompare(b.id),
  );

  for (const entry of ordered) {
    const cell = document.createElement('div');
    cell.className = `achievement-card${entry.unlocked ? ' is-unlocked' : ''}`;

    const name = document.createElement('div');
    name.className = 'achievement-name';
    name.textContent = entry.name;

    const desc = document.createElement('div');
    desc.className = 'achievement-desc';
    desc.textContent = entry.desc;

    cell.append(name, desc);

    if (entry.max > 0) {
      const bar = document.createElement('div');
      bar.className = 'achievement-bar';
      const fill = document.createElement('div');
      fill.className = 'achievement-bar-fill';
      const ratio = Math.min(1, entry.current / Math.max(1, entry.max));
      fill.style.width = `${Math.round(ratio * 100)}%`;
      bar.appendChild(fill);

      const progress = document.createElement('div');
      progress.className = 'achievement-progress';
      progress.textContent = t('achievement.progress', {
        current: entry.current,
        max: entry.max,
      });

      cell.append(bar, progress);
    }

    const state = document.createElement('div');
    state.className = 'achievement-state';
    if (entry.unlocked) {
      state.textContent = entry.rewardLabel
        ? `${t('achievement.done')} · ${entry.rewardLabel}`
        : t('achievement.done');
    } else if (entry.rewardLabel) {
      state.textContent = `${t('achievement.reward')}: ${entry.rewardLabel}`;
    }
    if (state.textContent) cell.appendChild(state);

    grid.appendChild(cell);
  }

  const actions = document.createElement('div');
  actions.className = 'panel-actions';

  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.dataset['act'] = 'achievements-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  panel.append(title, subtitle, grid, actions);
  return panel;
}
