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
 *
 * Opciones secundarias: NO van en el menu. Cada una vive donde corresponde:
 *   - Continuar        -> chip sobre el marco de "Nueva partida", y SOLO si
 *                         hay una partida guardada.
 *   - Idioma           -> dentro de Ajustes (ya estaba).
 *   - Expansiones/Pase -> dentro de Coleccion.
 *   - Duelo micelial   -> chip en la esquina superior izquierda.
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
  /** Recompensa diaria (retencion). */
  onOpenDaily: () => void;
  /** Logros (retencion). */
  onOpenAchievements: () => void;
  /** Cosméticos (R4b): dorso de carta y tapete. */
  onOpenCosmetics: () => void;
}

export interface MenuState {
  version: string;
  /** Etiqueta de la partida guardada, o null si no hay ninguna. */
  continueLabel: string | null;
  /** Muestra el chip de duelo (Fase 5). */
  showBoard?: boolean;
  onOpenBoard?: () => void;
  /** Hay recompensa diaria sin reclamar: el chip se marca. */
  dailyPending?: boolean;
  /**
   * Ascension (R1). `unlocked` = nivel mas alto ganado; `selected` = el que
   * esta puesto. `max` es el techo del contenido. Si `max === 0` no hay
   * contenido de ascension y el chip no se dibuja.
   */
  ascension?: { unlocked: number; selected: number; max: number };
  onOpenAscension?: () => void;
}

/**
 * Marcos de los 4 botones en el arte, en % de 1376x768.
 * Salen de detectar los bordes de cada cartel de madera en la imagen.
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

interface ChipOptions {
  disabled?: boolean;
  hidden?: boolean;
  title?: string;
  mod: string;
}

/** Clave i18n del nombre de un nivel de ascension. A0 = base. */
export function ascensionNameKey(level: number): string {
  return level > 0 ? `ascension.a${level}.name` : 'ascension.a0.name';
}

/** Clave i18n de la descripcion de un nivel de ascension. */
export function ascensionDescKey(level: number): string {
  return level > 0 ? `ascension.a${level}.desc` : 'ascension.a0.desc';
}

/** Pill secundario para acciones que NO van sobre uno de los 4 marcos. */
function chip(label: string, act: string, onClick: () => void, opts: ChipOptions): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `menu-ghost ${opts.mod}`;
  el.dataset['act'] = act;
  el.textContent = label;
  if (opts.disabled) el.classList.add('is-disabled');
  if (opts.hidden) el.classList.add('is-hidden');
  if (opts.title) el.title = opts.title;
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

  // "Continuar" SOLO aparece si hay partida guardada, como chip pegado arriba
  // del marco de "Nueva partida". Se deja SIEMPRE en el DOM (con is-disabled +
  // is-hidden) porque el smoke lee su clase `is-disabled` para saber que no hay
  // partida en curso (ver tools/smoke.mjs).
  const hasSave = state.continueLabel !== null;
  const continueChip = chip(t('menu.continue'), 'continue', callbacks.onContinueRun, {
    mod: 'menu-ghost--continue',
    disabled: !hasSave,
    hidden: !hasSave,
    ...(hasSave ? {} : { title: t('menu.noSave') }),
  });

  art.append(atmosphere, glow, play, settings, gallery, credits, continueChip);
  panel.appendChild(art);

  // --- Chips de la esquina superior izquierda ---
  // Van en una FILA (no cada uno posicionado a mano) porque son tres y el
  // ancho de cada uno depende del idioma. Siguen fuera del arte para que el
  // `cover` nunca los recorte, y respetan safe-area: en landscape el notch
  // muerde justo ahi.
  const chips = document.createElement('div');
  chips.className = 'menu-chips';

  if (state.showBoard && state.onOpenBoard) {
    chips.appendChild(chip(t('board.title'), 'board', state.onOpenBoard, { mod: 'menu-ghost--board' }));
  }

  // Ascension: el chip LLEVA EL NIVEL PUESTO (A3, A0...), porque es un estado
  // persistente que cambia las reglas. Si no hay contenido de ascension o el
  // jugador no desbloqueo nada, no aparece: un chip "A0" permanente es ruido.
  if (state.ascension && state.ascension.max > 0 && state.onOpenAscension) {
    const lvl = state.ascension.selected;
    const label = lvl > 0 ? `A${lvl}` : t('ascension.off');
    chips.appendChild(
      chip(label, 'ascension', state.onOpenAscension, {
        mod: `menu-ghost--ascension${lvl > 0 ? ' is-active' : ''}`,
        ...(lvl > 0 ? { title: t(ascensionNameKey(lvl)) } : { title: t('ascension.title') }),
      }),
    );
  }

  chips.appendChild(
    chip(t('menu.daily'), 'daily', callbacks.onOpenDaily, {
      mod: `menu-ghost--daily${state.dailyPending ? ' is-pending' : ''}`,
      ...(state.dailyPending ? { title: t('daily.ready') } : {}),
    }),
  );
  chips.appendChild(
    chip(t('menu.achievements'), 'achievements', callbacks.onOpenAchievements, {
      mod: 'menu-ghost--achievements',
    }),
  );
  chips.appendChild(
    chip(t('menu.cosmetics'), 'cosmetics', callbacks.onOpenCosmetics, {
      mod: 'menu-ghost--cosmetics',
    }),
  );
  panel.appendChild(chips);

  // Version (esquina superior derecha).
  const version = document.createElement('span');
  version.className = 'menu-version';
  version.textContent = t('menu.version', { version: state.version });
  panel.appendChild(version);

  return panel;
}

// ---------------------------------------------------------------------------
// Panel de ascension (R1)
// ---------------------------------------------------------------------------

export interface AscensionPanelCallbacks {
  /** El jugador eligio un nivel. 0 = sin ascension. */
  onSelect: (level: number) => void;
  onClose: () => void;
}

/**
 * Panel de seleccion de ascension.
 *
 * Lista TODOS los niveles (A0..max). Los que superan `unlocked` van bloqueados
 * con la condicion escrita (`ascension.unlockHint`), no con un candado mudo:
 * el jugador tiene que saber QUE hacer para abrirlos.
 */
export function buildAscensionPanel(
  state: { unlocked: number; selected: number; max: number },
  callbacks: AscensionPanelCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-ascension';

  const shell = document.createElement('div');
  shell.className = 'ascension-shell';

  const head = document.createElement('div');
  head.className = 'ascension-head';
  const title = document.createElement('h2');
  title.className = 'ascension-title';
  title.textContent = t('ascension.title');
  const sub = document.createElement('p');
  sub.className = 'ascension-subtitle';
  sub.textContent = t('ascension.subtitle');
  head.append(title, sub);

  const list = document.createElement('div');
  list.className = 'ascension-list';

  for (let level = 0; level <= state.max; level++) {
    const unlocked = level <= state.unlocked;
    const isSelected = level === state.selected;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ascension-card';
    card.dataset['act'] = 'ascension-level';
    card.dataset['level'] = String(level);
    if (!unlocked) card.classList.add('is-locked');
    if (isSelected) card.classList.add('is-selected');
    card.disabled = !unlocked;

    const badge = document.createElement('span');
    badge.className = 'ascension-badge';
    badge.textContent = level > 0 ? `A${level}` : 'A0';

    const body = document.createElement('span');
    body.className = 'ascension-body';
    const name = document.createElement('span');
    name.className = 'ascension-name';
    name.textContent = t(ascensionNameKey(level));
    const desc = document.createElement('span');
    desc.className = 'ascension-desc';
    // Bloqueado: se explica la condicion. Desbloqueado: se explican las reglas.
    desc.textContent = unlocked
      ? t(ascensionDescKey(level))
      : t('ascension.unlockHint', { level: state.unlocked, next: level });
    body.append(name, desc);

    const tag = document.createElement('span');
    tag.className = 'ascension-tag';
    tag.textContent = !unlocked
      ? t('ascension.locked')
      : isSelected
        ? t('ascension.selected')
        : t('ascension.select');

    card.append(badge, body, tag);
    if (unlocked) {
      card.addEventListener('click', () => callbacks.onSelect(level));
    } else {
      // El boton esta `disabled`, pero un `disabled` no dispara click: se deja
      // sin handler a proposito. Nunca se llama a onSelect con un nivel trabado.
    }

    if (level === state.max && level <= state.unlocked) {
      const maxNote = document.createElement('span');
      maxNote.className = 'ascension-max';
      maxNote.textContent = t('ascension.maxReached');
      card.appendChild(maxNote);
    }

    list.appendChild(card);
  }

  const footer = document.createElement('div');
  footer.className = 'ascension-footer';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ascension-close';
  close.dataset['act'] = 'ascension-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', callbacks.onClose);
  footer.appendChild(close);

  shell.append(head, list, footer);
  panel.appendChild(shell);
  return panel;
}
