/**
 * AboutScreen.ts — Creditos y datos de version.
 *
 * Muestra el hash de contenido: es lo que permite a un jugador decir "mi run
 * es distinta" y que sepamos de que build habla. Tambien lista los packs
 * activos, que es la base de la futura pantalla de expansiones.
 */

import { t } from '@i18n/index';

export interface AboutInfo {
  version: string;
  contentHash: string | null;
  packs: string[];
  /** Packs omitidos y por que (version de app, dependencias). */
  skipped?: Array<{ id: string; reason: string }>;
}

export function buildAboutPanel(info: AboutInfo, onClose: () => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-about';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('ui.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = t('menu.tagline');

  const grid = document.createElement('div');
  grid.className = 'stat-grid';

  const rows: Array<[string, string]> = [
    [t('menu.version', { version: info.version }), 'FungiFlush'],
    ['Packs', info.packs.join(', ') || '—'],
    ['Content hash', info.contentHash ?? '—'],
  ];
  for (const [label, value] of rows) {
    const cell = document.createElement('div');
    cell.className = 'stat-cell';
    const valueEl = document.createElement('div');
    valueEl.className = 'stat-cell-value';
    valueEl.style.fontSize = '14px';
    valueEl.textContent = value;
    const labelEl = document.createElement('div');
    labelEl.className = 'stat-cell-label';
    labelEl.textContent = label;
    cell.append(valueEl, labelEl);
    grid.appendChild(cell);
  }

  if (info.skipped && info.skipped.length > 0) {
    const note = document.createElement('p');
    note.className = 'panel-subtitle';
    note.textContent = info.skipped.map((s) => `${s.id}: ${s.reason}`).join(' · ');
    grid.appendChild(note);
  }

  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', onClose);
  actions.appendChild(close);

  panel.append(title, subtitle, grid, actions);
  return panel;
}
