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
  /** Puntaje maximo de una sola mano. Ausente en partidas viejas. */
  bestHand?: number;
  /** Puntaje total acumulado de la run. */
  totalScore?: number;
  /** Ciegos superados. */
  blindsCleared?: number;
  /** Cartas destruidas/purgadas durante la run. */
  cardsDestroyed?: number;
  /** Id del arquetipo jugado (`''` o ausente = clasico). */
  archetype?: string;
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

/**
 * Nombre legible de un arquetipo a partir de su id.
 *
 * El id (`spores`) viaja en el historial, no su clave i18n: el guardado solo
 * tiene ids, igual que las cartas. La clave se reconstruye con el mismo patron
 * que usa `archetypes.json` (`archetype.<id>.name`). Un id vacio o desconocido
 * cae al nombre del clasico, que es el caso de las partidas previas a la
 * feature.
 */
function archetypeNameKey(id: string | undefined): string {
  if (!id) return 'archetype.classic.name';
  return `archetype.${id}.name`;
}

/** Formatea numeros grandes igual que el HUD (K/M/B) para la fila del historial. */
function formatScore(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
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
  // El arquetipo es lo que hace comparables dos runs: "perdi en el ante 3" se
  // lee MUY distinto si fue con Esporas o con Colonia.
  const archTag = document.createElement('span');
  archTag.className = 'history-archetype';
  archTag.dataset['archetype'] = entry.archetype ?? '';
  archTag.textContent = t(archetypeNameKey(entry.archetype));
  head.appendChild(archTag);

  const meta = document.createElement('span');
  meta.className = 'history-meta';
  meta.textContent = t('history.detail', { ante: entry.ante, seed: entry.seed });

  body.append(head, meta);

  // Ficha de numeros: solo los que EXISTEN (las partidas viejas no los tienen).
  // Un historial que solo dice "ganaste/perdiste" no cuenta una run; estos
  // cuatro numeros hacen que dos derrotas se lean distintas.
  const statDefs: Array<[string, number | undefined]> = [
    ['bestHand', entry.bestHand],
    ['totalScore', entry.totalScore],
    ['blinds', entry.blindsCleared],
    ['destroyed', entry.cardsDestroyed],
  ];
  const stats = document.createElement('span');
  stats.className = 'history-stats';
  for (const [key, value] of statDefs) {
    if (typeof value !== 'number') continue;
    const stat = document.createElement('span');
    stat.className = 'history-stat';
    stat.dataset['stat'] = key;
    const label = document.createElement('span');
    label.className = 'history-stat-label';
    label.textContent = t(`history.stat.${key}`);
    const num = document.createElement('span');
    num.className = 'history-stat-value';
    num.textContent = formatScore(value);
    stat.append(label, num);
    stats.appendChild(stat);
  }
  if (stats.childElementCount > 0) body.appendChild(stats);

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
