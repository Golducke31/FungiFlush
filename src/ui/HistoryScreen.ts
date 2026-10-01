/**
 * HistoryScreen.ts — Historial de partidas (R5).
 *
 * Lista las ultimas runs del jugador (lo mas reciente primero). Es DOM puro: no
 * conoce el perfil ni el motor, recibe las entradas YA resueltas y solo las
 * pinta. Las fechas se formatean aca porque son de presentacion, no de estado.
 *
 * Cada fila es una `.history-row` con material de marco compartido (ver
 * `styles.css`), igual que el resto de los paneles. `data-result` distingue
 * victoria de derrota para el color, y `data-act="history-close"` es el gancho
 * del smoke.
 */

import { t } from '@i18n/index';

export interface HistoryEntryView {
  seed: number;
  ante: number;
  ascension: number;
  win: boolean;
  reason: 'loss' | 'victory';
  /** epoch ms. */
  at: number;
}

export interface HistoryCallbacks {
  onClose: () => void;
}

/** Fecha corta y local. Los segundos no aportan nada en una lista de runs. */
function formatWhen(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '—';
  try {
    return new Date(at).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Etiqueta del nivel: A0 se omite para no ensuciar la fila. */
function ascensionLabel(level: number): string {
  return level > 0 ? `A${level}` : '';
}

function historyRow(entry: HistoryEntryView): HTMLElement {
  const row = document.createElement('div');
  row.className = `history-row${entry.win ? ' is-win' : ' is-loss'}`;
  row.dataset['result'] = entry.reason;
  row.dataset['seed'] = String(entry.seed);

  const badge = document.createElement('span');
  badge.className = 'history-badge';
  badge.textContent = entry.win ? '★' : '×';

  const body = document.createElement('span');
  body.className = 'history-body';

  const head = document.createElement('span');
  head.className = 'history-headline';
  const result = document.createElement('span');
  result.className = 'history-result';
  result.textContent = entry.win ? t('history.win') : t('history.loss');
  head.appendChild(result);
  const asc = ascensionLabel(entry.ascension);
  if (asc) {
    const ascTag = document.createElement('span');
    ascTag.className = 'history-asc';
    ascTag.textContent = asc;
    head.appendChild(ascTag);
  }

  const meta = document.createElement('span');
  meta.className = 'history-meta';
  meta.textContent = t('history.detail', { ante: entry.ante, seed: entry.seed });

  body.append(head, meta);

  const when = document.createElement('span');
  when.className = 'history-when';
  when.textContent = formatWhen(entry.at);

  row.append(badge, body, when);
  return row;
}

export function buildHistoryPanel(entries: HistoryEntryView[], callbacks: HistoryCallbacks): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-history';

  const shell = document.createElement('div');
  shell.className = 'history-shell';

  const head = document.createElement('div');
  head.className = 'history-head';
  const title = document.createElement('h2');
  title.className = 'history-title';
  title.textContent = t('history.title');
  const sub = document.createElement('p');
  sub.className = 'history-subtitle';
  sub.textContent = t('history.subtitle');
  head.append(title, sub);

  const list = document.createElement('div');
  list.className = 'history-list';
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = t('history.empty');
    list.appendChild(empty);
  } else {
    for (const entry of entries) list.appendChild(historyRow(entry));
  }

  const footer = document.createElement('div');
  footer.className = 'history-footer';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'history-close';
  close.dataset['act'] = 'history-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', callbacks.onClose);
  footer.appendChild(close);

  shell.append(head, list, footer);
  panel.appendChild(shell);
  return panel;
}
