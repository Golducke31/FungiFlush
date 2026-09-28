/**
 * MenuScreen.ts — Pantalla de inicio (composicion por CAPAS).
 *
 * La imagen `public/menu-bg.jpg` ya trae dibujado el bosque, el titulo y los
 * 4 marcos de los botones. Aca NO se redibuja nada de eso: la imagen es la
 * capa base y encima se apoyan capas propias, alineadas a los marcos:
 *
 *   1. `menu-atmosphere` -> esporas flotantes (le da vida sin tocar el arte).
 *   2. `menu-title-glow` -> halo cian que respira sobre el titulo.
 *   3. `menu-btn` x4     -> botones funcionales. Cada uno usa SU recorte del
 *                           marco (`public/menu-btn-*.png`, con el texto en
 *                           ingles borrado por inpaint) como fondo y encima
 *                           el texto traducido.
 *   4. `menu-secondary`  -> fila fija de opciones secundarias (siempre visible).
 *
 * Los botones son capas independientes: se iluminan sin tocar el fondo. Las
 * posiciones son % del arte (1376x768) y el arte se escala como `cover` por
 * media queries, asi que la alineacion se mantiene en cualquier aspecto.
 *
 * El panel NO escala al entrar (el arte vive en vw/vh y no escalaria con el):
 * solo funde. Ver `styles.css`.
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
 * Marcos de los 4 botones en el arte, en % de 1376x768.
 * Salen de detectar las etiquetas cian en la imagen (ver `tools/`): son las
 * cajas de cada cartel de madera.
 */
const FRAMES = {
  play: { left: 32.7, top: 69.01, width: 16.13, height: 8.85 },
  settings: { left: 50.44, top: 69.01, width: 16.13, height: 8.85 },
  gallery: { left: 32.7, top: 79.69, width: 16.13, height: 9.64 },
  exit: { left: 50.44, top: 79.69, width: 16.13, height: 9.64 },
} as const;

type FrameId = keyof typeof FRAMES;

/** Boton principal: fondo = recorte del marco del arte, texto encima. */
function artButton(frame: FrameId, label: string, act: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `menu-btn menu-btn--${frame}`;
  el.dataset['act'] = act;
  const f = FRAMES[frame];
  el.style.left = `${f.left}%`;
  el.style.top = `${f.top}%`;
  el.style.width = `${f.width}%`;
  el.style.height = `${f.height}%`;

  const span = document.createElement('span');
  span.className = 'menu-btn-label';
  span.textContent = label;
  el.appendChild(span);
  el.addEventListener('click', onClick);
  return el;
}

/** Opcion secundaria: pill translucido en la fila inferior. */
function ghost(
  label: string,
  act: string,
  onClick: () => void,
  opts: { disabled?: boolean; title?: string; badge?: boolean } = {},
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'menu-ghost';
  el.dataset['act'] = act;
  el.textContent = label;
  if (opts.disabled) el.classList.add('is-disabled');
  if (opts.title) el.title = opts.title;
  if (opts.badge) {
    const dot = document.createElement('span');
    dot.className = 'menu-badge';
    el.appendChild(dot);
  }
  el.addEventListener('click', onClick);
  return el;
}

export function buildMenuPanel(state: MenuState, callbacks: MenuCallbacks): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-menu';

  // Titulo accesible: el del arte es una imagen, no texto.
  const srTitle = document.createElement('h1');
  srTitle.className = 'sr-only';
  srTitle.textContent = t('ui.title');
  panel.appendChild(srTitle);

  const art = document.createElement('div');
  art.className = 'menu-art';

  // --- Capa 1: atmosfera (esporas que suben) ---
  // Math.random() es correcto aca: son decorativas y NUNCA deben tocar el RNG
  // del motor (el determinismo de las semillas es un invariante del juego).
  const atmosphere = document.createElement('div');
  atmosphere.className = 'menu-atmosphere';
  atmosphere.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 24; i++) {
    const spore = document.createElement('span');
    spore.className = 'menu-spore';
    spore.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    spore.style.setProperty('--size', `${(1.5 + Math.random() * 3.5).toFixed(1)}px`);
    spore.style.setProperty('--dur', `${(9 + Math.random() * 11).toFixed(1)}s`);
    spore.style.setProperty('--delay', `${(-Math.random() * 20).toFixed(1)}s`);
    spore.style.setProperty('--drift', `${(Math.random() * 80 - 40).toFixed(0)}px`);
    atmosphere.appendChild(spore);
  }

  // --- Capa 2: halo del titulo ---
  const glow = document.createElement('div');
  glow.className = 'menu-title-glow';
  glow.setAttribute('aria-hidden', 'true');

  // --- Capa 3: los 4 botones principales (alineados a los marcos) ---
  const play = artButton('play', t('menu.newRun'), 'new', callbacks.onStartRun);
  const settings = artButton('settings', t('menu.settings'), 'settings', callbacks.onOpenSettings);
  const gallery = artButton('gallery', t('menu.collection'), 'collection', callbacks.onOpenCollection);
  const credits = artButton('exit', t('menu.about'), 'about', callbacks.onOpenAbout);

  // --- Capa 4: fila secundaria ---
  // Va DENTRO del arte, en la franja libre entre el titulo y los botones
  // (art y ~62%): asi escala con el arte y nunca choca con los marcos, ni
  // siquiera en pantallas mas anchas que 16:9 (donde el arte se recorta).
  const secondary = document.createElement('div');
  secondary.className = 'menu-secondary';

  secondary.appendChild(
    ghost(state.continueLabel ? `${t('menu.continue')} — ${state.continueLabel}` : t('menu.continue'), 'continue', callbacks.onContinueRun, {
      disabled: !state.continueLabel,
      title: state.continueLabel ? '' : t('menu.noSave'),
    }),
  );
  secondary.appendChild(
    ghost(t('menu.expansions'), 'expansions', callbacks.onOpenExpansions, { badge: state.badges?.expansions === true }),
  );
  secondary.appendChild(ghost(t('menu.pass'), 'pass', callbacks.onOpenPass, { badge: state.badges?.pass === true }));
  secondary.appendChild(ghost(t('ui.language'), 'lang', callbacks.onToggleLanguage));
  if (state.showBoard && state.onOpenBoard) {
    secondary.appendChild(ghost(t('board.title'), 'board', state.onOpenBoard));
  }

  art.append(atmosphere, glow, play, settings, gallery, credits, secondary);
  panel.appendChild(art);

  // Version (esquina superior derecha, fija sobre el bosque).
  const version = document.createElement('span');
  version.className = 'menu-version';
  version.textContent = t('menu.version', { version: state.version });
  panel.appendChild(version);

  return panel;
}
