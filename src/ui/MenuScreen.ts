/**
 * MenuScreen.ts — Pantalla de inicio.
 *
 * Antes de esto, `main.ts` llamaba a `engine.startRun()` apenas cargaba y lo
 * primero que veia el jugador era la seleccion de ciegos. Ahora el arranque es
 * `enterMenu()` y esta pantalla es la puerta de entrada.
 *
 * Se construye con las mismas convenciones que el resto del HUD (`.panel`,
 * `.btn`, claves i18n) para no inventar un segundo sistema de UI. Solo dibuja
 * y delega: ninguna decision de juego vive aca.
 */

import { t } from '@i18n/index';

export interface MenuCallbacks {
  onStartRun: () => void;
  onContinueRun: () => void;
  onOpenCollection: () => void;
  onOpenExpansions: () => void;
  onOpenPass: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onToggleLanguage: () => void;
}

export interface MenuState {
  version: string;
  /** Etiqueta de la partida guardada, o null si no hay ninguna. */
  continueLabel: string | null;
  /** Punto rojo en los botones con recompensas pendientes. */
  badges?: { expansions?: boolean; pass?: boolean };
  /** Muestra el boton de duelo (Fase 5). */
  showBoard?: boolean;
  onOpenBoard?: () => void;
}

/**
 * `act` se expone como `data-act`: da un selector estable para los tests de
 * humo sin depender del texto traducido (que cambia con el idioma).
 */
function button(label: string, className: string, onClick: () => void, act?: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = className;
  el.textContent = label;
  if (act) el.dataset['act'] = act;
  el.addEventListener('click', onClick);
  return el;
}

function row(...children: HTMLElement[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'menu-row';
  el.append(...children);
  return el;
}

function badge(): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = 'menu-badge';
  return dot;
}

/** Boton con punto de notificacion opcional. */
function flagged(label: string, act: string, hasBadge: boolean, onClick: () => void): HTMLButtonElement {
  const el = button(label, 'btn is-ghost', onClick, act);
  if (hasBadge) el.appendChild(badge());
  return el;
}

export function buildMenuPanel(state: MenuState, callbacks: MenuCallbacks): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-menu';

  // --- Hero ---
  const hero = document.createElement('div');
  hero.className = 'menu-hero';

  const logo = document.createElement('div');
  logo.className = 'menu-logo';
  const mark = document.createElement('span');
  mark.className = 'menu-logo-mark';
  const word = document.createElement('span');
  word.className = 'menu-logo-word';
  word.textContent = t('ui.title');
  logo.append(mark, word);

  const tagline = document.createElement('p');
  tagline.className = 'panel-subtitle';
  tagline.textContent = t('menu.tagline');

  const meta = document.createElement('div');
  meta.className = 'menu-meta';
  const version = document.createElement('span');
  version.className = 'menu-version';
  version.textContent = t('menu.version', { version: state.version });
  meta.appendChild(version);

  hero.append(logo, tagline, meta);

  // --- Acciones ---
  const actions = document.createElement('div');
  actions.className = 'menu-actions';

  const continueBtn = button(t('menu.continue'), 'btn is-large', callbacks.onContinueRun, 'continue');
  if (!state.continueLabel) {
    // .is-disabled en vez del atributo disabled: asi el boton sigue pudiendo
    // mostrar un tooltip con el motivo.
    continueBtn.classList.add('is-disabled');
    continueBtn.title = t('menu.noSave');
  } else {
    continueBtn.textContent = `${t('menu.continue')} — ${state.continueLabel}`;
    continueBtn.classList.add('is-play');
  }

  const newRun = button(t('menu.newRun'), 'btn is-primary is-large', callbacks.onStartRun, 'new');

  actions.append(
    continueBtn,
    newRun,
    row(
      flagged(t('menu.collection'), 'collection', false, callbacks.onOpenCollection),
      flagged(t('menu.expansions'), 'expansions', state.badges?.expansions === true, callbacks.onOpenExpansions),
    ),
    row(
      flagged(t('menu.pass'), 'pass', state.badges?.pass === true, callbacks.onOpenPass),
      button(t('menu.settings'), 'btn is-ghost', callbacks.onOpenSettings, 'settings'),
    ),
    row(
      button(t('ui.language'), 'btn is-ghost is-small', callbacks.onToggleLanguage, 'lang'),
      button(t('menu.about'), 'btn is-ghost is-small', callbacks.onOpenAbout, 'about'),
    ),
  );

  if (state.showBoard && state.onOpenBoard) {
    actions.append(row(button(t('board.title'), 'btn is-ghost', state.onOpenBoard, 'board')));
  }

  // --- Pie ---
  const footer = document.createElement('div');
  footer.className = 'menu-footer';
  const hint = document.createElement('span');
  hint.className = 'menu-hint';
  hint.textContent = t('menu.hint');
  footer.appendChild(hint);

  panel.append(hero, actions, footer);
  return panel;
}
