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
  onContinueRun: () => void;  onOpenCollection: () => void;
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
  /** Historial de partidas (R5). */
  onOpenHistory: () => void;
  /** Guia de inicio reabrible (v2): explica combos, esporas, sustrato y bonus. */
  onOpenGuide: () => void;
  // --- Arquetipos: elegir con que forma de puntuar se juega la run ---
  /** El jugador eligio un arquetipo. `''` = clasico (sin sesgo). */
  onSelectArchetype: (archetypeId: string) => void;
  /** Abre el panel de arquetipos (boton "Nueva partida"). */
  onOpenArchetypes: () => void;
  /** Abre el panel de PERFIL (esquina superior izquierda). */
  onOpenProfile: () => void;
  /** Abre el panel de DESAFIOS (menu de la esquina superior derecha). */
  onOpenChallenges: () => void;
}

/**
 * Arquetipo en el menu. Es la forma de puntuar con la que se va a jugar.
 *
 * `id` vacio = clasico (mazo base, sin sesgo de tienda). Viaja hasta el motor
 * como string; la UI solo conoce las claves i18n.
 */
export interface MenuArchetype {
  id: string;
  nameKey: string;
  taglineKey: string;
  /** Como puntua: el motor de la fantasia. */
  howKey: string;
  /** Debilidad: lo que cuesta elegirlo. */
  weaknessKey: string;
  /** Elemento firma, para el punto de color del chip. */
  element: string;
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
  /**
   * Arquetipos disponibles. Vacio o ausente = el contenido no trae arquetipos y
   * el chip no se dibuja (mismo criterio que ascension).
   */
  archetypes?: MenuArchetype[];
  /** Id del arquetipo elegido actualmente (`''` = clasico). */
  selectedArchetype?: string;
  /**
   * Nivel de la Colonia Fungi (meta-progresion futura). 0/ausente = todavia no
   * existe: el icono de Perfil se dibuja igual, sin insignia.
   */
  colonyLevel?: number;
}

/**
 * Iconos SVG inline del menu (trazo = currentColor, sin dependencias de red).
 * El arte ya no trae marcos horneados: las acciones secundarias viven en
 * iconos de esquina, asi que necesitan su propio set.
 */
const MENU_ICONS = {
  // Perfil: una seta (identidad de la cuenta). Trazo grueso del prototipo
  // (`boton-hongo.html`), pensado para leerse sobre el gel claro.
  profile:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="var(--gel-stroke, #06303c)" stroke-width="5" stroke-linejoin="round"><path d="M3 12.5a9 8.5 0 0 1 18 0z"/><path d="M9.5 12.5v5.5a2.5 2.5 0 0 0 5 0v-5.5z"/></g><path d="M9.5 12.5v5.5a2.5 2.5 0 0 0 5 0v-5.5z" fill="#d9fff8" stroke="#d9fff8" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 12.5a9 8.5 0 0 1 18 0z" fill="#effffb" stroke="#effffb" stroke-width="1.2" stroke-linejoin="round"/><g fill="#3fe0d0"><circle cx="8" cy="9.4" r="1.5"/><circle cx="13.6" cy="7.4" r="1.8"/><circle cx="17.2" cy="10.6" r="1.2"/></g></svg>',
} as const;

/** Icono de la hamburguesa: las tres barras del prototipo (`boton-menu.html`). */
const GEL_BARS_HTML =
  '<span class="gel-bars" aria-hidden="true"><i class="gel-bar"></i><i class="gel-bar"></i><i class="gel-bar"></i></span>';

/**
 * Boton de icono "gel" de la esquina (Perfil, Menu).
 *
 * `act` es el ancla que leen las tools: NO cambiar sin actualizarlas.
 */
function gelIconButton(
  act: string,
  label: string,
  onClick: () => void,
  opts: { alt?: boolean; profile?: boolean } = {},
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `menu-gel menu-gel--icon${opts.alt ? ' is-alt' : ''}`;
  if (opts.profile) el.classList.add('menu-gel--profile');
  el.dataset['act'] = act;
  el.setAttribute('aria-label', label);
  el.title = label;
  el.innerHTML = opts.profile ? MENU_ICONS.profile : GEL_BARS_HTML;
  el.addEventListener('click', onClick);
  return el;
}

/** Item del desplegable del menu (Ajustes / Coleccion / Desafios). */
function dropItem(label: string, act: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'menu-drop-item';
  el.dataset['act'] = act;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

// ---------------------------------------------------------------------------
// Decoraciones del prototipo (setas, gotas, burbujas, espiral)
// ---------------------------------------------------------------------------

/** Setas del boton verde (Nueva partida). */
function mushroomDecoHtml(): string {
  return (
    '<svg class="deco m1" aria-hidden="true" viewBox="0 0 64 64"><use href="#ff-seta"/></svg>' +
    '<svg class="deco m2" aria-hidden="true" viewBox="0 0 64 64"><use href="#ff-seta"/></svg>' +
    '<svg class="deco m3" aria-hidden="true" viewBox="0 0 64 64"><use href="#ff-seta"/></svg>'
  );
}

/** Gota + espiral + burbujas del boton azul (Continuar). */
function waterDecoHtml(): string {
  return (
    '<svg class="deco e1" aria-hidden="true" viewBox="0 0 48 48"><use href="#ff-espiral"/></svg>' +
    '<svg class="deco g1" aria-hidden="true" viewBox="0 0 40 56"><use href="#ff-gota"/></svg>' +
    '<svg class="deco b1" aria-hidden="true" viewBox="0 0 32 32"><use href="#ff-burbuja"/></svg>' +
    '<svg class="deco b2" aria-hidden="true" viewBox="0 0 32 32"><use href="#ff-burbuja"/></svg>'
  );
}

/**
 * Boton HEROE de texto: la pastilla de gel del prototipo
 * (`menu-botones-fungiflush`), sin caja alrededor.
 *
 * `mod` da la variante (`new` = verde, `continue` = azul). El ancla `data-act`
 * es la misma que antes (`new` / `continue`).
 */
function gelTextButton(
  mod: 'new' | 'continue',
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `menu-fb${mod === 'continue' ? ' is-alt' : ''}`;
  el.dataset['act'] = mod;
  el.setAttribute('aria-label', label);
  const span = document.createElement('span');
  span.textContent = label;
  el.appendChild(span);
  el.addEventListener('click', onClick);
  return el;
}

/**
 * Sprite SVG de las decoraciones del prototipo.
 *
 * Va UNA sola vez por panel y las decoraciones lo referencian con `<use>`: los
 * gradientes viven aqui, asi que dibujar los `<symbol>` a mano en cada boton
 * repetiria los ids y romperia las referencias.
 */
function menuDecoDefs(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute');
  svg.innerHTML = `<defs>
   <linearGradient id="ff-cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ffff0"/><stop offset="1" stop-color="#139fb6"/></linearGradient>
   <linearGradient id="ff-agua" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfeaff"/><stop offset="1" stop-color="#1a74b8"/></linearGradient>
   <symbol id="ff-seta" viewBox="0 0 64 64">
    <path d="M26 34h12v21a6 6 0 0 1-12 0z" fill="#d9fff8" stroke="#06303c" stroke-width="3" stroke-linejoin="round"/>
    <path d="M3 37C3 18 16 5 32 5s29 13 29 32z" fill="url(#ff-cap)" stroke="#06303c" stroke-width="3" stroke-linejoin="round"/>
    <g fill="#fff"><circle cx="19" cy="26" r="4.5"/><circle cx="35" cy="17" r="5.5"/><circle cx="48" cy="29" r="3.8"/><circle cx="30" cy="30" r="3"/><circle cx="43" cy="18" r="2.6"/></g>
   </symbol>
   <symbol id="ff-gota" viewBox="0 0 40 56">
    <path d="M20 3S5 23 5 37a15 15 0 0 0 30 0C35 23 20 3 20 3z" fill="url(#ff-agua)" stroke="#04182b" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="14" cy="36" rx="3.2" ry="7" fill="#fff" opacity=".85" transform="rotate(12 14 36)"/>
   </symbol>
   <symbol id="ff-burbuja" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="13" fill="rgba(160,225,255,.28)" stroke="#bff4ff" stroke-width="2.5"/><circle cx="11" cy="11" r="3.2" fill="#fff" opacity=".9"/>
   </symbol>
   <symbol id="ff-espiral" viewBox="0 0 48 48">
    <path d="M33 33c-3 7-14 6-14-2 0-9 13-11 18-3 6 10-3 22-16 20C9 46 3 34 6 24" fill="none" stroke="#04182b" stroke-width="10" stroke-linecap="round"/>
    <path d="M33 33c-3 7-14 6-14-2 0-9 13-11 18-3 6 10-3 22-16 20C9 46 3 34 6 24" fill="none" stroke="#7fd6ff" stroke-width="5" stroke-linecap="round"/>
   </symbol>
  </defs>`;
  return svg;
}

/** Clave i18n del nombre de un nivel de ascension. A0 = base. */
export function ascensionNameKey(level: number): string {
  return level > 0 ? `ascension.a${level}.name` : 'ascension.a0.name';
}

/** Clave i18n de la descripcion de un nivel de ascension. */
export function ascensionDescKey(level: number): string {
  return level > 0 ? `ascension.a${level}.desc` : 'ascension.a0.desc';
}

export function buildMenuPanel(state: MenuState, callbacks: MenuCallbacks): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-menu';

  // Titulo accesible: el del arte es una imagen, no texto.
  const srTitle = document.createElement('h1');
  srTitle.className = 'sr-only';
  srTitle.textContent = t('ui.title');
  panel.appendChild(srTitle);

  // --- Capa base: el arte (bosque + titulo horneado). Ya NO trae marcos. ---
  const art = document.createElement('div');
  art.className = 'menu-art';
  art.setAttribute('aria-hidden', 'true');

  // Esporas flotantes. Math.random() es correcto aca: son decorativas y NUNCA
  // deben tocar el RNG del motor (el determinismo de las semillas es un
  // invariante del juego).
  const atmosphere = document.createElement('div');
  atmosphere.className = 'menu-atmosphere';
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
  art.appendChild(atmosphere);
  panel.appendChild(art);

  // --- Capa de UI: layout anclado al VIEWPORT (ya no al arte) ---
  // La jerarquia responde una sola pregunta: "que deberia hacer ahora?".
  //   1. heroe (Nueva partida / Continuar)  2. perfil  3. resto.
  const layout = document.createElement('div');
  layout.className = 'menu-layout';

  // Sprite de las decoraciones (setas / gotas / burbujas). Una sola copia.
  panel.appendChild(menuDecoDefs());

  // ---- Fila superior: Perfil (izq) + menu hamburguesa (der) ----
  const top = document.createElement('div');
  top.className = 'menu-top';

  const profileBtn = gelIconButton('profile', t('menu.profile'), callbacks.onOpenProfile, {
    profile: true,
  });
  // Nivel de la Colonia Fungi: si todavia no existe (0), el icono se dibuja
  // igual, sin insignia.
  if ((state.colonyLevel ?? 0) > 0) {
    const badge = document.createElement('span');
    badge.className = 'menu-icon-badge';
    const prefix = document.createElement('span');
    prefix.className = 'badge-prefix';
    prefix.textContent = t('menu.levelShort');
    const value = document.createElement('span');
    value.textContent = String(state.colonyLevel);
    badge.append(prefix, value);
    profileBtn.appendChild(badge);
  }

  const topRight = document.createElement('div');
  topRight.className = 'menu-top-right';

  // Desplegable SIEMPRE en el DOM (oculto): las acciones secundarias siguen
  // siendo alcanzables y testeables aunque el jugador no lo abra.
  const drop = document.createElement('div');
  drop.className = 'menu-drop';
  drop.appendChild(dropItem(t('menu.settings'), 'settings', callbacks.onOpenSettings));
  drop.appendChild(dropItem(t('menu.collection'), 'collection', callbacks.onOpenCollection));
  drop.appendChild(dropItem(t('menu.challenges'), 'challenges', callbacks.onOpenChallenges));

  const menuBtn = gelIconButton(
    'menu-toggle',
    t('menu.openMenu'),
    () => {
      const open = drop.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
    },
    { alt: true },
  );
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-haspopup', 'true');

  topRight.append(drop, menuBtn);
  top.append(profileBtn, topRight);
  layout.appendChild(top);

  // ---- Heroe: los dos botones de gel ----
  const hero = document.createElement('div');
  hero.className = 'menu-hero';

  const hasSave = state.continueLabel !== null;
  const hasArchetypes = (state.archetypes?.length ?? 0) > 0;

  // "Nueva partida" abre el selector de ARQUETIPO (la forma de puntuar) en vez
  // de arrancar directo: el arquetipo es una decision de run, no un ajuste.
  const newBtn = gelTextButton('new', t('menu.newRun'), hasArchetypes ? callbacks.onOpenArchetypes : callbacks.onStartRun);
  const newWrap = document.createElement('div');
  newWrap.className = 'menu-cta-wrap';
  newWrap.innerHTML = mushroomDecoHtml();
  newWrap.appendChild(newBtn);

  // "Continuar" SOLO se ve si hay partida guardada, pero SIEMPRE vive en el DOM
  // con `is-disabled` en el boton: el smoke lee esa clase para saber que no hay
  // partida en curso (ver tools/smoke.mjs).
  const continueBtn = gelTextButton('continue', t('menu.continue'), callbacks.onContinueRun);
  const continueWrap = document.createElement('div');
  continueWrap.className = 'menu-cta-wrap is-continue';
  continueWrap.innerHTML = waterDecoHtml();
  continueWrap.appendChild(continueBtn);
  const ctaSub = document.createElement('p');
  ctaSub.className = 'menu-cta-sub';
  ctaSub.setAttribute('aria-live', 'polite');
  continueWrap.appendChild(ctaSub);

  if (!hasSave) {
    continueBtn.disabled = true;
    continueBtn.classList.add('is-disabled', 'is-hidden');
    continueWrap.classList.add('is-off', 'is-hidden');
    ctaSub.textContent = t('menu.noSave');
  } else {
    ctaSub.textContent = state.continueLabel ?? '';
  }

  hero.append(newWrap, continueWrap);

  const status = document.createElement('p');
  status.className = 'menu-hero-status';
  status.textContent = hasSave ? (state.continueLabel ?? '') : t('menu.noSave');
  hero.appendChild(status);

  layout.appendChild(hero);

  // ---- Version (abajo-derecha) ----
  const version = document.createElement('span');
  version.className = 'menu-version';
  version.textContent = t('menu.version', { version: state.version });
  layout.appendChild(version);

  panel.appendChild(layout);
  return panel;
}

// ---------------------------------------------------------------------------
// Panel de Perfil (esquina superior izquierda)
// ---------------------------------------------------------------------------

export interface ProfilePanelCallbacks {
  /** Escalera de niveles de la Colonia (Recompensas). */
  onOpenColonyRewards: () => void;
  /** Ranking global de Esporas de Colonia (temporada + historica). */
  onOpenLeaderboard: () => void;
  /** Cosmeticos (Personalizar): dorso de carta y tapete. */
  onOpenCosmetics: () => void;
  onOpenAchievements: () => void;
  onOpenHistory: () => void;
  /** Vincular el progreso a Google Play Games. */
  onLinkAccount: () => void;
  /** Desvincular (el progreso local se conserva). */
  onUnlinkAccount: () => void;
  onClose: () => void;
}

/**
 * Vista de la Colonia Fungi para el panel de Perfil.
 *
 * La UI NO conoce el perfil ni el modulo de meta: el controlador le empuja esta
 * vista ya resuelta (mismo contrato que el resto del HUD).
 */
export interface ColonyView {
  level: number;
  /** Clave i18n del nombre de la banda del nivel ("Brote Micelial"). */
  levelNameKey: string;
  /** Esporas de Colonia acumuladas. */
  spores: number;
  /** Esporas acumuladas al entrar al nivel actual. */
  current: number;
  /** Esporas acumuladas del proximo nivel. */
  next: number;
  remaining: number;
  /** Progreso dentro del nivel, 0..1. */
  progress: number;
  /** Clave i18n de la recompensa del proximo nivel, o null. */
  nextRewardNameKey: string | null;
  /** Esporas ganadas en la temporada en curso. */
  seasonSpores: number;
  /** Esporas de Colonia que aun se pueden ganar hoy (tope duro diario). */
  dailyRemaining: number;
  /** Tope duro diario de Esporas de Colonia. */
  dailyCap: number;
  rewards: ColonyRewardView[];
}

export interface ColonyRewardView {
  level: number;
  spores: number;
  nextSpores: number;
  rewardId: string | null;
  rewardNameKey: string | null;
  unlocked: boolean;
}

/** Estado de la cuenta (Google Play Games / local). */
export interface AccountView {
  linked: boolean;
  provider: 'none' | 'google-play' | 'local';
  displayName: string | null;
  syncState: 'offline' | 'pending' | 'synced' | 'conflict';
  /** El dispositivo soporta el proveedor. */
  available: boolean;
}

/** Esporas de Colonia ganadas en la run que acaba de terminar. */
export interface ColonyResultView {
  spores: number;
  bonuses: Array<{ nameKey: string; amount: number }>;
}

export interface ProfilePanelState {
  /** Nivel de la Colonia Fungi (0/ausente = aun no existe). */
  colonyLevel?: number;
  /** Colonia resuelta (nivel, Esporas, barra, proximo desbloqueo). */
  colony?: ColonyView | null;
  account?: AccountView | null;
  /** Detalle de la tarjeta de Ranking ("12 / 340", o vacio). */
  leaderboardDetail?: string;
  bestAnte?: number;
  wins?: number;
  streak?: number;
  achievements?: { unlocked: number; total: number };
}

/** Esporas con separador de miles. Es un numero de cuenta, no de puntaje. */
function formatSpores(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * Icono de las Esporas de Colonia (`public/art/ui_icon_colony.svg`).
 *
 * Se resuelve contra `document.baseURI` y se pinta por MASCARA (mismo patron
 * que los contadores del HUD): asi el color lo pone el CSS y el mismo archivo
 * sirve en el dev server y bajo el `asset://` de Tauri. Deliberadamente
 * DISTINTO del hongo de la moneda de partida: una Espora de Colonia es un
 * recurso permanente de la cuenta, no el multiplicador de una mano.
 */
export function colonyIconEl(extraClass = ''): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `colony-icon ${extraClass}`.trim();
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty(
    '--icon',
    `url("${new URL('art/ui_icon_colony.svg', document.baseURI).href}")`,
  );
  return el;
}

/** Clave i18n del estado de sincronizacion de la cuenta. */
function syncKey(state: AccountView['syncState']): string {
  return `colony.account.sync.${state}`;
}

/**
 * Panel de PERFIL: la identidad de la cuenta.
 *
 * Agrupa lo que "es tuyo" y no "que vas a jugar": la Colonia Fungi (nivel,
 * Esporas de Colonia y proximo desbloqueo), el progreso, la cuenta y los
 * accesos a Recompensas / Personalizar / Logros / Historial. La Coleccion NO
 * vive aca: es contenido y tiene su propia puerta en el menu desplegable.
 */
export function buildProfilePanel(
  state: ProfilePanelState,
  callbacks: ProfilePanelCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-profile';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('menu.profile');

  const sub = document.createElement('p');
  sub.className = 'panel-subtitle';
  sub.textContent = t('menu.profileSubtitle');

  const body = document.createElement('div');
  body.className = 'profile-body';

  // --- Colonia Fungi: nivel + Esporas de Colonia + proximo desbloqueo ---
  const colony = state.colony ?? null;
  const block = document.createElement('div');
  block.className = 'profile-colony';
  block.dataset['act'] = 'colony-block';

  const colonyTop = document.createElement('div');
  colonyTop.className = 'profile-colony-top';
  const colonyName = document.createElement('span');
  colonyName.className = 'profile-colony-name';
  colonyName.textContent = t('colony.title');
  const colonyLevel = document.createElement('span');
  colonyLevel.className = 'profile-colony-level';
  colonyLevel.textContent = colony
    ? `${t(colony.levelNameKey)} · ${t('colony.levelLabel', { level: colony.level })}`
    : t('menu.colonySoon');
  colonyTop.append(colonyName, colonyLevel);

  const sporesRow = document.createElement('div');
  sporesRow.className = 'profile-colony-spores';
  const sporesLabel = document.createElement('span');
  sporesLabel.className = 'profile-colony-spores-label';
  const sporesText = document.createElement('span');
  sporesText.textContent = t('colony.spores');
  sporesLabel.append(colonyIconEl('is-small'), sporesText);
  const sporesValue = document.createElement('span');
  sporesValue.className = 'profile-colony-spores-value';
  sporesValue.dataset['counter'] = 'colony-spores';
  sporesValue.textContent = colony
    ? `${formatSpores(colony.spores)} / ${formatSpores(colony.next)}`
    : '—';
  sporesRow.append(sporesLabel, sporesValue);

  const bar = document.createElement('div');
  bar.className = 'profile-colony-bar';
  const fill = document.createElement('div');
  fill.className = 'profile-colony-fill';
  fill.style.width = `${Math.round((colony?.progress ?? 0) * 100)}%`;
  bar.appendChild(fill);

  const nextRow = document.createElement('div');
  nextRow.className = 'profile-colony-next';
  nextRow.textContent =
    colony && colony.nextRewardNameKey
      ? t('colony.nextUnlock', { name: t(colony.nextRewardNameKey) })
      : t('colony.noNext');

  block.append(colonyTop, sporesRow, bar, nextRow);

  // --- Progreso actual (ante / victorias / racha) ---
  const stats = document.createElement('div');
  stats.className = 'profile-stats';
  const stat = (label: string, value: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'profile-stat';
    const v = document.createElement('span');
    v.className = 'profile-stat-value';
    v.textContent = value;
    const l = document.createElement('span');
    l.className = 'profile-stat-label';
    l.textContent = label;
    el.append(v, l);
    return el;
  };
  stats.append(
    stat(t('menu.progress.bestAnte'), String(state.bestAnte ?? 0)),
    stat(t('menu.progress.wins'), String(state.wins ?? 0)),
    stat(t('menu.progress.streak'), String(state.streak ?? 0)),
  );

  // --- Accesos: Recompensas / Personalizar / Logros / Historial ---
  const grid = document.createElement('div');
  grid.className = 'profile-grid';
  const card = (label: string, detail: string, act: string, onClick: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'profile-card';
    el.dataset['act'] = act;
    const name = document.createElement('span');
    name.className = 'profile-card-name';
    name.textContent = label;
    const det = document.createElement('span');
    det.className = 'profile-card-detail';
    det.textContent = detail;
    el.append(name, det);
    el.addEventListener('click', onClick);
    return el;
  };
  const ach = state.achievements;
  grid.append(
    card(
      t('colony.rewards'),
      colony ? `${colony.rewards.filter((r) => r.unlocked).length}/${colony.rewards.length}` : '',
      'colony-rewards',
      callbacks.onOpenColonyRewards,
    ),
    card(t('colony.ranking'), state.leaderboardDetail ?? '', 'leaderboard', callbacks.onOpenLeaderboard),
    card(t('menu.cosmetics'), '', 'cosmetics', callbacks.onOpenCosmetics),
    card(
      t('menu.achievements'),
      ach ? `${ach.unlocked}/${ach.total}` : '',
      'achievements',
      callbacks.onOpenAchievements,
    ),
    card(t('menu.history'), '', 'history', callbacks.onOpenHistory),
  );

  // --- Cuenta (opcional): Google Play Games ---
  //
  // El estado de sync vive DENTRO de la misma fila (segunda linea del texto) y
  // no en una fila propia: en 844x390 una linea de mas empujaba el boton fuera
  // de la ventana, y un control que no se puede tocar no existe.
  const account = state.account ?? null;
  const accountRow = document.createElement('div');
  accountRow.className = 'profile-account';
  const accountInfo = document.createElement('span');
  accountInfo.className = 'profile-account-info';
  const accountText = document.createElement('span');
  accountText.className = 'profile-account-text';
  accountText.dataset['act'] = 'account-state';
  accountText.textContent = account?.linked
    ? t('colony.account.linkedAs', { name: account.displayName ?? '—' })
    : account?.available
      ? t('colony.account.notLinked')
      : t('colony.account.unavailable');
  const syncLine = document.createElement('span');
  syncLine.className = 'profile-account-sync';
  syncLine.textContent = t(syncKey(account?.syncState ?? 'offline'));
  accountInfo.append(accountText, syncLine);

  const accountBtn = document.createElement('button');
  accountBtn.type = 'button';
  accountBtn.className = 'profile-account-btn';
  accountBtn.dataset['act'] = account?.linked ? 'account-unlink' : 'account-link';
  accountBtn.textContent = account?.linked ? t('colony.account.unlink') : t('colony.account.link');
  if (!account?.linked && !account?.available) accountBtn.disabled = true;
  accountBtn.addEventListener('click', () => {
    if (account?.linked) callbacks.onUnlinkAccount();
    else callbacks.onLinkAccount();
  });
  accountRow.append(accountInfo, accountBtn);

  body.append(block, stats, grid, accountRow);

  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.dataset['act'] = 'profile-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', callbacks.onClose);
  actions.appendChild(close);

  panel.append(title, sub, body, actions);
  return panel;
}

// ---------------------------------------------------------------------------
// Panel de Recompensas de la Colonia
// ---------------------------------------------------------------------------

/**
 * Escalera de niveles: que otorga cada uno y cuanto falta.
 *
 * No es una tienda: las recompensas se DESBLOQUEAN al alcanzar el nivel, no se
 * compran. El panel solo las muestra (y marca las ya desbloqueadas) porque el
 * jugador necesita saber "que gano si sigo jugando".
 */
export function buildColonyRewardsPanel(
  state: {
    level: number;
    spores: number;
    rewards: ColonyRewardView[];
    /** Esporas de Colonia que aun se pueden ganar hoy (tope duro). `undefined` = sin dato. */
    dailyRemaining?: number;
    /** Tope duro diario, para mostrar "X / 100". */
    dailyCap?: number;
  },
  callbacks: { onClose: () => void },
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-colony-rewards';

  const shell = document.createElement('div');
  shell.className = 'colony-rewards-shell';

  const head = document.createElement('div');
  head.className = 'colony-rewards-head';
  const title = document.createElement('h2');
  title.className = 'colony-rewards-title';
  const titleText = document.createElement('span');
  titleText.textContent = t('colony.rewards');
  title.append(colonyIconEl('is-title'), titleText);
  const sub = document.createElement('p');
  sub.className = 'colony-rewards-subtitle';
  sub.textContent = t('colony.rewardsSubtitle');
  const total = document.createElement('p');
  total.className = 'colony-rewards-total';
  total.dataset['counter'] = 'colony-spores-total';
  total.textContent = t('colony.sporesTotal', { value: formatSpores(state.spores) });
  head.append(title, sub, total);

  // Tope duro diario: cuanto queda HOY. Es la senal honesta de "segui manana".
  if (typeof state.dailyRemaining === 'number' && typeof state.dailyCap === 'number') {
    const daily = document.createElement('p');
    daily.className = 'colony-rewards-daily';
    daily.dataset['counter'] = 'colony-daily-remaining';
    const used = Math.max(0, state.dailyCap - state.dailyRemaining);
    daily.textContent =
      state.dailyRemaining > 0
        ? t('colony.dailyRemaining', {
            value: formatSpores(state.dailyRemaining),
            cap: formatSpores(state.dailyCap),
            used: formatSpores(used),
          })
        : t('colony.dailyCapped', { cap: formatSpores(state.dailyCap) });
    if (state.dailyRemaining <= 0) daily.classList.add('is-capped');
    head.append(daily);
  }

  const list = document.createElement('div');
  list.className = 'colony-rewards-list';

  for (const reward of state.rewards) {
    const row = document.createElement('div');
    row.className = `colony-reward-row${reward.unlocked ? ' is-unlocked' : ''}`;
    row.dataset['level'] = String(reward.level);

    const badge = document.createElement('span');
    badge.className = 'colony-reward-badge';
    badge.textContent = `N${reward.level}`;

    const body = document.createElement('span');
    body.className = 'colony-reward-body';
    const name = document.createElement('span');
    name.className = 'colony-reward-name';
    name.textContent = reward.rewardNameKey
      ? t(reward.rewardNameKey)
      : t('colony.reward.start');
    const cost = document.createElement('span');
    cost.className = 'colony-reward-cost';
    cost.textContent = t('colony.rewardCost', { value: formatSpores(reward.spores) });
    body.append(name, cost);

    const tag = document.createElement('span');
    tag.className = 'colony-reward-tag';
    tag.textContent = reward.unlocked ? t('colony.reward.unlocked') : t('colony.reward.locked');

    row.append(badge, body, tag);
    list.appendChild(row);
  }

  const footer = document.createElement('div');
  footer.className = 'colony-rewards-footer';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'colony-rewards-close';
  close.dataset['act'] = 'colony-rewards-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', callbacks.onClose);
  footer.appendChild(close);

  shell.append(head, list, footer);
  panel.appendChild(shell);
  return panel;
}

// ---------------------------------------------------------------------------
// Panel de Ranking global (V1.3)
// ---------------------------------------------------------------------------

export interface LeaderboardRowView {
  playerId: string;
  displayName: string;
  spores: number;
  level: number;
  isSelf: boolean;
}

export interface LeaderboardScopeView {
  rows: LeaderboardRowView[];
  selfRank: number | null;
  total: number;
  /** Ya formateado ("12 / 340"). */
  rankLabel: string;
  /** 0-100. */
  percentile: number;
  /** Clave i18n del premio que le toca por posicion, o null sin tablero. */
  tierNameKey: string | null;
}

export interface LeaderboardMilestoneView {
  nameKey: string;
  met: boolean;
  progress: number;
  current: number;
  target: number;
}

export interface LeaderboardPanelState {
  /** Hay servidor de ranking configurado. */
  enabled: boolean;
  /** Por que esta apagado (para explicarlo), o null. */
  disabledReason: string | null;
  syncState: 'offline' | 'pending' | 'synced' | 'conflict';
  season: LeaderboardScopeView | null;
  lifetime: LeaderboardScopeView | null;
  milestones: LeaderboardMilestoneView[];
  /** Esporas de Colonia locales (el libro del jugador). */
  localSpores: number;
  /** Esporas VALIDADAS por el servidor, o null si nunca sincronizo. */
  verifiedSpores: number | null;
}

export interface LeaderboardPanelCallbacks {
  onRefresh: () => void;
  onClose: () => void;
}

/**
 * Panel de RANKING: posicion propia, tablero y hitos personales.
 *
 * Dos tableros con pestanas, porque responden preguntas distintas:
 * "como voy esta temporada" (competitivo, y donde un jugador nuevo tiene
 * chance) y "cuanto he acumulado" (prestigio, donde nadie pierde su lugar).
 *
 * Los HITOS van SIEMPRE, incluso sin servidor: el plan es explicito en que la
 * mayoria de los jugadores nunca va a entrar al top 1%, y tiene que poder sentir
 * que su colonia avanza igual.
 */
export function buildLeaderboardPanel(
  state: LeaderboardPanelState,
  callbacks: LeaderboardPanelCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-leaderboard';

  const shell = document.createElement('div');
  shell.className = 'leaderboard-shell';

  // --- Cabecera ---
  const head = document.createElement('div');
  head.className = 'leaderboard-head';
  const title = document.createElement('h2');
  title.className = 'leaderboard-title';
  const titleText = document.createElement('span');
  titleText.textContent = t('colony.ranking');
  title.append(colonyIconEl('is-title'), titleText);
  const sub = document.createElement('p');
  sub.className = 'leaderboard-subtitle';
  sub.textContent = state.enabled
    ? t('colony.rank.subtitle')
    : (state.disabledReason ?? t('colony.rank.offline'));
  head.append(title, sub);

  const numbers = document.createElement('div');
  numbers.className = 'leaderboard-numbers';
  const localValue = document.createElement('span');
  localValue.className = 'leaderboard-number';
  localValue.dataset['counter'] = 'leaderboard-local';
  localValue.textContent = t('colony.rank.local', { value: formatSpores(state.localSpores) });
  numbers.appendChild(localValue);
  if (state.verifiedSpores !== null) {
    const verified = document.createElement('span');
    verified.className = 'leaderboard-number is-verified';
    verified.dataset['counter'] = 'leaderboard-verified';
    verified.textContent = t('colony.rank.verified', { value: formatSpores(state.verifiedSpores) });
    numbers.appendChild(verified);
  }
  const sync = document.createElement('span');
  sync.className = 'leaderboard-sync';
  sync.textContent = t(`colony.account.sync.${state.syncState}`);
  numbers.appendChild(sync);
  head.appendChild(numbers);

  // --- Cuerpo ---
  const body = document.createElement('div');
  body.className = 'leaderboard-body';

  const tabs = document.createElement('div');
  tabs.className = 'leaderboard-tabs';
  const boardWrap = document.createElement('div');
  boardWrap.className = 'leaderboard-board';

  const scopeButtons = new Map<string, HTMLButtonElement>();
  let scope: 'season' | 'lifetime' = 'season';

  const renderBoard = (): void => {
    const view = scope === 'season' ? state.season : state.lifetime;
    for (const [key, button] of scopeButtons) {
      button.classList.toggle('is-active', key === scope);
      button.setAttribute('aria-pressed', String(key === scope));
    }
    boardWrap.innerHTML = '';

    if (!state.enabled || !view || view.rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'leaderboard-empty';
      empty.textContent = state.enabled ? t('colony.rank.empty') : t('colony.rank.offline');
      boardWrap.appendChild(empty);
      return;
    }

    // Posicion propia: es lo primero que mira el jugador.
    const self = document.createElement('div');
    self.className = 'leaderboard-self';
    self.dataset['act'] = 'leaderboard-self';
    const selfRank = document.createElement('span');
    selfRank.className = 'leaderboard-self-rank';
    selfRank.textContent = view.rankLabel;
    const selfBody = document.createElement('span');
    selfBody.className = 'leaderboard-self-body';
    const selfTop = document.createElement('span');
    selfTop.className = 'leaderboard-self-top';
    selfTop.textContent =
      view.selfRank === null
        ? t('colony.rank.unranked')
        : t('colony.rank.percentile', { value: view.percentile });
    const selfTier = document.createElement('span');
    selfTier.className = 'leaderboard-self-tier';
    selfTier.textContent = view.tierNameKey ? t(view.tierNameKey) : '';
    selfBody.append(selfTop, selfTier);
    self.append(selfRank, selfBody);
    boardWrap.appendChild(self);

    const list = document.createElement('div');
    list.className = 'leaderboard-list';
    view.rows.forEach((row, index) => {
      const el = document.createElement('div');
      el.className = `leaderboard-row${row.isSelf ? ' is-self' : ''}`;
      el.dataset['rank'] = String(index + 1);
      const rank = document.createElement('span');
      rank.className = 'leaderboard-row-rank';
      rank.textContent = `#${index + 1}`;
      const name = document.createElement('span');
      name.className = 'leaderboard-row-name';
      name.textContent = row.displayName;
      const level = document.createElement('span');
      level.className = 'leaderboard-row-level';
      level.textContent = t('colony.levelLabel', { level: row.level });
      const spores = document.createElement('span');
      spores.className = 'leaderboard-row-spores';
      spores.textContent = formatSpores(row.spores);
      el.append(rank, name, level, spores);
      list.appendChild(el);
    });
    boardWrap.appendChild(list);
  };

  for (const key of ['season', 'lifetime'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'leaderboard-tab';
    button.dataset['act'] = `leaderboard-scope-${key}`;
    button.textContent = t(`colony.rank.${key}`);
    button.addEventListener('click', () => {
      scope = key;
      renderBoard();
    });
    scopeButtons.set(key, button);
    tabs.appendChild(button);
  }

  // --- Hitos personales ---
  const milestones = document.createElement('div');
  milestones.className = 'leaderboard-milestones';
  for (const milestone of state.milestones) {
    const row = document.createElement('div');
    row.className = `leaderboard-milestone${milestone.met ? ' is-met' : ''}`;
    const name = document.createElement('span');
    name.className = 'leaderboard-milestone-name';
    name.textContent = t(milestone.nameKey);
    const track = document.createElement('span');
    track.className = 'leaderboard-milestone-track';
    const fill = document.createElement('span');
    fill.className = 'leaderboard-milestone-fill';
    fill.style.width = `${Math.round(milestone.progress * 100)}%`;
    track.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'leaderboard-milestone-value';
    value.textContent = `${formatSpores(milestone.current)} / ${formatSpores(milestone.target)}`;
    row.append(name, track, value);
    milestones.appendChild(row);
  }

  body.append(tabs, boardWrap, milestones);

  // --- Pie ---
  const footer = document.createElement('div');
  footer.className = 'leaderboard-footer';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'leaderboard-refresh';
  refresh.dataset['act'] = 'leaderboard-refresh';
  refresh.textContent = t('colony.rank.refresh');
  refresh.disabled = !state.enabled;
  refresh.addEventListener('click', callbacks.onRefresh);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'leaderboard-close';
  close.dataset['act'] = 'leaderboard-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', callbacks.onClose);
  footer.append(refresh, close);

  renderBoard();
  shell.append(head, body, footer);
  panel.appendChild(shell);
  return panel;
}

// ---------------------------------------------------------------------------
// Panel de Desafios (menu de la esquina superior derecha)
// ---------------------------------------------------------------------------

export interface ChallengesPanelCallbacks {
  onOpenDaily: () => void;
  onOpenAscension: () => void;
  onOpenArchetypes: () => void;
  onOpenBoard: () => void;
  onClose: () => void;
}

export interface ChallengesPanelState {
  dailyPending?: boolean;
  ascension?: { unlocked: number; selected: number; max: number };
  archetypes?: MenuArchetype[];
  selectedArchetype?: string;
  showBoard?: boolean;
}

/**
 * Panel de DESAFIOS: "como queres jugar".
 *
 * Reune los modos que cambian las reglas o la forma de puntuar: el desafio
 * diario, la Ascension (dificultad) y el Arquetipo (forma de puntuar), mas el
 * Duelo micelial cuando el contenido lo trae. Antes eran chips sueltos en el
 * menu; ahora viven juntos y el centro queda libre para la accion principal.
 */
export function buildChallengesPanel(
  state: ChallengesPanelState,
  callbacks: ChallengesPanelCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-challenges';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('menu.challenges');

  const sub = document.createElement('p');
  sub.className = 'panel-subtitle';
  sub.textContent = t('menu.challengesSubtitle');

  const body = document.createElement('div');
  body.className = 'challenges-body';
  const grid = document.createElement('div');
  grid.className = 'challenges-grid';

  const card = (
    label: string,
    detail: string,
    act: string,
    onClick: () => void,
    pending = false,
  ): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `challenges-card${pending ? ' is-pending' : ''}`;
    el.dataset['act'] = act;
    const name = document.createElement('span');
    name.className = 'challenges-card-name';
    name.textContent = label;
    const det = document.createElement('span');
    det.className = 'challenges-card-detail';
    det.textContent = detail;
    el.append(name, det);
    el.addEventListener('click', onClick);
    return el;
  };

  grid.appendChild(
    card(
      t('menu.daily'),
      state.dailyPending ? t('daily.ready') : '',
      'daily',
      callbacks.onOpenDaily,
      Boolean(state.dailyPending),
    ),
  );

  if (state.ascension && state.ascension.max > 0) {
    const lvl = state.ascension.selected;
    grid.appendChild(
      card(
        t('ascension.title'),
        lvl > 0 ? t(ascensionNameKey(lvl)) : t('ascension.off'),
        'ascension',
        callbacks.onOpenAscension,
      ),
    );
  }

  if ((state.archetypes?.length ?? 0) > 0) {
    const selected = (state.archetypes ?? []).find((a) => a.id === (state.selectedArchetype ?? ''));
    grid.appendChild(
      card(
        t('archetype.title'),
        selected ? t(selected.nameKey) : t('archetype.classic.name'),
        'archetype',
        callbacks.onOpenArchetypes,
      ),
    );
  }

  if (state.showBoard) {
    grid.appendChild(card(t('board.title'), t('menu.modes'), 'board', callbacks.onOpenBoard));
  }

  body.appendChild(grid);

  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.dataset['act'] = 'challenges-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', callbacks.onClose);
  actions.appendChild(close);

  panel.append(title, sub, body, actions);
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
 * Cambios CONCRETOS que aplica un nivel respecto del anterior.
 *
 * Por que se derivan y no se escriben a mano en i18n: la descripcion escrita
 * (`ascension.a5.desc`) es prosa, y la prosa se desincroniza del JSON en cuanto
 * alguien retoca un modificador. Aca cada linea sale de COMPARAR los dos
 * `AscensionModifiers`, asi que el panel nunca puede mentir sobre lo que cambia.
 *
 * Los unicos textos son las ETIQUETAS del modificador (`ascension.mod.*`), que
 * son estables.
 */
interface AscensionDelta {
  icon: string;
  labelKey: string;
  /** Valor con signo, ya formateado ("+10%", "-1", "no"). */
  value: string;
  /** `true` si empeora la dificultad: pinta la fila en rojo suave. */
  harsh: boolean;
}

function pct(multiplier: number | undefined): string {
  const value = Math.round(((multiplier ?? 1) - 1) * 100);
  return `${value > 0 ? '+' : ''}${value}%`;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

/**
 * Deltas de A(level) respecto de A(level-1). A0 no tiene deltas: es la base.
 *
 * Solo se listan los modificadores que CAMBIAN en este nivel. Repetir en A5 lo
 * que ya cambió en A2 haria que la escalera se leyera como una lista plana de
 * castigos y no como "que agrega cada peldano".
 */
function ascensionDeltas(
  current: AscensionModifiersLike | undefined,
  previous: AscensionModifiersLike | undefined,
): AscensionDelta[] {
  const deltas: AscensionDelta[] = [];
  const cur = current ?? {};
  const prev = previous ?? {};

  const num = (key: keyof AscensionModifiersLike): { now: number; was: number } => ({
    now: typeof cur[key] === 'number' ? (cur[key] as number) : key === 'targetMultiplier' || key === 'shopCostMultiplier' ? 1 : 0,
    was: typeof prev[key] === 'number' ? (prev[key] as number) : key === 'targetMultiplier' || key === 'shopCostMultiplier' ? 1 : 0,
  });

  const target = num('targetMultiplier');
  if (target.now !== target.was) {
    deltas.push({ icon: '◎', labelKey: 'ascension.mod.target', value: pct(target.now), harsh: true });
  }
  const shop = num('shopCostMultiplier');
  if (shop.now !== shop.was) {
    deltas.push({ icon: '⌂', labelKey: 'ascension.mod.shop', value: pct(shop.now), harsh: true });
  }
  const hands = num('baseHands');
  if (hands.now !== hands.was) {
    deltas.push({ icon: '✋', labelKey: 'ascension.mod.hands', value: signed(hands.now), harsh: hands.now < hands.was });
  }
  const discards = num('baseDiscards');
  if (discards.now !== discards.was) {
    deltas.push({ icon: '↻', labelKey: 'ascension.mod.discards', value: signed(discards.now), harsh: discards.now < discards.was });
  }
  const handSize = num('baseHandSize');
  if (handSize.now !== handSize.was) {
    deltas.push({ icon: '▦', labelKey: 'ascension.mod.handSize', value: signed(handSize.now), harsh: handSize.now < handSize.was });
  }
  const jokerSlots = num('jokerSlots');
  if (jokerSlots.now !== jokerSlots.was) {
    deltas.push({ icon: '✦', labelKey: 'ascension.mod.jokerSlots', value: signed(jokerSlots.now), harsh: jokerSlots.now < jokerSlots.was });
  }
  const reroll = num('rerollCostDelta');
  if (reroll.now !== reroll.was) {
    deltas.push({ icon: '⟳', labelKey: 'ascension.mod.reroll', value: signed(reroll.now), harsh: reroll.now > reroll.was });
  }
  const money = num('moneyDelta');
  if (money.now !== money.was) {
    deltas.push({ icon: '🪙', labelKey: 'ascension.mod.money', value: signed(money.now), harsh: money.now > money.was });
  }
  const purge = num('purgeCostDelta');
  if (purge.now !== purge.was) {
    deltas.push({ icon: '✂', labelKey: 'ascension.mod.purge', value: signed(purge.now), harsh: purge.now > purge.was });
  }
  // `allowDieReroll === false` es el unico modificador booleano.
  if (cur.allowDieReroll === false && prev.allowDieReroll !== false) {
    deltas.push({ icon: '🎲', labelKey: 'ascension.mod.noDieReroll', value: '', harsh: true });
  }
  return deltas;
}

/** Subconjunto de `AscensionModifiers` que el panel necesita. */
export interface AscensionModifiersLike {
  targetMultiplier?: number;
  shopCostMultiplier?: number;
  baseHands?: number;
  baseDiscards?: number;
  baseHandSize?: number;
  jokerSlots?: number;
  rerollCostDelta?: number;
  moneyDelta?: number;
  purgeCostDelta?: number;
  allowDieReroll?: boolean;
}


/**
 * Panel de seleccion de ascension.
 *
 * Lista TODOS los niveles (A0..max). Los que superan `unlocked` van bloqueados
 * con la condicion escrita (`ascension.unlockHint`), no con un candado mudo:
 * el jugador tiene que saber QUE hacer para abrirlos.
 *
 * Cada nivel DESBLOQUEADO muestra, ademas de la prosa: la lista de cambios
 * concretos respecto del nivel anterior (derivada de los modificadores, ver
 * `ascensionDeltas`), que es lo que el jugador necesita para decidir "vale la
 * pena subir un peldano?". Antes solo habia una frase y el jugador no sabia si
 * A5 le quitaba una mano, un descarte o los dos.
 */
export function buildAscensionPanel(
  state: {
    unlocked: number;
    selected: number;
    max: number;
    /** Modificadores reales por nivel (indice = level). Vacio = sin detalle. */
    modifiers?: Array<AscensionModifiersLike | undefined>;
  },
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
  // "Para quien es": la escalera no es un castigo, es un desafio para quien ya
  // domina el mazo base. Sin esta linea, cada peldano se lee como una perdida.
  const why = document.createElement('p');
  why.className = 'ascension-why';
  why.textContent = t('ascension.whyBody');
  head.append(title, sub, why);

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

    // Detalle derivado: que CAMBIA este nivel respecto del anterior. Solo para
    // desbloqueados (a los trabados ya se les explica la condicion de apertura).
    if (unlocked && level > 0) {
      const deltas = ascensionDeltas(state.modifiers?.[level], state.modifiers?.[level - 1]);
      if (deltas.length > 0) {
        const detail = document.createElement('span');
        detail.className = 'ascension-changes';
        for (const delta of deltas) {
          const row = document.createElement('span');
          row.className = `ascension-change${delta.harsh ? ' is-harsh' : ''}`;
          row.dataset['mod'] = delta.labelKey;
          const icon = document.createElement('span');
          icon.className = 'ascension-change-icon';
          icon.textContent = delta.icon;
          const label = document.createElement('span');
          label.className = 'ascension-change-label';
          label.textContent = t(delta.labelKey);
          const value = document.createElement('span');
          value.className = 'ascension-change-value';
          value.textContent = delta.value;
          row.append(icon, label, value);
          detail.appendChild(row);
        }
        body.appendChild(detail);
      }
      // Recompensa por superarlo: subir el peldano desbloquea el siguiente.
      const reward = document.createElement('span');
      reward.className = 'ascension-reward';
      reward.textContent =
        level < state.max
          ? t('ascension.rewardUnlock', { next: level + 1 })
          : t('ascension.rewardMax');
      body.appendChild(reward);
    }

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

// ---------------------------------------------------------------------------
// Panel de arquetipos
// ---------------------------------------------------------------------------

export interface ArchetypePanelCallbacks {
  /** El jugador confirmo un arquetipo y quiere arrancar la run. */
  onStart: (archetypeId: string) => void;
  onClose: () => void;
}

/**
 * Panel de seleccion de arquetipo: la FORMA DE PUNTUAR de la run.
 *
 * Es lo primero que se elige al arrancar, porque cambia el mazo inicial, el
 * sesgo de la tienda y la fantasia entera. Cada tarjeta tiene que responder
 * cuatro preguntas que en la version anterior quedaban implicitas:
 *
 *   - COMO puntua (el motor de la fantasia).
 *   - DEBILIDAD (para que la eleccion tenga costo).
 *   - Elemento firma (acento visual, coherencia con la coleccion).
 *   - Mazo (cuantas cartas y de que).
 *
 * El "clasico" va PRIMERO y sin sesgo: quien no quiera elegir arranca con las
 * reglas de siempre. La seleccion es de dos toques (elegir + empezar) porque el
 * toque suelto es facil de disparar sin querer en celular: empezar una run por
 * accidente cuesta una partida entera.
 */
export function buildArchetypePanel(
  state: { archetypes: MenuArchetype[]; selected: string; starterSizes: Record<string, number> },
  callbacks: ArchetypePanelCallbacks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-archetypes';

  const shell = document.createElement('div');
  shell.className = 'archetypes-shell';

  const head = document.createElement('div');
  head.className = 'archetypes-head';
  const title = document.createElement('h2');
  title.className = 'archetypes-title';
  title.textContent = t('archetype.title');
  const sub = document.createElement('p');
  sub.className = 'archetypes-subtitle';
  sub.textContent = t('archetype.subtitle');
  head.append(title, sub);

  const list = document.createElement('div');
  list.className = 'archetypes-list';

  // El clasico primero. No es una entrada del JSON: es la ausencia de arquetipo.
  const cards: Array<{
    id: string;
    nameKey: string;
    taglineKey: string;
    howKey: string;
    weaknessKey: string;
    element: string;
    size: number;
  }> = [
    {
      id: '',
      nameKey: 'archetype.classic.name',
      taglineKey: 'archetype.classic.tagline',
      howKey: 'archetype.classic.how',
      weaknessKey: 'archetype.classic.weakness',
      element: 'neutral',
      size: state.starterSizes[''] ?? 0,
    },
    ...state.archetypes.map((a) => ({
      id: a.id,
      nameKey: a.nameKey,
      taglineKey: a.taglineKey,
      howKey: a.howKey,
      weaknessKey: a.weaknessKey,
      element: a.element,
      size: state.starterSizes[a.id] ?? 0,
    })),
  ];

  let selected = state.selected;

  const cardEls = new Map<string, HTMLButtonElement>();

  const nameKeyOf = (id: string): string =>
    cards.find((c) => c.id === id)?.nameKey ?? 'archetype.classic.name';

  for (const card of cards) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'archetype-card';
    el.dataset['act'] = 'archetype-pick';
    el.dataset['archetype'] = card.id;
    el.style.setProperty('--archetype-color', `var(--element-${card.element}, var(--accent, #c4a8ff))`);

    const dot = document.createElement('span');
    dot.className = 'archetype-dot';

    const body = document.createElement('span');
    body.className = 'archetype-body';
    const name = document.createElement('span');
    name.className = 'archetype-name';
    name.textContent = t(card.nameKey);
    const tagline = document.createElement('span');
    tagline.className = 'archetype-tagline';
    tagline.textContent = t(card.taglineKey);
    body.append(name, tagline);

    const deck = document.createElement('span');
    deck.className = 'archetype-deck';
    deck.textContent = card.size > 0 ? t('archetype.deckCount', { count: card.size }) : '';

    const tag = document.createElement('span');
    tag.className = 'archetype-tag';

    // Detalle: se pliega dentro de la tarjeta y solo se ve en la ELEGIDA. Asi
    // la lista queda compacta (4 opciones deben entrar sin scroll en celular) y
    // el jugador lee el "como/que cuesta" justo del que tiene marcado.
    const detail = document.createElement('span');
    detail.className = 'archetype-detail';
    const how = document.createElement('span');
    how.className = 'archetype-how';
    how.textContent = t(card.howKey);
    const weak = document.createElement('span');
    weak.className = 'archetype-weakness';
    weak.textContent = t(card.weaknessKey);
    detail.append(how, weak);
    el.dataset['how'] = t(card.howKey);
    el.dataset['weakness'] = t(card.weaknessKey);

    el.append(dot, body, deck, tag, detail);
    el.addEventListener('click', () => {
      // Segundo toque sobre el mismo = arrancar. Es el patron de doble toque que
      // ya usa la tienda para vender: evita que un roce arranque una run.
      if (selected === card.id) {
        callbacks.onStart(card.id);
        return;
      }
      selected = card.id;
      paintSelection();
    });

    cardEls.set(card.id, el);
    list.appendChild(el);
  }

  const footer = document.createElement('div');
  footer.className = 'archetypes-footer';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'archetypes-close';
  back.dataset['act'] = 'archetypes-close';
  back.textContent = t('ui.close');
  back.addEventListener('click', callbacks.onClose);

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn is-play archetypes-start';
  startBtn.dataset['act'] = 'archetypes-start';
  startBtn.textContent = t('menu.newRun');
  startBtn.addEventListener('click', () => callbacks.onStart(selected));

  footer.append(back, startBtn);

  shell.append(head, list, footer);
  panel.appendChild(shell);
  // `paintSelection` toca `startBtn`, asi que se define (y se llama) recien
  // despues de declararlo. Un `const` no se hoistea como una `function`.
  const paintSelection = (): void => {
    for (const [id, el] of cardEls) {
      const isSelected = id === selected;
      el.classList.toggle('is-selected', isSelected);
      const tag = el.querySelector('.archetype-tag');
      if (tag) tag.textContent = isSelected ? t('archetype.selected') : t('archetype.select');
    }
    startBtn.textContent = t('archetype.startWith', { name: t(nameKeyOf(selected)) });
  };
  paintSelection();
  return panel;
}
