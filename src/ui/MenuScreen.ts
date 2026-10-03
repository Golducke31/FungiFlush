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
  // "Nueva partida" abre el selector de ARQUETIPO (la forma de puntuar) en vez
  // de arrancar directo. El arquetipo es una decision de run, no un ajuste: si
  // se pudiera cambiar despues, dejaria de ser una identidad.
  const hasArchetypes = (state.archetypes?.length ?? 0) > 0;
  const play = artButton(
    'play',
    t('menu.newRun'),
    'new',
    hasArchetypes ? callbacks.onOpenArchetypes : callbacks.onStartRun,
  );
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

  // Arquetipo: el chip dice CON QUE se va a jugar. Sin arquetipos en el
  // contenido no aparece, para no ofrecer una puerta a un panel vacio.
  {
    const archetypes = state.archetypes ?? [];
    const selected = archetypes.find((a) => a.id === (state.selectedArchetype ?? ''));
    const classic = !selected;
    chips.appendChild(
      chip(
        classic ? t('archetype.classic.name') : t(selected.nameKey),
        'archetype',
        callbacks.onOpenArchetypes,
        {
          mod: `menu-ghost--archetype${classic ? '' : ' is-active'}`,
          ...(classic
            ? { title: t('archetype.classic.tagline') }
            : { title: t(selected.taglineKey) }),
          hidden: archetypes.length === 0,
        },
      ),
    );
  }

  chips.appendChild(
    chip(t('menu.daily'), 'daily', callbacks.onOpenDaily, {      mod: `menu-ghost--daily${state.dailyPending ? ' is-pending' : ''}`,
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
  chips.appendChild(
    chip(t('menu.history'), 'history', callbacks.onOpenHistory, {
      mod: 'menu-ghost--history',
    }),
  );
  chips.appendChild(
    chip(t('menu.guide'), 'guide', callbacks.onOpenGuide, {
      mod: 'menu-ghost--guide',
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
