/**
 * HUD.ts — Interfaz en DOM, superpuesta al canvas 3D.
 *
 * Por que DOM y no Three.js: texto nitido a cualquier DPI, accesibilidad,
 * seleccion, y cero coste de GPU. Un juego de cartas necesita MUCHO texto
 * (nombres, descripciones, numeros) y dibujarlo con sprites seria un suicidio
 * de rendimiento y de legibilidad.
 *
 * El HUD no conoce las reglas: lee el estado del motor y emite intenciones
 * ("el jugador quiere jugar la mano"). Quien decide es el controlador.
 */

import {
  bus,
  jokerSellValue,
  MAX_PLAY_SIZE,
  type CardDefinition,
  type CardInstance,
  type GameEngine,
  type InterludeChoice,
  type InterludeEffect,
  type JokerDefinition,
  type RunSnapshot,
  type ScoreBreakdown,
  type ShopOffer,
} from '@engine/index';
import type { BoardView } from '@engine/board';
import type { RoundState } from '@engine/state/RoundState';
import { t } from '@i18n/index';
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';
import * as anim from '@render/anim';
import type { ProfileSettings } from '@meta/ProfileState';
import { offerFaceUrl } from './cardArt';
import { SORT_LABEL_KEY, SORT_MODES, type SortMode } from './handSort';
import { buildArchetypePanel, buildAscensionPanel, buildMenuPanel } from './MenuScreen';
import { buildCosmeticsPanel, type CosmeticKind, type CosmeticsState } from './CosmeticsScreen';
import { buildHistoryPanel, type HistoryEntryView } from './HistoryScreen';
import { buildSettingsPanel } from './SettingsScreen';
import { buildAboutPanel } from './AboutScreen';
import { buildRewardPanel } from './RewardPanel';
import {
  buildDeckBuilderPanel,
  type DeckBuilderState,
  type DeckCardInfo,
} from './DeckBuilderScreen';
import { buildCollectionPanel, type CollectionEntry } from './CollectionScreen';
import { buildDailyRewardPanel } from './DailyRewardPanel';
import { buildAchievementsPanel, type AchievementView } from './AchievementsScreen';
import { BoardScreen, type BoardResolvers, type BoardScreenCallbacks } from './BoardScreen';
import type { DailyEvaluation, DailyRewardTable } from '../retention/DailyReward';
import type { RetentionReward } from '../retention/types';

// La tirada de dado por gesto se retiro del flujo de ciego: cada ante juega sus
// 3 ciegos en orden. El dado sobrevive como habilidad del Simbionte legendario.

export interface HudCallbacks {
  onPlay: () => void;
  onDiscard: () => void;
  onClear: () => void;
  onBuy: (offerId: string) => void;
  onReroll: () => void;
  onSellJoker: (uid: string) => void;
  /** El jugador toco la ficha de un joker: la carta late en la mesa. */
  onFocusJoker: (uid: string) => void;
  onLeaveShop: () => void;
  /**
   * Arranca el ciego en curso del ante. Los 3 ciegos se juegan EN ORDEN, asi
   * que no existe eleccion: este es el unico camino para empezar un ciego.
   */
  onStartBlind: () => void;
  onRestart: () => void;
  /**
   * Abandonar la run y volver al MENU PRINCIPAL (boton "Menu" del HUD).
   *
   * Distinto de `onRestart`, que arranca otra run de inmediato: aca el jugador
   * sale al menu. El controlador se encarga de borrar el guardado, o al recargar
   * le ofreceria "Continuar" una run que acaba de abandonar.
   */
  onQuitToMenu: () => void;
  onToggleLanguage: () => void;
  onContinueRun: () => void;
  // --- Pantalla de inicio ---
  onStartRun: () => void;
  onOpenCollection: () => void;
  onOpenExpansions: () => void;
  onOpenPass: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  /** Guia de inicio reabrible desde el menu (v2). */
  onOpenGuide: () => void;
  // --- Retencion: recompensa diaria y logros ---
  onOpenDaily: () => void;
  onClaimDaily: () => void;
  onOpenAchievements: () => void;
  // --- R1: ascension ---
  /** El jugador eligio un nivel de ascension (0 = sin ascension). */
  onSelectAscension: (level: number) => void;
  // --- Fase 2: recompensa y deckbuilding ---
  /** `null` = saltar el draft. */
  onPickReward: (offerId: string | null) => void;
  /**
   * Se llama al abrir CUALQUIER panel, con si es un panel montado sobre el
   * carrusel 3D. El controlador lo usa para apagar la escena 3D cuando el panel
   * nuevo no la usa (si no, el anillo quedaria vivo detras de un panel DOM).
   */
  onPanelOpened?: (isCarousel: boolean) => void;
  /**
   * El panel abierto TAPA la arena (true) o la deja a la vista (false).
   *
   * No es lo mismo que "hay un panel": durante la tirada del dado el panel esta
   * abierto pero corrido, y la arena tiene que verse entera. El render usa esto
   * para esconder el dado cuando algo lo tapa.
   */
  onArenaCovered?: (covered: boolean) => void;
  onPurge: (uid: string) => void;
  onUpgrade: (uid: string) => void;
  onEvolve: (uid: string) => void;
  onOpenDeck: () => void;
  /**
   * Habilidad ACTIVA del Simbionte legendario del dado: carga una cara para la
   * proxima mano. Solo se ofrece cuando el Simbionte esta en la mesa y su carga
   * esta lista.
   */
  onUseLoadedDie: () => void;
  /**
   * Reordenar la mano (P1.3/P1.4). El criterio lo resuelve el controlador con
   * `sortHand()`, que es puro; aca solo se avisa QUE criterio se pidio.
   */
  onSortHand: (mode: SortMode) => void;
  /** El jugador eligio una opcion del interludio (P2.4). */
  onChooseInterlude: (choiceId: string) => void;
  // --- Fase 5: duelo micelial (hot-seat) ---
  onOpenBoard: () => void;
  // --- R4b: cosméticos (dorso de carta / tapete) ---
  onOpenCosmetics: () => void;
  onEquip: (kind: 'cardback' | 'felt', id: string) => void;
  // --- R5: historial de partidas ---
  onOpenHistory: () => void;
  // --- Arquetipos: la forma de puntuar de la run ---
  /**
   * El jugador eligio un arquetipo y quiere arrancar la run con el.
   * `''` = clasico (mazo base, sin sesgo de tienda).
   */
  onStartRunWithArchetype: (archetypeId: string) => void;
}

/** Datos de build que muestra el menu / acerca de. */
export interface HudAppInfo {
  version: string;
  contentHash: string | null;
  packs: string[];
  skipped?: Array<{ id: string; reason: string }>;
}

/** Formatea numeros grandes como en los juegos de puntuacion. */
function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

/**
 * Formatea el multiplicador de un ciego: `1` en vez de `1.0`, pero conserva los
 * decimales utiles (`1.5`, `2.5`) y recorta ruido de coma flotante (`1.10`).
 */
function formatMultiplier(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export class HUD {
  private readonly engine: GameEngine;
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLElement;
  /** Ilustracion real de una carta. Ver la nota del constructor. */
  private readonly cardArt?: (def: CardDefinition) => HTMLImageElement | undefined;
  /** Ilustracion real de un joker. Ver la nota del constructor. */
  private readonly jokerArt?: (def: JokerDefinition) => HTMLImageElement | undefined;
  /** Ilustracion real de un ciego, por su clave `art`. Ver el constructor. */
  private readonly blindArt?: (art: string | undefined) => HTMLImageElement | undefined;
  /**
   * Refresco en vivo del panel de la tienda, o `null` si no hay tienda abierta.
   *
   * El panel se construye UNA vez (y reconstruirlo es caro: cada oferta dibuja
   * su carta en un canvas y la pasa a data URL). Pero el dinero cambia mientras
   * la tienda esta abierta — al comprar, al vender un joker, o al volver del
   * mazo despues de mejorar. Sin este refresco el subtitulo y los botones se
   * quedan con el dinero de cuando se abrio: se veian "7 Fungis" y los tres
   * botones habilitados con 3 en la caja, y cada click daba "no te alcanza".
   */
  private shopRefresh: (() => void) | null = null;
  private readonly appInfo: HudAppInfo;

  // Referencias cacheadas: buscar en el DOM cada frame es gratis hasta que
  // deja de serlo. Con 60 FPS y 20 nodos, importa.
  private elScore = document.createElement('span');
  private elTarget = document.createElement('span');
  private elProgress = document.createElement('div');
  private elAnte = document.createElement('span');
  private elAnteRail = document.createElement('div');
  /** Total de antenas del contenido, para no reconstruir el riel cada render. */
  private anteRailTotal = -1;
  private elMoney = document.createElement('span');
  private elBlind = document.createElement('div');
  private elCounters = document.createElement('div');
  private elJokers = document.createElement('div');
  private elActions = document.createElement('div');
  private elOverlay = document.createElement('div');
  private elTooltip = document.createElement('div');
  private elPopups = document.createElement('div');
  private elToasts = document.createElement('div');
  /**
   * Aviso no bloqueante (`.banner-stack`).
   *
   * Va entre el overlay (80) y el toast (90): si compartiera capa con el toast
   * competiria por el mismo lugar en pantalla, y si quedara debajo del overlay
   * un panel abierto lo taparia justo cuando se lo necesita. Es `pointer-events:
   * none` igual que el toast: un aviso que se come los toques es un bug.
   */
  private elBanner = document.createElement('div');
  private elPreview = document.createElement('div');
  /**
   * Franja de OBJETIVO de la ronda (P0.1): "OBJETIVO 300 puntos · MANOS 4 ·
   * DESCARTES 3". Va pegada a la barra de progreso, que es donde el jugador
   * mira para saber si va ganando.
   */
  private elObjective = document.createElement('div');
  /** Aviso de que la barra avanza solo al jugar (P0.2). Se muestra y se apaga. */
  private elBarNotice = document.createElement('div');
  /** Guia de seleccion sobre la mano (P0.3). */
  private elSelectHint = document.createElement('div');
  /**
   * Franja de MISIONES de la run (P2.6). Va debajo de los jokers: es la lista
   * de objetivos cortos que dan direccion entre ciego y ciego.
   */
  private elMissions = document.createElement('div');
  /** Contador grande: aparece durante la secuencia y suma en vivo. */
  private elTicker = document.createElement('div');
  private elTickerOp = document.createElement('span');
  private elTickerTotal = document.createElement('span');
  private elTickerSource = document.createElement('div');
  /** Pasos del calculo de la mano actual (el motor los emite todos juntos). */
  private scoreStepCount = 0;
  /** Puntaje final de la mano, para repartir el conteo entre los pasos. */
  private scoreHandTotal = 0;
  private tickerTimer: number | null = null;
  /** La secuencia de puntaje esta corriendo: ningun panel puede taparla. */
  private scoreSettling = false;
  /**
   * Vencimiento del bloqueo. Red de seguridad: si por lo que sea el aviso de fin
   * no llega (una timeline matada sin sucesora), el HUD no puede quedarse sin
   * mostrar NINGUN panel para siempre.
   */
  private scoreSettleDeadline = 0;
  /** Habia un panel esperando a que la secuencia terminara. */
  private panelPending = false;
  /** El aviso de "ciego superado" ya se mostro para esta ronda. */
  private clearedShown = false;
  /** El jugador ya apreto "Continuar" en el aviso de ciego superado. */
  private clearedAdvanced = false;
  /** La guia de inicio ya se mostro en esta sesion (P0.3 / v2). */
  private tutorialShown = false;
  /** Estado del mazo de la ultima transicion (P1.5), para la linea post-ciego. */
  private lastDeckDelta: { conserved: number; gained: number; destroyed: number } | null = null;
  /** Desglose de la ultima mano jugada (P0.4), para mostrarlo al cerrar el ciego. */
  private lastBreakdown: {
    breakdown: ScoreBreakdown;
    total: number;
    handSize: number;
  } | null = null;
  /** Criterio de orden activo en la mano (P1.3/P1.4). 'default' = orden del mazo. */
  private sortMode: SortMode = 'default';

  // --- Ciego: el panel ya es solo informativo (la ruta del ante) ---
  /** Ultimo valor avisado por `syncArenaCovered`. */
  private arenaCovered = false;

  private readonly unsubscribes: Array<() => void> = [];
  private lastStatus: string | null = null;
  /** Info del guardado disponible, para ofrecer "Continuar" al arrancar. */
  private continueLabel: string | null = null;
  /** Ascension (R1): se la empuja el controlador desde el perfil. */
  private ascensionState: {
    unlocked: number;
    selected: number;
    max: number;
    /** Modificadores por nivel, para el detalle "que cambia". Indice = nivel. */
    modifiers: Array<Record<string, number | boolean | undefined> | undefined>;
  } = {
    unlocked: 0,
    selected: 0,
    max: 0,
    modifiers: [],
  };
  /** Cosméticos (R4b): se los empuja el controlador desde el perfil. */
  private cosmeticsState: CosmeticsState = {
    owned: ['default'],
    equipped: { cardback: 'default', felt: 'default' },
  };
  /** Historial (R5): se lo empuja el controlador desde el perfil. */
  private historyState: HistoryEntryView[] = [];
  /**
   * Arquetipos disponibles y el elegido. Los empuja el controlador desde el
   * contenido (`archetypes.json`) y el perfil: el HUD no conoce ninguno de los
   * dos. `starterSizes` es el total de cartas de cada mazo inicial, para que la
   * tarjeta pueda decir "Mazo de 20 cartas" sin que el HUD cuente copias.
   */
  private archetypeState: {
    list: Array<{
      id: string;
      nameKey: string;
      taglineKey: string;
      howKey: string;
      weaknessKey: string;
      element: string;
    }>;
    selected: string;
    starterSizes: Record<string, number>;
  } = { list: [], selected: '', starterSizes: {} };
  /** Contador de cierres: invalida el `animationend` de un cierre viejo. */
  private closeSeq = 0;
  /** Respaldo por si `animationend` no llega (animacion desactivada). */
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: {
    engine: GameEngine;
    root: HTMLElement;
    callbacks: HudCallbacks;
    appInfo?: HudAppInfo;
    /**
     * Ilustracion real de una carta. La inyecta el render, que es quien tiene
     * los WebP cargados. Sin esto las miniaturas caen al dibujo procedural y la
     * misma carta se ve distinta en la mano que en el mazo.
     */
    cardArt?: (def: CardDefinition) => HTMLImageElement | undefined;
    /** Igual que `cardArt`, para jokers. */
    jokerArt?: (def: JokerDefinition) => HTMLImageElement | undefined;
    /**
     * Igual que `cardArt`, para ciegos. Recibe la clave `BlindDefinition.art`
     * (no la definicion entera): el mapa de arte se indexa por clave, y asi la
     * UI no necesita saber cual es el ciego actual.
     */
    blindArt?: (art: string | undefined) => HTMLImageElement | undefined;
  }) {
    this.engine = options.engine;
    this.root = options.root;
    this.callbacks = options.callbacks;
    this.cardArt = options.cardArt;
    this.jokerArt = options.jokerArt;
    this.blindArt = options.blindArt;
    this.appInfo = options.appInfo ?? { version: '0.0.0', contentHash: null, packs: [] };
    this.build();
    this.subscribe();
    this.render();
  }

  // ==========================================================================
  // Construccion del DOM
  // ==========================================================================

  private build(): void {
    this.root.innerHTML = '';

    // --- Barra superior ---
    const top = document.createElement('header');
    top.className = 'hud-top';

    const anteBlock = document.createElement('div');
    anteBlock.className = 'hud-block hud-ante';
    const anteLabel = document.createElement('div');
    anteLabel.className = 'hud-label';
    anteLabel.textContent = t('hud.ante');
    this.elAnte.className = 'hud-value';
    // Riel de antenas: marca en que punto de la carrera estas de un vistazo, sin
    // tener que leer el numero. `buildAnteRail` lo llena segun el ante total.
    this.elAnteRail.className = 'hud-ante-rail';
    anteBlock.append(anteLabel, this.elAnte, this.elAnteRail);

    const scoreBlock = document.createElement('div');
    scoreBlock.className = 'hud-block hud-score';
    const scoreMain = document.createElement('div');
    scoreMain.className = 'hud-score-main';
    this.elScore.className = 'hud-score-current';
    this.elScore.textContent = '0';
    this.elTarget.className = 'hud-score-target';
    this.elTarget.textContent = '/ 0';
    scoreMain.append(this.elScore, this.elTarget);
    this.elProgress.className = 'hud-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'hud-progress-fill';
    this.elProgress.appendChild(progressFill);
    // P0.2 — La barra SOLO avanza al jugar una mano. Este aviso vive pegado a
    // ella porque es exactamente el malentendido que el plan detecta: el
    // jugador mira la barra, ve que no se mueve al seleccionar y necesita saber
    // que eso es correcto, no un bug.
    this.elBarNotice.className = 'hud-bar-notice';
    this.elBarNotice.textContent = t('guide.barNotice');
    // P0.1 — Objetivo/manos/descartes bajo la barra.
    this.elObjective.className = 'hud-objective';
    this.elBlind.className = 'hud-blind-name';
    this.elPreview.className = 'hud-preview';
    scoreBlock.append(
      scoreMain,
      this.elProgress,
      this.elBarNotice,
      this.elObjective,
      this.elBlind,
      this.elPreview,
    );

    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.gap = 'var(--gap)';

    const moneyBlock = document.createElement('div');
    moneyBlock.className = 'hud-block hud-money';
    const moneyLabel = document.createElement('div');
    moneyLabel.className = 'hud-label';
    moneyLabel.textContent = t('hud.money');
    // El icono va al lado del numero, no en la etiqueta: la etiqueta es texto
    // traducible y el icono no. Juntos en una fila propia quedan centrados
    // entre si sin depender de `line-height`.
    const moneyRow = document.createElement('div');
    moneyRow.className = 'hud-money-row';
    const moneyIcon = document.createElement('img');
    moneyIcon.className = 'hud-money-icon';
    // Ruta relativa (no `/ui/...`): con `base: './'` de Vite esto resuelve
    // igual en el dev server y bajo el protocolo asset:// de Tauri.
    moneyIcon.src = 'ui/fungi.png';
    // Decorativo: el numero ya dice cuanto hay, y el lector de pantalla ya lee
    // la etiqueta "Fungis". Anunciar el icono seria ruido.
    moneyIcon.alt = '';
    moneyIcon.setAttribute('aria-hidden', 'true');
    this.elMoney.className = 'hud-value is-money';
    moneyRow.append(moneyIcon, this.elMoney);
    moneyBlock.append(moneyLabel, moneyRow);

    const langButton = document.createElement('button');
    langButton.className = 'btn is-ghost is-small';
    langButton.textContent = t('ui.language');
    langButton.addEventListener('click', () => this.callbacks.onToggleLanguage());

    // Salida al MENU PRINCIPAL. Vive en la barra superior (junto a idioma) y no
    // en la barra de acciones de abajo: alli compite con Jugar/Descartar, que
    // son los botones de la partida. Es una accion de SISTEMA, no de juego.
    // Pide confirmacion: abandonar la run es irreversible (el guardado se borra).
    const menuButton = document.createElement('button');
    menuButton.className = 'btn is-ghost is-small is-quit';
    menuButton.dataset['act'] = 'quit-to-menu';
    menuButton.textContent = t('ui.menu');
    menuButton.title = t('menu.quitTitle');
    menuButton.addEventListener('click', () => this.confirmQuitToMenu());

    rightGroup.append(moneyBlock, langButton, menuButton);
    top.append(anteBlock, scoreBlock, rightGroup);

    // --- Jokers (izquierda) ---
    this.elJokers.className = 'hud-jokers';

    // --- Barra inferior ---
    const bottom = document.createElement('footer');
    bottom.className = 'hud-bottom';
    this.elCounters.className = 'hud-counters';
    this.elActions.className = 'hud-actions';
    bottom.append(this.elCounters, this.elActions);

    // --- Capas flotantes ---
    this.elOverlay.className = 'overlay';
    this.elTooltip.className = 'hud-tooltip';
    this.elPopups.className = 'hud-popups';
    this.elToasts.className = 'toast-stack';
    this.elBanner.className = 'banner-stack';

    // Contador en vivo. Va entre la barra de arriba y las cartas jugadas: es la
    // franja libre de la mesa, asi no tapa ni el HUD ni el resultado.
    this.elTicker.className = 'score-ticker';
    this.elTickerOp.className = 'score-ticker-op';
    this.elTickerTotal.className = 'score-ticker-total';
    this.elTickerSource.className = 'score-ticker-source';
    const tickerLine = document.createElement('div');
    tickerLine.className = 'score-ticker-line';
    tickerLine.append(this.elTickerOp, this.elTickerTotal);
    this.elTicker.append(tickerLine, this.elTickerSource);

    // P0.3 — Guia de seleccion: flota sobre la mano, en la franja libre entre
    // las cartas y los botones. No intercepta punteros (va en la capa de HUD).
    this.elSelectHint.className = 'hud-select-hint';
    this.elSelectHint.dataset['act'] = 'select-hint';

    // P2.6 — Misiones: van entre los jokers y los controles, sin capturar
    // punteros (viven en la capa de HUD, que es pointer-events:none).
    this.elMissions.className = 'hud-missions';
    this.elMissions.dataset['act'] = 'missions';

    this.root.append(
      top,
      this.elJokers,
      this.elMissions,
      bottom,
      this.elSelectHint,
      this.elTicker,
      this.elPopups,
      this.elBanner,
      this.elToasts,
      this.elTooltip,
      this.elOverlay,
    );
  }

  // ==========================================================================
  // Suscripciones
  // ==========================================================================

  private subscribe(): void {
    this.unsubscribes.push(
      bus.on('state:changed', () => this.render()),

      // P1.5 — El motor avisa que devolvio cartas al mazo al cerrar el ciego.
      // El HUD acumula el delta para poder decir que paso con el mazo; el
      // contador se limpia al empezar la ronda siguiente.
      bus.on('deck:conserved', ({ returned }) => {
        const delta = this.lastDeckDelta ?? { conserved: 0, gained: 0, destroyed: 0 };
        delta.conserved += returned;
        this.lastDeckDelta = delta;
      }),

      bus.on('score:changed', ({ total, target }) => {
        this.elScore.textContent = formatNumber(total);
        this.elScore.classList.toggle('is-hot', total >= target * 0.75);
        const fill = this.elProgress.firstElementChild as HTMLElement | null;
        if (fill) fill.style.width = `${Math.min(100, (total / Math.max(1, target)) * 100)}%`;
      }),

      // El motor emite TODOS los pasos del calculo juntos y despues el total.
      // El HUD los cuenta para poder REPARTIR el conteo entre ellos: asi el
      // contador termina exacto en el puntaje de la mano en vez de quedar cerca.
      bus.on('score:step', () => {
        this.scoreStepCount += 1;
        // Empezo una secuencia: a partir de aca el estado del motor puede haber
        // cambiado ya, pero la animacion todavia se esta viendo.
        this.scoreSettling = true;
        this.scoreSettleDeadline = performance.now() + 15000;
      }),

      // El RENDER avisa cuando la secuencia termino. Recien ahi puede aparecer
      // el panel siguiente (recompensa, tienda o seleccion de ciego).
      bus.on('score:settled', () => {
        // La secuencia termino: se libera el bloqueo YA, pero el panel espera un
        // respiro para que el total final se lea. El respiro vive ACA y no en la
        // timeline: una cola agregada por paso se apilaba, y si la timeline se
        // mataba el aviso nunca llegaba y el HUD quedaba sin mostrar paneles.
        this.scoreSettling = false;
        if (!this.panelPending) return;
        window.setTimeout(() => {
          if (!this.panelPending) return;
          this.panelPending = false;
          this.render();
        }, 1200);
      }),

      bus.on('score:hand', ({ breakdown, total }) => {
        this.scoreHandTotal = total;
        // P0.4 — Se guarda el desglose de la ULTIMA mano para poder mostrarlo
        // entero al cerrar el ciego. El plan pide un desglose explicito
        // (Mano / Combinacion / Base / Bonificaciones / Multiplicador / Total):
        // el ticker lo cuenta en vivo, pero al terminar ya no esta y el jugador
        // no tiene donde volver a mirarlo.
        this.lastBreakdown = { breakdown, total, handSize: this.engine.round?.selected.length ?? 0 };
        this.elTickerTotal.textContent = '0';
      }),

      // El RENDER avisa que el dado se apoyo. Recien ahi se revela el resultado
      // y se desbloquean los ciegos: mostrar la cara al soltar el cubo
      // arruinaria la tirada entera.
      // (La tirada por gesto se retiro; este aviso se conserva por si el
      // Simbionte legendario del dado quiere animar su tirada igual.)

      // Una mano nueva reinicia la cuenta. Va aca y no en `score:hand` porque
      // los pasos llegan ANTES que el total: si se reseteara ahi, el conteo se
      // quedaria sin denominador justo cuando lo necesita.
      bus.on('card:played', ({ index }) => {
        if (index === 0) {
          this.scoreStepCount = 0;
          this.scoreHandTotal = 0;
        }
      }),

      bus.on('money:changed', ({ money, delta }) => {
        this.elMoney.textContent = formatNumber(money);
        // La tienda muestra el dinero y decide que se puede comprar: si esta
        // abierta, se refresca con el valor nuevo.
        this.shopRefresh?.();
        if (delta !== 0) {
          this.popup(
            window.innerWidth - 90,
            window.innerHeight * 0.09,
            `${delta > 0 ? '+' : ''}${delta}`,
            0xffc857,
          );
        }
      }),

      bus.on('shop:enter', ({ offers }) => this.showShop(offers)),
      // P2.4 — Interludio: el motor avisa que hay un evento y el HUD abre el
      // panel con las opciones. El motor NO aplica nada hasta que el jugador
      // elige; aca solo se dibuja la decision.
      bus.on('interlude:enter', () => this.showInterlude()),
      bus.on('interlude:choose', ({ choice }) => {
        // La opcion sin efectos es "seguir de largo": el aviso lo dice para que
        // el jugador sepa que la decision quedo registrada.
        const tookDeal = (choice.effects?.length ?? 0) > 0;
        this.toast(t(tookDeal ? 'interlude.accepted' : 'interlude.declined'), 'info');
      }),      bus.on('shop:reroll', ({ offers }) => this.showShop(offers)),
      // Comprar cambia el estado de la OFERTA (vendida) y el dinero. El refresco
      // no puede depender solo de `money:changed`: ese evento lo dispara el
      // cobro, y la oferta tiene que quedar marcada en el mismo refresco.
      bus.on('shop:purchase', () => this.shopRefresh?.()),

      bus.on('round:win', ({ reward }) => {
        this.toast(`${t('result.blindCleared')} +${reward}`, 'info');
      }),

      bus.on('round:loss', () => {
        this.toast(t('result.blindFailed'), 'error');
      }),

      // La ficha del joker late cuando su joker dispara. NO se re-renderiza la
      // lista: eso reconstruiria el DOM y mataria la animacion recien arrancada.
      // Se busca la ficha por `data-uid` y se le pone el estado un instante.
      bus.on('joker:triggered', ({ joker }) => {
        const chip = this.elJokers.querySelector<HTMLElement>(
          `.joker-chip[data-uid="${joker.uid}"]`,
        );
        if (!chip) return;
        chip.classList.remove('is-firing');
        // Forzar un reflow hace que la animacion se reinicie aunque la ficha ya
        // estuviera latiendo (un joker que dispara dos veces seguidas).
        void chip.offsetWidth;
        chip.classList.add('is-firing');
        window.setTimeout(() => chip.classList.remove('is-firing'), 420);
        const fires = chip.querySelector('.joker-chip-fires');
        if (fires) fires.textContent = `x${joker.firedCount}`;
      }),

      bus.on('log', ({ level, key, params }) => {
        this.toast(t(key, params), level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info');
      }),

      // P1.5 — Deltas del mazo durante la ronda. Se cuentan para poder decirle
      // al jugador, al cerrar el ciego, que entro y que se perdio. Sin esto la
      // unica forma de saberlo seria comparar dos manos a ojo.
      bus.on('card:destroyed', () => {
        const delta = this.lastDeckDelta ?? { conserved: 0, gained: 0, destroyed: 0 };
        delta.destroyed += 1;
        this.lastDeckDelta = delta;
      }),

      bus.on('card:created', () => {
        const delta = this.lastDeckDelta ?? { conserved: 0, gained: 0, destroyed: 0 };
        delta.gained += 1;
        this.lastDeckDelta = delta;
      }),

      // Al arrancar una ronda nueva se reinician los acumuladores: el estado
      // que se muestra al cerrar un ciego es el de ESE ciego, no el de toda la
      // partida.
      bus.on('round:start', () => {
        this.lastDeckDelta = null;
        this.lastBreakdown = null;
      }),

      bus.on('i18n:changed', () => {
        this.build();
        this.render();
      }),

      // El banner lo pide quien detecta la situacion (main.ts), no el HUD: el
      // HUD solo sabe dibujarlo. Asi la regla de "cuando avisar" queda en un
      // solo lugar y el aviso del sistema y el in-app salen del mismo evento.
      bus.on('banner:show', ({ key, params, kind }) => this.showBanner(key, params, kind)),
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  private render(): void {
    const run = this.engine.run;
    if (!run) return;
    const round = this.engine.round;

    // En el menu no tiene sentido mostrar anted, dinero ni contadores: se
    // apaga el cromo del HUD y queda solo el overlay de la pantalla de inicio.
    this.root.classList.toggle('in-menu', run.status === 'menu');

    this.elAnte.textContent = String(run.ante);
    this.renderAnteRail(run.ante);
    this.elMoney.textContent = formatNumber(run.money);

    if (round) {
      this.elScore.textContent = formatNumber(round.score);
      this.elScore.classList.toggle('is-hot', round.score >= round.target * 0.75);
      this.elTarget.textContent = `/ ${formatNumber(round.target)}`;
      const fill = this.elProgress.firstElementChild as HTMLElement | null;
      if (fill) fill.style.width = `${Math.min(100, (round.score / Math.max(1, round.target)) * 100)}%`;
      this.elBlind.textContent = t(round.blind.nameKey);
      this.renderObjective(round);
    } else {
      this.elScore.textContent = '0';
      this.elTarget.textContent = '/ 0';
      this.elBlind.textContent = '';
      this.elObjective.classList.remove('is-visible');
    }

    this.renderCounters();
    this.renderJokers();
    this.renderMissions();
    this.renderActions();
    this.renderPreview();
    this.renderSelectHint();
    this.renderOverlay(run.status);
  }

  /**
   * P2.6 — Franja de MISIONES activas. Solo se dibuja dentro de una run (en el
   * menu no hay misiones) y se apaga sola si no hay ninguna.
   */
  private renderMissions(): void {
    this.elMissions.innerHTML = '';
    const hasRun =
      this.engine.run.status !== 'menu' && this.engine.run.status !== 'game_over';
    const missions = hasRun ? this.engine.activeMissions() : [];

    if (missions.length === 0) {
      this.elMissions.classList.remove('is-visible');
      return;
    }

    const title = document.createElement('div');
    title.className = 'hud-missions-title';
    title.textContent = t('mission.title');
    this.elMissions.appendChild(title);

    for (const { def, state } of missions) {
      const chip = document.createElement('div');
      chip.className = `mission-chip${state.completed ? ' is-done' : ''}`;
      chip.dataset['act'] = 'mission';
      chip.dataset['mission'] = def.id;
      if (state.completed) chip.dataset['missionDone'] = '1';

      const name = document.createElement('div');
      name.className = 'mission-chip-name';
      name.textContent = t(def.nameKey);

      const desc = document.createElement('div');
      desc.className = 'mission-chip-desc';
      // Progreso visible para las incrementales: "3/6". Sin esto una mision de
      // contar no da ninguna señal de que avanza.
      if (def.incremental) {
        const max = def.incremental.max;
        desc.textContent = `${t(def.descKey)} · ${state.progress}/${max}`;
      } else {
        desc.textContent = t(def.descKey);
      }

      const reward = document.createElement('div');
      reward.className = 'mission-chip-reward';
      reward.textContent = state.completed ? t('mission.completed') : t('mission.reward', { value: def.reward });

      chip.append(name, desc, reward);
      this.elMissions.appendChild(chip);
    }
    this.elMissions.classList.add('is-visible');
  }

  /**
   * P0.1 — Objetivo / Manos / Descartes durante la partida.
   *
   * El plan pide que, mientras se juega, la informacion principal se lea asi:
   *   "180 / 300 puntos  ·  Te quedan: 3 manos · 2 descartes"
   * Los manos/descartes ya estaban en los contadores de abajo, pero en el
   * borde inferior del HUD: lejos del objetivo, que es el numero que el jugador
   * persigue. Aca se juntan en una sola linea, al lado de la barra.
   */
  private renderObjective(round: RoundState): void {
    this.elObjective.innerHTML = '';

    const goal = document.createElement('span');
    goal.className = 'hud-objective-goal';
    goal.textContent = `${formatNumber(round.score)} / ${formatNumber(round.target)} ${t('hud.score')}`;

    const sep = document.createElement('span');
    sep.className = 'hud-objective-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '·';

    const left = document.createElement('span');
    left.className = 'hud-objective-left';
    left.textContent = t('hud.remaining', {
      hands: round.handsLeft,
      discards: round.discardsLeft,
    });
    const handsSpan = document.createElement('span');
    handsSpan.className = `hud-objective-num${round.handsLeft <= 1 ? ' is-low' : ''}`;
    handsSpan.textContent = String(round.handsLeft);
    const discardSpan = document.createElement('span');
    discardSpan.className = `hud-objective-num${round.discardsLeft === 0 ? ' is-low' : ''}`;
    discardSpan.textContent = String(round.discardsLeft);

    // Se compone la linea a mano para poder pintar los numeros criticos en
    // rojo: un `textContent` con interpolacion perderia esa jerarquia.
    left.textContent = '';
    left.append(
      document.createTextNode(`${t('hud.remainingPrefix')} `),
      handsSpan,
      document.createTextNode(` ${t('hud.hands')} `),
      sep.cloneNode(true) as HTMLElement,
      document.createTextNode(' '),
      discardSpan,
      document.createTextNode(` ${t('hud.discards')}`),
    );

    this.elObjective.append(goal, left);
    this.elObjective.classList.add('is-visible');

    // P0.2 — El aviso de "la barra avanza solo al jugar" se apaga solo tras
    // la primera mano jugada: cumplio su funcion y repetirlo seria ruido.
    this.elBarNotice.classList.toggle('is-visible', round.cardsPlayedThisRound === 0);
  }

  /**
   * Previsualizacion del score de la seleccion actual.
   *
   * Es la funcion mas valiosa del HUD: el jugador ve CUANTO va a puntuar ANTES
   * de comprometer la mano. Sin esto, un deckbuilder se vuelve adivinanza.
   * El motor lo resuelve en seco (dryRun), sin efectos secundarios.
   */
  private renderPreview(): void {
    const preview = this.engine.previewSelection();
    if (!preview) {
      this.elPreview.classList.remove('is-visible');
      return;
    }
    this.elPreview.innerHTML = '';

    const arrow = document.createElement('span');
    arrow.textContent = '→ ';
    const total = document.createElement('strong');
    total.textContent = formatNumber(preview.total);

    const detail = document.createElement('span');
    detail.className = 'hud-preview-detail';
    detail.textContent = `${formatNumber(preview.baseSubstrate + preview.addedSubstrate)} × ${(
      (preview.baseSpores + preview.addedSpores) *
      preview.multipliedSpores
    ).toFixed(1)}`;

    this.elPreview.append(arrow, total, detail);
    this.elPreview.classList.add('is-visible');
  }

  /**
   * P0.3 — Guia de seleccion sobre la mano.
   *
   * El plan pide que la PRIMERA interaccion explique que hace seleccionar: que
   * NO llena la barra y que NO es puntuar todavia. Se muestran dos datos:
   *   - el contador ("2 seleccionadas"), que da feedback inmediato;
   *   - si las cartas elegidas comparten Familia, que es la pista de sinergia
   *     que el plan pide (P1/P2.2) y que el jugador no puede ver de otro modo.
   *
   * QUE DESAPARECE Y QUE NO
   * -----------------------
   * El TEXTO de tutorial ("Toca hasta 5 cartas...") sale solo ANTES de jugar la
   * primera mano: una vez que el jugador jugo una, ya sabe que hace seleccionar.
   * El CONTADOR ("3 seleccionadas"), en cambio, se muestra SIEMPRE que haya al
   * menos una carta elegida, en toda la run: es el feedback de cuantas cartas
   * vas a jugar y desaparecerlo hacia que el jugador perdiera la cuenta (el bug
   * reportado: "a veces no aparece"). Solo se apaga cuando no hay seleccion y ya
   * paso la primera mano, o cuando no estas jugando.
   */
  private renderSelectHint(): void {
    const round = this.engine.round;
    const run = this.engine.run;
    const selected = round?.selected.length ?? 0;

    // Fuera de la fase de juego no hay nada que mostrar.
    if (!run || !round || run.status !== 'playing') {
      this.elSelectHint.classList.remove('is-visible');
      return;
    }

    const firstHand = round.cardsPlayedThisRound === 0;

    // Sin seleccion: solo el texto de tutorial, y solo la primera mano.
    if (selected === 0) {
      if (!firstHand) {
        this.elSelectHint.classList.remove('is-visible');
        return;
      }
      this.elSelectHint.innerHTML = '';
      const hint = document.createElement('span');
      hint.className = 'hud-select-hint-text';
      hint.textContent = t('guide.tutorialSelect', { count: MAX_PLAY_SIZE });
      this.elSelectHint.appendChild(hint);
      this.elSelectHint.classList.add('is-visible');
      return;
    }

    // Con seleccion: el contador SIEMPRE (toda la run), con la pista de familia.
    this.elSelectHint.innerHTML = '';

    const count = document.createElement('span');
    count.className = 'hud-select-hint-count';
    count.textContent =
      selected === 1 ? t('guide.selectedOne') : t('guide.selectedMany', { count: selected });

    // Sinergia de Familia entre las cartas elegidas. Se compara contra la
    // Familia de la primera seleccionada: es la lectura mas simple ("estas
    // cartas son de la misma familia") y la que el plan describe.
    const chosen = round.hand.filter((c) => round.selected.includes(c.uid));
    const families = new Set(chosen.map((c) => c.def.family));
    const sameFamily = families.size === 1 && chosen.length > 1;

    const family = document.createElement('span');
    family.className = `hud-select-hint-family${sameFamily ? ' is-shared' : ''}`;
    if (sameFamily) {
      family.textContent = `${t('family.' + chosen[0]!.def.family)} · ${t('guide.sharedFamily')}`;
    }

    this.elSelectHint.append(count, family);
    this.elSelectHint.classList.add('is-visible');
  }

  /**
   * Riel de antenas: un punto por ante del contenido, encendido hasta el actual.
   * Da la profundidad de la partida de un vistazo; el numero solo no dice si
   * falta poco o mucho. Se reconstruye solo cuando cambia el total, asi que no
   * cuesta nada por frame.
   */
  private renderAnteRail(ante: number): void {
    const total = this.engine.registry.maxAnte();
    if (total !== this.anteRailTotal) {
      this.anteRailTotal = total;
      this.elAnteRail.innerHTML = '';
      for (let i = 1; i <= total; i += 1) {
        const pip = document.createElement('span');
        pip.className = 'hud-ante-pip';
        this.elAnteRail.appendChild(pip);
      }
    }
    this.elAnteRail.title = t('hud.anteOf', { current: ante, total });
    this.elAnteRail.setAttribute('aria-label', t('hud.anteOf', { current: ante, total }));
    const pips = this.elAnteRail.children;
    for (let i = 0; i < pips.length; i += 1) {
      pips[i]?.classList.toggle('is-done', i < ante);
      pips[i]?.classList.toggle('is-now', i === ante - 1);
    }
  }

  private renderCounters(): void {
    const round = this.engine.round;
    const run = this.engine.run;
    this.elCounters.innerHTML = '';
    if (!round) return;

    // Dos grupos con jerarquia distinta, a proposito:
    //   RECURSOS (manos, descartes) son lo que GASTAS en esta ronda. Si se
    //     acaban, perdiste: van con icono y se encienden en rojo al agotarse.
    //   ESTADO (mazo, jokers) es informativo: se puede planear pero no se gasta.
    // Sin la separacion, los cuatro numeros pesan igual y el jugador no sabe
    // donde mirar cuando la ronda se pone cuesta arriba.
    const resources: Array<[string, string, string | number, string]> = [
      ['ui_icon_hand', t('hud.hands'), round.handsLeft, round.handsLeft <= 1 ? 'is-low' : ''],
      [
        'ui_icon_discard',
        t('hud.discards'),
        round.discardsLeft,
        round.discardsLeft === 0 ? 'is-low' : '',
      ],
    ];
    // El chip dice "MAZO" y muestra DOS numeros: "por robar / total".
    //
    // Antes mostraba UNO solo — el total (`deckSize`) —, asi que el numero
    // quedaba clavado durante toda la mano y parecia que las cartas jugadas o
    // descartadas no se descontaban (el bug reportado: "42" con 8 en la mano).
    // Con el par, el primero BAJA al robar (es lo que el jugador sigue) y el
    // segundo le dice cuanto mide su mazo de verdad. Mismo patron que el chip
    // de jokers, que ya usa "/max" como contexto.
    const state: Array<[string, string, string | number, string]> = [
      ['ui_icon_collection', t('hud.deck'), this.engine.deckDraw, ''],
      ['ui_icon_joker_slot', t('hud.jokers'), run.jokers.length, ''],
    ];
    /** Tope del chip de mazo (el total). Se reusa `counter-cap`, el mismo del de jokers. */
    const deckTotal = this.engine.deckSize;

    for (const [icon, label, value, extra] of [...resources, ...state]) {
      const cell = document.createElement('div');
      cell.className = `counter${resources.some((r) => r[0] === icon) ? ' is-resource' : ''}`;
      cell.title = label;
      // El chip de mazo muestra DOS numeros ("12/42"): se los explica en el
      // aria-label para que el lector de pantalla no lea una fraccion suelta.
      if (icon === 'ui_icon_collection') {
        cell.setAttribute('aria-label', t('hud.deckFull', { remaining: this.engine.deckDraw, total: deckTotal }));
      }

      const iconEl = document.createElement('span');
      iconEl.className = 'counter-icon';
      // La URL se resuelve contra `document.baseURI`, NO se escribe relativa en
      // el CSS: un `url('art/..')` dentro de un `style` inline se resuelve
      // contra el origen de la hoja (src/ui/) y da 404. Contra `baseURI` anda
      // igual en el dev server y bajo el `asset://` de Tauri (`base: './'`).
      iconEl.style.setProperty('--icon', `url("${new URL(`art/${icon}.svg`, document.baseURI).href}")`);
      iconEl.setAttribute('aria-hidden', 'true');

      const valueEl = document.createElement('div');
      valueEl.className = `counter-value ${extra}`.trim();
      valueEl.textContent = String(value);

      // El contador de jokers muestra "3" y el tope aparte: "3/5" junto competia
      // por la misma linea de base que un numero suelto y se leia peor. El de
      // mazo sigue el mismo patron: "12/42" = por robar / total.
      const cap = document.createElement('span');
      cap.className = 'counter-cap';
      if (icon === 'ui_icon_joker_slot') {
        cap.textContent = `/${run.jokerSlots}`;
        valueEl.appendChild(cap);
      } else if (icon === 'ui_icon_collection') {
        cap.textContent = `/${deckTotal}`;
        valueEl.appendChild(cap);
      }

      const labelEl = document.createElement('div');
      labelEl.className = 'hud-label';
      labelEl.textContent = label;

      cell.append(iconEl, valueEl, labelEl);
      this.elCounters.appendChild(cell);
    }
  }

  /**
   * Fichas de los jokers.
   *
   * La ficha TOCA el joker de la mesa (lo hace latir) y NO lo vende. Antes el
   * cuerpo entero de la ficha vendia: un toque al pasar borraba un joker sin
   * aviso y sin vuelta atras. Vender ahora es un boton propio, con su valor a la
   * vista y una confirmacion de un toque mas.
   */
  private renderJokers(): void {
    const run = this.engine.run;
    this.elJokers.innerHTML = '';
    if (!run) return;

    for (const joker of run.jokers) {
      const chip = document.createElement('div');
      const rarity = joker.def.rarity;
      chip.className = `joker-chip is-rarity-${rarity}`;
      // El color de rareza viaja como variable CSS: la barra izquierda Y el
      // brillo de la ficha se tiñen con el MISMO valor, y el CSS decide como
      // usarlo. Asi una legendaria se distingue de una comun de un vistazo.
      chip.style.setProperty('--joker-rarity', hexToCss(RARITY_COLOR[rarity]));
      chip.title = `${t(joker.def.nameKey)} — ${t(joker.def.descKey)}`;
      // Hook para que la ficha se pueda encontrar por uid cuando el joker
      // dispara (ver la suscripcion a `joker:triggered`).
      chip.dataset['uid'] = joker.uid;

      const name = document.createElement('span');
      name.className = 'joker-chip-name';
      name.textContent = t(joker.def.nameKey);

      // Linea de HABILIDAD: la primera etiqueta de efecto del Simbionte, en el
      // color de su rareza. Es la respuesta directa a "hacer mas visibles los
      // Simbiontes": el nombre solo es una etiqueta, la habilidad es lo que
      // importa. Sin etiquetas (el Simbionte activo del dado no tiene efectos
      // disparables en la mano) se muestra la rareza, que nunca queda vacia.
      const ability = document.createElement('span');
      ability.className = 'joker-chip-ability';
      const labelKey = joker.def.effects.find((e) => e.labelKey)?.labelKey;
      ability.textContent = labelKey
        ? t(labelKey)
        : t(`rarity.${rarity}`);

      const fires = document.createElement('span');
      fires.className = 'joker-chip-fires';
      fires.textContent = `x${joker.firedCount}`;

      const value = jokerSellValue(joker);
      const sell = document.createElement('button');
      sell.className = 'joker-chip-sell';
      sell.type = 'button';
      sell.dataset['act'] = 'sell-joker';
      // Una "x" y no la palabra: la ficha es angosta y el nombre del joker tiene
      // que entrar. Es seguro porque vender pide SIEMPRE un segundo toque, y en
      // ese momento el boton se rotula con el precio.
      sell.textContent = '✕';
      sell.title = t('action.sellValue', { value });
      sell.setAttribute('aria-label', t('action.sellValue', { value }));

      /** Confirmacion en dos toques, con vencimiento: un toque no vende nada. */
      let timer: number | null = null;
      const reset = (): void => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        chip.classList.remove('is-confirming');
        sell.textContent = '✕';
      };
      sell.addEventListener('click', (event) => {
        event.stopPropagation();
        if (chip.classList.contains('is-confirming')) {
          reset();
          this.callbacks.onSellJoker(joker.uid);
          return;
        }
        chip.classList.add('is-confirming');
        sell.textContent = t('action.sellValue', { value });
        timer = window.setTimeout(reset, 3200);
      });

      // El cuerpo de la ficha solo señala la carta: el joker late en la mesa.
      chip.addEventListener('click', () => this.callbacks.onFocusJoker(joker.uid));

      const body = document.createElement('span');
      body.className = 'joker-chip-body';
      body.append(name, ability);

      chip.append(body, fires, sell);
      this.elJokers.appendChild(chip);
    }
  }

  private renderActions(): void {
    const run = this.engine.run;
    const round = this.engine.round;
    this.elActions.innerHTML = '';
    if (!run) return;

    if (run.status !== 'playing' || !round) return;

    const selected = round.selected.length;

    const clear = document.createElement('button');
    clear.className = 'btn is-ghost';
    clear.textContent = t('action.clear');
    clear.disabled = selected === 0;
    clear.addEventListener('click', () => this.callbacks.onClear());

    // P1.3 / P1.4 — Ordenar. NO reorganiza sola: abre un menu y el jugador
    // elige. El plan es explicito en que el orden automatico debe ser
    // opcional, y que el boton no puede tapar la mano.
    const sort = document.createElement('button');
    sort.className = 'btn is-ghost is-sort';
    sort.dataset['act'] = 'sort';
    sort.textContent = t('action.sort');
    sort.setAttribute('aria-haspopup', 'menu');
    sort.setAttribute('aria-expanded', 'false');
    sort.disabled = round.hand.length < 2;
    const sortMenu = this.buildSortMenu();
    sort.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleSortMenu(sort, sortMenu);
    });

    const discard = document.createElement('button');
    discard.className = 'btn is-discard';
    discard.textContent = t('action.discard');
    // P0.3 — El boton explica el recurso en su propio texto: "Descartar · 3".
    // El plan pide que quede claro que descartar CONSUME: un numero pegado al
    // verbo lo dice sin necesitar una leyenda aparte.
    discard.dataset['act'] = 'discard';
    discard.disabled = selected === 0 || round.discardsLeft <= 0;
    discard.addEventListener('click', () => this.callbacks.onDiscard());

    const play = document.createElement('button');
    play.className = 'btn is-play';
    play.dataset['act'] = 'play';
    play.textContent = selected > 0 ? `${t('action.play')} (${selected})` : t('action.play');
    play.disabled = selected === 0 || round.handsLeft <= 0;
    play.addEventListener('click', () => this.callbacks.onPlay());

    // Simbionte legendario `joker_loaded_die`: habilidad ACTIVA. El boton solo
    // existe si el jugador tiene el Simbionte en la mesa; mientras la carga no
    // esta lista queda deshabilitado y muestra cuantas manos faltan. Es un boton
    // aparte y no parte del boton de jugar a proposito: tirar el dado NO juega
    // una mano, la prepara.
    const dieBtn = document.createElement('button');
    dieBtn.className = 'btn is-loaded-die';
    dieBtn.dataset['act'] = 'use-die';
    if (this.engine.hasLoadedDie()) {
      const ready = this.engine.canUseLoadedDie();
      const charge = this.engine.loadedDieCharge();
      dieBtn.textContent = ready
        ? t('action.useDieReady')
        : t('action.useDieCharge', { count: charge });
      dieBtn.disabled = !ready;
      dieBtn.title = t('joker.joker_loaded_die.desc');
      dieBtn.addEventListener('click', () => this.callbacks.onUseLoadedDie());
      this.elActions.append(clear, sort, dieBtn, discard, play);
      return;
    }

    this.elActions.append(clear, sort, discard, play);
  }

  /**
   * Menu emergente de criterios de orden (P1.3/P1.4/P2.1).
   *
   * Vive dentro de `elActions` y se posiciona con CSS por encima de la barra:
   * en movil la fila de botones esta al borde inferior, asi que un menu
   * desplegado hacia arriba es lo unico que no tapa la mano.
   */
  private buildSortMenu(): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'sort-menu';
    menu.dataset['act'] = 'sort-menu';
    menu.setAttribute('role', 'menu');

    const title = document.createElement('div');
    title.className = 'sort-menu-title';
    title.textContent = t('sort.by');
    menu.appendChild(title);

    for (const mode of SORT_MODES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sort-menu-item';
      item.dataset['sortMode'] = mode;
      item.setAttribute('role', 'menuitemradio');
      item.textContent = t(SORT_LABEL_KEY[mode]);
      const isActive = mode === this.sortMode;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-checked', isActive ? 'true' : 'false');
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks.onSortHand(mode);
        this.closeSortMenu();
      });
      menu.appendChild(item);
    }

    return menu;
  }

  private toggleSortMenu(anchor: HTMLElement, menu: HTMLElement): void {
    const open = this.elActions.querySelector('.sort-menu');
    if (open === menu) {
      this.closeSortMenu();
      return;
    }
    this.closeSortMenu();
    anchor.setAttribute('aria-expanded', 'true');
    // El menu se cuelga del contenedor de acciones: el ancla puede morir en
    // cada `renderActions()` (que limpia el innerHTML), y con ella el menu.
    this.elActions.appendChild(menu);
    menu.classList.add('is-open');
    // Cerrar al tocar fuera. `{ once: true }` y el chequeo de contencion evitan
    // que el propio click de apertura lo cierre al instante.
    const onDocClick = (event: MouseEvent): void => {
      if (!menu.contains(event.target as Node)) this.closeSortMenu();
    };
    window.setTimeout(() => document.addEventListener('click', onDocClick, { once: true }), 0);
  }

  private closeSortMenu(): void {
    const open = this.elActions.querySelector('.sort-menu');
    if (!open) return;
    open.remove();
    const anchor = this.elActions.querySelector('.is-sort');
    anchor?.setAttribute('aria-expanded', 'false');
  }

  /** Sincroniza el criterio activo y refresca el menu si esta abierto. */
  private setSortMode(mode: SortMode): void {
    this.sortMode = mode;
    const open = this.elActions.querySelector('.sort-menu');
    if (!open) return;
    for (const item of Array.from(open.querySelectorAll('.sort-menu-item'))) {
      const isActive = item.getAttribute('data-sort-mode') === mode;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  }

  // ==========================================================================
  // Overlays
  // ==========================================================================

  private renderOverlay(status: string): void {
    // Solo se reconstruye al CAMBIAR de estado: si no, el overlay se
    // redibujaria en cada evento y se perderia el foco de los botones.
    if (status === this.lastStatus) return;

    // LA ANIMACION MANDA. El motor ya cambio de estado (gano el ciego), pero si
    // el conteo todavia se esta viendo, el panel siguiente ESPERA. Sin esto, la
    // recompensa (o la seleccion de ciego) aparecia encima del puntaje: se
    // saltaba la animacion y no habia ninguna señal de que se habia superado.
    if (
      this.scoreSettling &&
      performance.now() < this.scoreSettleDeadline &&
      status !== 'playing' &&
      status !== 'menu'
    ) {
      this.panelPending = true;
      return;
    }
    // Vencio el bloqueo (o no habia secuencia): se limpia y se sigue.
    this.scoreSettling = false;

    this.lastStatus = status;
    // El aviso de superacion se muestra UNA vez por ronda.
    if (status !== 'reward') this.clearedShown = false;

    switch (status) {
      case 'menu':
        this.showMenu();
        break;
      case 'blind_select':
        this.showBlindSelect();
        break;
      case 'interlude':
        // P2.4 — El interludio ya abrio su panel por `interlude:enter`; si el
        // HUD llega a este estado sin panel (ej. recarga), se muestra igual.
        if (!this.elOverlay?.querySelector('.panel.is-interlude')) this.showInterlude();
        break;
      case 'reward':
        // Primero el aviso de superacion, despues el draft: sin esto el panel
        // aparecia de golpe y no habia NINGUNA señal de que se gano el ciego.
        if (!this.clearedShown) {
          this.clearedShown = true;
          this.showBlindCleared(() => this.showReward());
        }
        break;
      case 'shop':
        this.showShop(this.engine.run.shop?.offers ?? []);
        break;
      case 'game_over':
        this.showGameOver('loss');
        break;
      case 'victory':
        this.showGameOver('victory');
        break;
      default:
        this.hideOverlay();
    }
  }

  /**
   * Aviso de CIEGO SUPERADO: el momento que faltaba entre la ultima mano y el
   * draft. Muestra el puntaje contra el objetivo y, recien despues, deja pasar.
   */
  private showBlindCleared(then: () => void): void {
    const round = this.engine.round;
    const panel = document.createElement('div');
    panel.className = 'panel is-cleared';

    const title = document.createElement('div');
    title.className = 'cleared-title';
    // OJO con el nombre: `blind.*` es el namespace de los CIEGOS (vive en el
    // pack). Meter una clave ahi la pisa y el validador lo caza.
    title.textContent = t('blindCleared.title');

    const detail = document.createElement('div');
    detail.className = 'cleared-detail';
    detail.textContent = t('blindCleared.score', {
      score: formatNumber(round?.score ?? 0),
      target: formatNumber(round?.target ?? 0),
    });

    panel.append(title, detail);

    // TOTAL DE LA RUN: ademas del score de este ciego, se muestra el acumulado.
    // Es el numero que el resumen final usa, asi que verlo crecer ciego a ciego
    // da sentido de progreso (y explica de donde sale el total del game over).
    const total = document.createElement('div');
    total.className = 'cleared-total';
    total.dataset['act'] = 'cleared-total';
    total.textContent = t('blindCleared.total', {
      score: formatNumber(this.engine.run.totalScore),
    });
    panel.appendChild(total);

    // P0.4 — Desglose de la mano que cerro el ciego. Se arma con el ULTIMO
    // `score:hand`, que es el que efectivamente supero el objetivo.
    const breakdown = this.buildBreakdown();
    if (breakdown) panel.appendChild(breakdown);

    // P1.5 — Estado del mazo: "Mazo conservado: 40 cartas / +1 carta obtenida".
    // Es la respuesta VISIBLE a la pregunta que el plan detecta como central:
    // "que paso con mis cartas despues de superar el Ciego".
    const deckLine = this.buildDeckStateLine();
    if (deckLine) panel.appendChild(deckLine);

    // HUD DE CONTINUAR: el panel ya NO avanza solo por un `setTimeout`. Antes el
    // jugador no tenia tiempo de leer el desglose: la pantalla se cerraba y
    // entraba el draft sin que el hubiera decidido nada. Ahora hay un boton
    // explicito; el paso a recompensas lo dispara el jugador.
    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const cont = document.createElement('button');
    cont.className = 'btn is-play';
    cont.dataset['act'] = 'cleared-continue';
    cont.textContent = t('blindCleared.continue');
    cont.addEventListener('click', () => {
      // Guarda: el estado pudo cambiar (ej. un panel de sistema). Si ya no
      // estamos en `reward`, no hay nada que continuar.
      if (this.engine.run.status !== 'reward') return;
      if (this.clearedAdvanced) return; // un doble toque no avanza dos veces
      this.clearedAdvanced = true;
      then();
    });
    actions.appendChild(cont);
    panel.appendChild(actions);

    this.openOverlay(panel);
    this.clearedAdvanced = false;
  }

  /**
   * P0.4 — Desglose de puntuacion.
   *
   * El plan lo describe asi:
   *   Mano: 5 cartas · Combinacion: Bosque micelial · Base: 80
   *   Bonificaciones: +40 · Multiplicador: x1.5 · Total: 180 / 300
   * El ultimo renglon (Total) se pinta destacado porque es el numero que el
   * jugador compara contra el objetivo.
   */
  private buildBreakdown(): HTMLElement | null {
    const data = this.lastBreakdown;
    if (!data) return null;

    const wrap = document.createElement('div');
    wrap.className = 'score-breakdown';
    wrap.dataset['act'] = 'breakdown';

    const heading = document.createElement('div');
    heading.className = 'score-breakdown-title';
    heading.textContent = t('guide.breakdownTitle');
    wrap.appendChild(heading);

    const substrate = data.breakdown.baseSubstrate + data.breakdown.addedSubstrate;
    const spores = data.breakdown.baseSpores + data.breakdown.addedSpores;
    const bonus =
      data.breakdown.addedSubstrate + data.breakdown.addedSpores * data.breakdown.multipliedSpores;

    const rows: Array<[string, string, string]> = [
      [t('guide.breakdownCombo'), `${formatNumber(data.handSize)} ${t('hud.deck')}`, ''],
      [t('guide.breakdownBase'), `${formatNumber(data.breakdown.baseSubstrate)} × ${formatNumber(data.breakdown.baseSpores)}`, ''],
      [
        t('guide.breakdownBonus'),
        `${bonus >= 0 ? '+' : ''}${formatNumber(spores)} ${t('hud.spores')}`,
        bonus > 0 ? 'is-positive' : '',
      ],
      [
        t('guide.breakdownMult'),
        `×${(data.breakdown.multipliedSpores || 1).toFixed(1)}`,
        data.breakdown.multipliedSpores > 1 ? 'is-positive' : '',
      ],
    ];

    // Se omite la fila "Base" en crudo si coincide con el sustrato: el jugador
    // solo necesita ver lo que APORTA cada parte, no la aritmetica interna.
    void substrate;

    for (const [label, value, kind] of rows) {
      const row = document.createElement('div');
      row.className = `score-breakdown-row${kind ? ` ${kind}` : ''}`;
      const labelEl = document.createElement('span');
      labelEl.className = 'score-breakdown-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'score-breakdown-value';
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      wrap.appendChild(row);
    }

    const total = document.createElement('div');
    total.className = 'score-breakdown-row is-total';
    const totalLabel = document.createElement('span');
    totalLabel.className = 'score-breakdown-label';
    totalLabel.textContent = t('guide.breakdownTotal');
    const totalValue = document.createElement('span');
    totalValue.className = 'score-breakdown-value';
    totalValue.textContent = `${formatNumber(this.scoreHandTotal)} / ${formatNumber(this.engine.round?.target ?? 0)}`;
    total.append(totalLabel, totalValue);
    wrap.appendChild(total);

    return wrap;
  }

  /**
   * P1.5 — Estado del mazo al cerrar el ciego.
   *
   * Se calcula comparando el mazo AHORA contra lo que el motor aviso por
   * `deck:conserved` (cartas devueltas) y contando lo que entro o salio durante
   * la ronda. El objetivo es que el jugador NUNCA tenga que deducir que paso
   * mirando la mano siguiente.
   */
  private buildDeckStateLine(): HTMLElement | null {
    const run = this.engine.run;
    if (!run) return null;

    const line = document.createElement('div');
    line.className = 'deck-state-line';
    line.dataset['act'] = 'deck-state';

    const total = document.createElement('span');
    total.className = 'deck-state-total';
    total.textContent = t('deckstate.conserved', { count: formatNumber(run.deck.totalSize) });
    line.appendChild(total);

    const delta = this.lastDeckDelta;
    if (delta) {
      if (delta.gained > 0) {
        const gained = document.createElement('span');
        gained.className = 'deck-state-delta is-gained';
        gained.textContent =
          delta.gained === 1
            ? t('deckstate.gained', { count: 1 })
            : t('deckstate.gainedMany', { count: delta.gained });
        line.appendChild(gained);
      }
      if (delta.destroyed > 0) {
        const destroyed = document.createElement('span');
        destroyed.className = 'deck-state-delta is-lost';
        destroyed.textContent =
          delta.destroyed === 1
            ? t('deckstate.destroyed', { count: 1 })
            : t('deckstate.destroyedMany', { count: delta.destroyed });
        line.appendChild(destroyed);
      }
    }

    return line;
  }

  /**
   * F4: inclina el panel denso hacia el puntero (CSS 3D). Solo aplica a los
   * paneles de formulario/tablero; el resto se deja plano.
   */
  private attachDepth(panel: HTMLElement): void {
    const deep =
      panel.classList.contains('is-settings') ||
      panel.classList.contains('is-about') ||
      panel.classList.contains('is-board');
    if (!deep) return;
    if (document.documentElement.classList.contains('reduce-motion')) return;

    const reset = (): void => {
      panel.style.setProperty('--tilt-y', '0deg');
      panel.style.setProperty('--tilt-x', '0deg');
    };
    panel.addEventListener('pointermove', (event) => {
      const rect = panel.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      panel.style.setProperty('--tilt-y', `${(nx * 6).toFixed(2)}deg`);
      panel.style.setProperty('--tilt-x', `${(-ny * 6).toFixed(2)}deg`);
    });
    panel.addEventListener('pointerleave', reset);
  }

  private openOverlay(content: HTMLElement, carousel = false): void {
    this.cancelPendingClose();
    // El panel anterior deja de existir: su refresco tambien. `showShop` vuelve
    // a asignarlo justo despues de llamar aca.
    this.shopRefresh = null;
    // Las referencias al panel de ciego son del panel que se esta yendo.
    // `is-throw` ya no lo pone nadie (la tirada de dado se retiro), pero se
    // limpia igual: un overlay sin capturar punteros se comeria los clics.
    this.elOverlay.classList.remove('is-throw');
    this.elOverlay.innerHTML = '';
    // `is-carousel`: overlay TRANSPARENTE y sin capturar punteros, para que la
    // escena 3D (el anillo) quede a la vista y reciba rueda/arrastre/tap. El
    // marco de la coleccion re-habilita `pointer-events` solo en sus controles.
    this.elOverlay.classList.toggle('is-carousel', carousel);
    this.elOverlay.appendChild(content);
    this.attachDepth(content);
    this.callbacks.onPanelOpened?.(carousel);
    // Si ya estaba abierto, quitar y volver a poner `is-open` en el mismo
    // frame no reinicia la animacion: hay que forzar un reflow entre medias.
    this.elOverlay.classList.remove('is-open', 'is-closing');
    void this.elOverlay.offsetWidth;
    this.elOverlay.classList.add('is-open');
    this.syncPanelOpen();
    this.syncArenaCovered();
  }

  /**
   * Marca en `#ui-root` que hay un panel/overlay abierto.
   *
   * En CELULAR el cromo de la partida (score, ante, dinero, jokers, misiones y
   * barra inferior) tiene que desaparecer mientras hay una subpantalla abierta
   * (mazo, coleccion, tienda, ciego...). Sin esto el HUD de partida se dibujaba
   * ENCIMA del carrusel del mazo: el bloque de score tapaba el titulo "Mazo" y
   * las pestañas de orden, y la barra de misiones se cortaba contra la barra
   * inferior. En escritorio no se aplica: alli el HUD y el panel conviven bien.
   */
  private syncPanelOpen(): void {
    this.root.classList.toggle('is-panel-open', this.elOverlay.classList.contains('is-open'));
  }

  /**
   * Avisa al render si la arena esta tapada. Se recalcula en TODOS los puntos
   * que cambian el estado del overlay (abrir, cerrar, cambiar de fase el dado)
   * y solo llama al callback cuando el valor cambia: el render no tiene por que
   * reaccionar dos veces a lo mismo.
   */
  private syncArenaCovered(): void {
    const covered =
      this.elOverlay.classList.contains('is-open') &&
      !this.elOverlay.classList.contains('is-throw');
    if (covered === this.arenaCovered) return;
    this.arenaCovered = covered;
    this.callbacks.onArenaCovered?.(covered);
  }

  /**
   * Cierra CON animacion. El contenido no se borra hasta `animationend`,
   * porque si lo borramos antes el panel desaparece de golpe y la salida no
   * se ve. `pointer-events` durante la salida lo apaga el CSS.
   */
  hideOverlay(): void {
    if (this.elOverlay.classList.contains('is-closing')) return; // ya cerrando
    if (!this.elOverlay.classList.contains('is-open')) {
      this.elOverlay.classList.remove('is-carousel', 'is-throw');
      this.elOverlay.innerHTML = '';
      this.syncPanelOpen();
      this.syncArenaCovered();
      return;
    }

    this.cancelPendingClose();
    this.elOverlay.classList.remove('is-open', 'is-throw');
    this.elOverlay.classList.add('is-closing');
    this.syncPanelOpen();
    this.syncArenaCovered();

    const seq = ++this.closeSeq;
    const finish = (): void => {
      // Un `openOverlay()` posterior ya reprogramo esto: no pisar su contenido.
      if (seq !== this.closeSeq) return;
      this.closeTimer = null;
      this.elOverlay.classList.remove('is-closing', 'is-carousel');
      this.elOverlay.innerHTML = '';
    };

    // `animationend` burbujea: sin el filtro por `target`, la animacion del
    // panel hijo cerraria el overlay antes que la del fondo.
    const onEnd = (event: AnimationEvent): void => {
      if (event.target !== this.elOverlay) return;
      this.elOverlay.removeEventListener('animationend', onEnd);
      finish();
    };
    this.elOverlay.addEventListener('animationend', onEnd);

    // Respaldo: con `prefers-reduced-motion` las animaciones se apagan y
    // `animationend` nunca dispara. Sin esto el overlay quedaria colgado.
    this.closeTimer = setTimeout(finish, 400);
  }

  /** Cancela un cierre en vuelo para que no borre contenido ya reemplazado. */
  private cancelPendingClose(): void {
    this.closeSeq++;
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  /**
   * Informa si hay una partida guardada. Fuerza un redibujado del overlay
   * porque el estado del motor no cambio (seguimos en blind_select), pero la
   * pantalla si debe cambiar.
   */
  setContinueAvailable(label: string | null): void {
    this.continueLabel = label;
    this.lastStatus = null;
    this.render();
  }

  /**
   * Aplica el resultado de ordenar la mano (P1.3/P1.4).
   *
   * El controlador ya reordeno el motor con `reorderHand()`; aca solo se
   * refleja el criterio activo y se confirma con un toast corto, que es lo que
   * el plan pide ("mostrar una pequeña confirmacion: Ordenado por Familia").
   */
  applySortMode(mode: SortMode): void {
    this.setSortMode(mode);
    const message =
      mode === 'default'
        ? t('sort.confirmDefault')
        : t('sort.confirm', { criterion: t(SORT_LABEL_KEY[mode]) });
    // Se confirma SIEMPRE, aunque la mano ya estuviera en ese orden: el jugador
    // pulso el criterio y espera una respuesta, no silencio.
    this.toast(message, 'info');
  }

  /**
   * Salida al MENU PRINCIPAL desde la partida, con un panel de confirmacion.
   *
   * Se usa un panel y no el "dos toques" del boton de vender joker: abandonar la
   * run borra el guardado y no tiene vuelta atras, asi que merece una decision
   * explicita con las DOS opciones a la vista, no un boton que cambia de texto.
   */
  private confirmQuitToMenu(): void {
    const panel = document.createElement('div');
    panel.className = 'panel is-confirm';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t('menu.quitTitle');

    const body = document.createElement('p');
    body.className = 'panel-subtitle';
    body.textContent = t('menu.quitBody');

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const cancel = document.createElement('button');
    cancel.className = 'btn is-ghost';
    cancel.dataset['act'] = 'quit-cancel';
    cancel.textContent = t('ui.cancel');
    cancel.addEventListener('click', () => this.closePanel());

    const confirm = document.createElement('button');
    confirm.className = 'btn is-play';
    confirm.dataset['act'] = 'quit-confirm';
    confirm.textContent = t('menu.quitConfirm');
    confirm.addEventListener('click', () => {
      this.closePanel();
      this.callbacks.onQuitToMenu();
    });

    actions.append(cancel, confirm);
    panel.append(title, body, actions);
    // Sin `carousel`: es un panel DOM normal y tiene que tapar la escena.
    this.openOverlay(panel);
  }

  // ==========================================================================
  // Pantalla de inicio
  // ==========================================================================

  /** Muestra un panel propio (ajustes, acerca de, coleccion...). */
  showPanel(content: HTMLElement, opts?: { carousel?: boolean }): void {
    this.openOverlay(content, opts?.carousel ?? false);
  }

  /**
   * Cierra el panel actual y vuelve a la pantalla que corresponda al estado.
   *
   * `hideOverlay()` solo esconde: como `openOverlay` VACIA el overlay al abrir
   * el panel nuevo, si solo se esconde queda la pantalla en blanco. Los paneles
   * montados sobre el carrusel cierran por aca.
   */
  closePanel(): void {
    this.lastStatus = null;
    this.render();
  }

  /**
   * Fuerza el redibujado del panel del estado ACTUAL. Hace falta cuando algo
   * cambia sin que cambie el estado: volver a tirar el dado, por ejemplo.
   */
  refreshPanel(): void {
    this.lastStatus = null;
    this.render();
  }

  showMenu(): void {
    const panel = buildMenuPanel(
      {
        version: this.appInfo.version,
        continueLabel: this.continueLabel,
        // El duelo solo se ofrece si el contenido trae datos de tablero: un
        // boton que abre un panel vacio es peor que no tener el boton.
        showBoard: this.boardAvailable,
        onOpenBoard: () => this.callbacks.onOpenBoard(),
        ascension: this.ascensionState,
        onOpenAscension: () => this.showAscension(),
        archetypes: this.archetypeState.list,
        selectedArchetype: this.archetypeState.selected,
      },
      {
        onStartRun: () => this.callbacks.onStartRun(),
        onContinueRun: () => this.callbacks.onContinueRun(),
        onOpenCollection: () => this.callbacks.onOpenCollection(),
        onOpenExpansions: () => this.callbacks.onOpenExpansions(),
        onOpenPass: () => this.callbacks.onOpenPass(),
        onOpenSettings: () => this.callbacks.onOpenSettings(),
        onOpenAbout: () => this.callbacks.onOpenAbout(),
        onToggleLanguage: () => this.callbacks.onToggleLanguage(),
        onOpenDaily: () => this.callbacks.onOpenDaily(),
        onOpenAchievements: () => this.callbacks.onOpenAchievements(),
        onOpenCosmetics: () => this.callbacks.onOpenCosmetics(),
        onOpenHistory: () => this.showHistory(),
        onOpenGuide: () => this.callbacks.onOpenGuide(),
        onSelectArchetype: () => {
          // Solo se usa desde el panel (que llama a `onStart` con el id); el
          // chip del menu abre el panel. Se deja por completitud del contrato.
        },
        onOpenArchetypes: () => this.showArchetypes(),
      },
    );
    this.openOverlay(panel);
  }

  /**
   * Estado de ascension para el menu. Lo llama el controlador cada vez que el
   * perfil cambia (y antes de `showMenu`), porque el HUD no conoce el perfil.
   */
  setAscensionState(state: {
    unlocked: number;
    selected: number;
    max: number;
    modifiers?: Array<Record<string, number | boolean | undefined> | undefined>;
  }): void {
    this.ascensionState = { ...state, modifiers: state.modifiers ?? [] };
  }

  /**
   * Estado de arquetipos para el menu. Lo empuja el controlador (contenido +
   * perfil) antes de `showMenu`, igual que ascension.
   */
  setArchetypeState(state: {
    list: Array<{
      id: string;
      nameKey: string;
      taglineKey: string;
      howKey: string;
      weaknessKey: string;
      element: string;
    }>;
    selected: string;
    starterSizes: Record<string, number>;
  }): void {
    this.archetypeState = state;
  }

  /**
   * Panel de seleccion de arquetipo. Al confirmar, delega en el controlador
   * (que arranca la run con el mazo y el sesgo resueltos).
   */
  showArchetypes(): void {
    if (this.archetypeState.list.length === 0) return;
    const panel = buildArchetypePanel(
      {
        archetypes: this.archetypeState.list,
        selected: this.archetypeState.selected,
        starterSizes: this.archetypeState.starterSizes,
      },
      {
        onStart: (id) => this.callbacks.onStartRunWithArchetype(id),
        onClose: () => this.showMenu(),
      },
    );
    this.openOverlay(panel);
  }

  /**
   * Guia de inicio (P0.3, ampliada v2).
   *
   * Presenta el objetivo, los recursos de la ronda y —lo que faltaba— COMO se
   * puntua: Sustrato (suma) x Esporas (multiplica), los combos por elemento y
   * familia, el bonus de orden y los estados. Antes el tutorial solo decia
   * "elegi, selecciona, juga" y el jugador llegaba al primer ciego sin entender
   * por que una mano valia 40 y otra 400.
   *
   * Dos formas de abrirla:
   *   - Automatica UNA vez por perfil (`seenTutorial`), sobre el panel de
   *     seleccion de ciego que ya esta dibujado debajo.
   *   - `force = true` desde el menu ("Ver guia"), las veces que quiera.
   *
   * Al cerrarla desde el arranque de la run se redibuja el panel del ciego que
   * quedaba tapado; al reabrirla desde el menu se vuelve al menu.
   */
  showTutorial(force = false): void {
    // El guard es solo para el aviso AUTOMATICO: reabrir a mano (`force`) debe
    // funcionar siempre, que es justamente para lo que sirve el boton del menu.
    if (this.tutorialShown && !force) return;
    this.tutorialShown = true;
    const fromRun = !force && this.engine.run?.status === 'blind_select';

    const panel = document.createElement('div');
    panel.className = 'panel is-tutorial';
    panel.dataset['act'] = 'tutorial';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = force ? t('guide.title') : t('guide.firstBlindTitle');

    const intro = document.createElement('p');
    intro.className = 'panel-subtitle';
    intro.textContent = t('guide.intro');

    const intro2 = document.createElement('p');
    intro2.className = 'tutorial-line';
    intro2.textContent = t('guide.intro2');

    const intro3 = document.createElement('p');
    intro3.className = 'tutorial-line is-key';
    intro3.textContent = t('guide.intro3');

    // Los cuatro datos del primer desafio, con la misma jerarquia que el plan
    // dibuja: objetivo / manos / descartes / recompensa.
    const stats = document.createElement('div');
    stats.className = 'tutorial-stats';
    const die = this.engine.run?.die;
    const hands = Math.max(1, (this.engine.run?.baseHands ?? 0) + (die?.hands ?? 0));
    const discards = Math.max(0, (this.engine.run?.baseDiscards ?? 0) + (die?.discards ?? 0));
    const firstBlind = this.engine.availableBlinds()[this.engine.run?.blindIndex ?? 0];
    const target = firstBlind ? this.engine.targetFor(firstBlind) : 0;
    const reward = firstBlind?.reward ?? 0;

    const entries: Array<[string, string]> = [
      [t('guide.goalTitle'), t('blindCard.objectiveValue', { count: formatNumber(target) })],
      [t('guide.handsTitle'), String(hands)],
      [t('guide.discardsTitle'), String(discards)],
      [t('guide.rewardTitle'), `+${formatNumber(reward)}`],
    ];
    for (const [label, value] of entries) {
      const cell = document.createElement('div');
      cell.className = 'tutorial-stat';
      const labelEl = document.createElement('span');
      labelEl.className = 'tutorial-stat-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'tutorial-stat-value';
      valueEl.textContent = value;
      cell.append(labelEl, valueEl);
      stats.appendChild(cell);
    }

    const steps = document.createElement('ol');
    steps.className = 'tutorial-steps';
    for (const key of ['tutorialStep1', 'tutorialStep2', 'tutorialStep3', 'tutorialStep4']) {
      const item = document.createElement('li');
      item.textContent = t(`guide.${key}`);
      steps.appendChild(item);
    }

    // --- Secciones explicativas (v2) ---
    // Cada seccion es un titulo + filas. Las filas forman un mini glosario que
    // se lee de un vistazo, sin depender de que el jugador este mirando la
    // partida: es la explicacion de bonus, combos, multiplicadores, esporas y
    // sustrato que faltaba.
    const section = (heading: string, rows: Array<[string, string]>): HTMLElement => {
      const box = document.createElement('section');
      box.className = 'tutorial-section';
      const h = document.createElement('h3');
      h.className = 'tutorial-section-title';
      h.textContent = t(`guide.${heading}`);
      box.appendChild(h);
      for (const [termKey, descKey] of rows) {
        const row = document.createElement('div');
        row.className = 'tutorial-row';
        const term = document.createElement('span');
        term.className = 'tutorial-term';
        term.textContent = t(`guide.${termKey}`);
        const desc = document.createElement('span');
        desc.className = 'tutorial-desc';
        desc.textContent = t(`guide.${descKey}`);
        row.append(term, desc);
        box.appendChild(row);
      }
      return box;
    };

    const sections = document.createElement('div');
    sections.className = 'tutorial-sections';
    sections.append(
      section('sectBasics', [
        ['substrateTitle', 'substrateDesc'],
        ['sporesTitle', 'sporesDesc'],
        ['multTitle', 'multDesc'],
      ]),
      section('sectCombos', [
        ['comboElementTitle', 'comboElementDesc'],
        ['comboFamilyTitle', 'comboFamilyDesc'],
        ['comboDiversityTitle', 'comboDiversityDesc'],
      ]),
      section('sectBonus', [
        ['orderTitle', 'orderDesc'],
        ['statusTitle', 'statusDesc'],
      ]),
      section('sectGoal', [['goalDesc', 'goalDesc']]),
    );

    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    const close = document.createElement('button');
    close.className = 'btn is-play';
    close.dataset['act'] = 'tutorial-close';
    close.textContent = fromRun ? t('action.play') : t('ui.close');
    close.addEventListener('click', () => {
      if (fromRun) {
        // `lastStatus = null` fuerza a redibujar el panel del estado actual
        // (blind_select), que es el que estaba tapado por el tutorial.
        this.lastStatus = null;
        this.closePanel();
      } else {
        this.showMenu();
      }
    });
    actions.appendChild(close);

    // Cuerpo scrolleable: el encabezado y la accion quedan fijos. Sin esto, en
    // landscape movil el glosario empujaba "Jugar" fuera de pantalla.
    const body = document.createElement('div');
    body.className = 'tutorial-body';
    body.append(intro, intro2, intro3, stats, steps, sections);

    panel.append(title, body, actions);
    this.openOverlay(panel);
  }

  /** Marca la guia como vista (el controlador la persiste en el perfil). */
  markTutorialSeen(): void {
    this.tutorialShown = true;
  }

  /** `true` si la guia ya se mostro en esta sesion. */
  get tutorialSeen(): boolean {
    return this.tutorialShown;
  }

  /** Abre el panel de seleccion de ascension. */
  showAscension(): void {
    // El `openOverlay` limpia las referencias del panel: se toma el estado
    // ANTES de abrirlo (trampa conocida de este HUD).
    const state = { ...this.ascensionState };
    const panel = buildAscensionPanel(state, {
      onSelect: (level) => this.callbacks.onSelectAscension(level),
      onClose: () => this.showMenu(),
    });
    this.openOverlay(panel);
  }

  /**
   * Estado de cosméticos para el panel. Lo empuja el controlador cada vez que el
   * perfil cambia (y antes de `showMenu`), porque el HUD no conoce el perfil.
   */
  setCosmeticsState(state: CosmeticsState): void {
    this.cosmeticsState = state;
  }

  /** Abre el panel de cosméticos (dorso de carta / tapete). */
  showCosmetics(): void {
    // Igual que la ascension: el `openOverlay` limpia las referencias del panel,
    // asi que se toma el estado ANTES de abrirlo.
    const state: CosmeticsState = {
      owned: [...this.cosmeticsState.owned],
      equipped: { ...this.cosmeticsState.equipped },
    };
    const panel = buildCosmeticsPanel(state, {
      onEquip: (kind: CosmeticKind, id: string) => {
        this.callbacks.onEquip(kind, id);
        // Reabre para reflejar la nueva selección (el equipado se marca).
        this.showCosmetics();
      },
      onClose: () => this.showMenu(),
    });
    this.openOverlay(panel);
  }

  /**
   * Historial (R5) para el panel. Lo empuja el controlador desde el perfil,
   * porque el HUD no conoce el estado meta.
   */
  setHistoryState(entries: HistoryEntryView[]): void {
    this.historyState = entries;
  }

  /** Abre el panel de historial de partidas. */
  showHistory(): void {
    // Misma trampa que ascension/cosméticos: `openOverlay` limpia el panel.
    const entries = this.historyState.map((e) => ({ ...e }));
    const panel = buildHistoryPanel(entries, { onClose: () => this.showMenu() });
    this.openOverlay(panel);
  }
  private boardAvailable = false;

  setBoardAvailable(available: boolean): void {
    this.boardAvailable = available;
  }

  // ==========================================================================
  // Fase 5: duelo micelial
  // ==========================================================================

  /** Pantalla del duelo activa, o null. */
  private boardScreen: BoardScreen | null = null;

  /**
   * Abre el tablero con una vista YA redactada.
   *
   * El HUD no arma el `BoardView` ni aplica comandos: recibe la vista del
   * controlador (que es quien tiene el estado del duelo) y le devuelve una
   * pantalla viva para poder actualizarla turno a turno.
   */
  showBoard(
    view: BoardView,
    resolve: BoardResolvers,
    callbacks: BoardScreenCallbacks,
  ): BoardScreen {
    this.boardScreen?.destroy();
    const screen = new BoardScreen(view, resolve, callbacks);
    this.boardScreen = screen;
    this.openOverlay(screen.element);
    return screen;
  }

  /** Cierra el tablero (al salir del duelo). */
  closeBoard(): void {
    this.boardScreen?.destroy();
    this.boardScreen = null;
    this.hideOverlay();
  }

  showSettings(settings: ProfileSettings): void {
    this.showPanel(
      buildSettingsPanel(settings, {
        onPatch: (patch) => this.settingsPatch?.(patch),
        onToggleLanguage: () => this.callbacks.onToggleLanguage(),
        onClose: () => this.showMenu(),
      }),
    );
  }

  showAbout(): void {
    this.showPanel(
      buildAboutPanel(
        {
          version: this.appInfo.version,
          contentHash: this.appInfo.contentHash,
          packs: this.appInfo.packs,
          ...(this.appInfo.skipped ? { skipped: this.appInfo.skipped } : {}),
        },
        () => this.showMenu(),
      ),
    );
  }

  /** Inyectado por el controlador: es quien escribe en el perfil. */
  private settingsPatch: ((patch: Partial<ProfileSettings>) => void) | null = null;

  bindSettingsPatch(fn: (patch: Partial<ProfileSettings>) => void): void {
    this.settingsPatch = fn;
  }

  // ==========================================================================
  // Fase 2: recompensa, deckbuilding y coleccion
  // ==========================================================================

  /** Draft de recompensa al ganar un blind. */
  showReward(): void {
    this.showPanel(
      buildRewardPanel(
        {
          offers: this.engine.rewardOffers(),
          pick: this.engine.rewardPick,
          allowSkip: this.engine.rewardAllowSkip,
          taken: this.engine.rewardOffers().filter((o) => o.sold).length,
          // La cara de la carta la compone el HUD: es quien tiene el motor y las
          // imagenes decodificadas del render.
          artFor: (offer) =>
            offerFaceUrl(offer, this.engine, t, {
              card: this.cardArt,
              joker: this.jokerArt,
            }),
        },
        {
          onPick: (offerId) => this.callbacks.onPickReward(offerId),
          onSkip: () => this.callbacks.onPickReward(null),
        },
      ),
    );
  }

  /**
   * Mazo de la run: ver, ordenar, mejorar, evolucionar y purgar.
   *
   * El HUD resuelve aca el coste de mejora y la evolucion disponible de cada
   * carta, para que el panel sea una funcion pura de los datos.
   */
  /**
   * Estado del mazo YA resuelto (coste de mejora, evolucion disponible, etc.).
   *
   * Lo comparten el panel DOM de siempre y el carrusel 3D: el HUD es el unico
   * que tiene el motor, asi que resolver aca evita duplicar la logica.
   */
  deckState(highlightUid?: string): DeckBuilderState {
    const cards = this.engine.run.deck.allCards;

    const info: Record<string, DeckCardInfo> = {};
    for (const card of cards) {
      const quote = this.engine.upgradeQuote(card.uid);
      const options = this.engine.evolutionOptions(card.uid);
      const ready = options.find((option) => option.met) ?? null;
      const first = options[0] ?? null;

      info[card.uid] = {
        upgradeCost: quote && !quote.atMaxLevel ? quote.cost : null,
        atMaxLevel: quote?.atMaxLevel ?? false,
        // Se muestra siempre el destino (aunque falte el requisito): enterarse
        // de que existe una evolucion es lo que empuja a cultivarla.
        evolveLabel: first ? t('evolve.to', { name: t(first.target.nameKey) }) : null,
        evolveReady: ready !== null,
      };
    }

    return {
      cards,
      money: this.engine.run.money,
      purgeCost: this.engine.purgeCost,
      canEdit: this.engine.canEditDeck(),
      info,
      ...(highlightUid ? { highlightUid } : {}),
      ...(this.cardArt ? { cardArt: this.cardArt } : {}),
    };
  }

  showDeckBuilder(highlightUid?: string): void {
    this.showPanel(
      buildDeckBuilderPanel(this.deckState(highlightUid), {
        onPurge: (uid) => this.callbacks.onPurge(uid),
        onUpgrade: (uid) => this.callbacks.onUpgrade(uid),
        onEvolve: (uid) => this.callbacks.onEvolve(uid),
        onClose: () => {
          this.lastStatus = null;
          this.render();
        },
      }),
    );
  }

  /** Coleccion: la provee el controlador (necesita el registro y el gate). */
  private collectionProvider: (() => CollectionEntry[]) | null = null;

  bindCollectionProvider(fn: () => CollectionEntry[]): void {
    this.collectionProvider = fn;
  }

  showCollection(): void {
    const entries = this.collectionProvider?.() ?? [];
    this.showPanel(
      buildCollectionPanel(entries, {
        // Se puede abrir la coleccion desde el menu o desde una run en curso:
        // al cerrar se vuelve al overlay que corresponda al estado actual.
        onClose: () => {
          this.lastStatus = null;
          this.render();
        },
        onOpenStore: () => this.callbacks.onOpenExpansions(),
        onOpenPass: () => this.callbacks.onOpenPass(),
      }),
    );
  }

  // ==========================================================================
  // Retencion: recompensa diaria y logros
  // ==========================================================================

  /**
   * El HUD no conoce el registro de contenido, asi que no puede traducir
   * "desbloqueaste la carta X" a un nombre. Lo inyecta el controlador, igual
   * que las ilustraciones de las cartas.
   */
  private rewardNames: ((reward: RetentionReward) => string) | null = null;

  bindRewardNames(fn: (reward: RetentionReward) => string): void {
    this.rewardNames = fn;
  }

  private nameOfReward(reward: RetentionReward): string {
    return this.rewardNames?.(reward) ?? reward.id;
  }

  /**
   * Recompensa diaria.
   *
   * El claim NO redibuja solo: lo vuelve a llamar el controlador con el estado
   * nuevo. Asi el panel sigue siendo una funcion de los datos y no guarda un
   * "ya reclame" propio que se pueda desincronizar del perfil.
   */
  showDailyReward(state: DailyEvaluation, table: DailyRewardTable, onClose: () => void): void {
    this.showPanel(
      buildDailyRewardPanel(state, table, {
        nameOf: (reward) => this.nameOfReward(reward),
        onClaim: () => this.callbacks.onClaimDaily(),
        onClose,
      }),
    );
  }

  showAchievements(entries: AchievementView[]): void {
    this.showPanel(
      buildAchievementsPanel(entries, {
        onClose: () => {
          this.lastStatus = null;
          this.render();
        },
      }),
    );
  }

  // ==========================================================================
  // (El dado por gesto se retiro del HUD)
  // ==========================================================================
  //
  // Antes la seleccion de ciego pedia TIRAR el dado a mano para desbloquear la
  // eleccion. Ese flujo desaparecio: cada ante juega sus 3 ciegos en orden, sin
  // eleccion ni tirada previa. El dado ahora es la habilidad ACTIVA del
  // Simbionte legendario (`joker_loaded_die`), que se resuelve con un boton en
  // la barra de acciones y se pinta en `renderLoadedDie()`.

  /**
   * P2.3 / P2.4 — Panel de un EVENTO entre Ciegos.
   *
   * El plan pide "decisiones de riesgo/recompensa entre desafios" y "eventos
   * entre Ciegos". Las dos cosas son la misma pantalla: un trato con una
   * ventaja y un coste, y una opcion de seguir de largo.
   *
   * Cada opcion muestra su EFECTO en texto generado desde los `effects` reales
   * (no desde un texto escrito a mano en el JSON): asi el numero que se lee es
   * el que el motor va a aplicar. Un `detailKey` acompaña, pero la linea de
   * datos es la fuente de verdad.
   */
  private showInterlude(): void {
    const def = this.engine.currentInterlude;
    if (!def) return;

    const panel = document.createElement('div');
    panel.className = 'panel is-interlude';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t(def.nameKey);
    title.dataset['act'] = 'interlude-title';

    const subtitle = document.createElement('p');
    subtitle.className = 'panel-subtitle';
    subtitle.textContent = t('interlude.subtitle');

    const desc = document.createElement('p');
    desc.className = 'panel-desc';
    desc.textContent = t(def.descKey);

    // --- Cabecera con arte (reutiliza el pool de arte de ciegos) ---
    const head = document.createElement('div');
    head.className = 'interlude-head';
    const art = this.blindArt?.(def.art);
    if (art?.src) {
      const artImg = document.createElement('img');
      artImg.className = 'interlude-art';
      artImg.src = art.src;
      artImg.alt = '';
      artImg.setAttribute('aria-hidden', 'true');
      head.appendChild(artImg);
    }
    head.append(title, subtitle);

    const choices = document.createElement('div');
    choices.className = 'interlude-choices';

    for (const choice of def.choices) {
      choices.appendChild(this.buildInterludeChoice(choice));
    }

    panel.append(head, desc, choices);
    this.openOverlay(panel);
    // La arena ya no esta en juego entre ciegos: se corta el render de fondo.
    this.callbacks.onArenaCovered?.(true);

    anim
      .sequence()
      .fromTo(
        choices.querySelectorAll('.interlude-choice'),
        { y: 16, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: anim.d(0.28),
          ease: anim.EASE.cssOut,
          stagger: { amount: anim.d(0.14) },
        },
      );
  }

  /** Una opcion del interludio: etiqueta, efecto en datos y boton de elegir. */
  private buildInterludeChoice(choice: InterludeChoice): HTMLElement {
    const card = document.createElement('div');
    card.className = 'interlude-choice';
    card.dataset['act'] = 'interlude-choice';
    card.dataset['choice'] = choice.id;

    const label = document.createElement('div');
    label.className = 'interlude-choice-label';
    label.textContent = t(choice.labelKey);

    const detail = document.createElement('div');
    detail.className = 'interlude-choice-detail';
    detail.textContent = t(choice.detailKey);

    card.append(label, detail);

    const effects = choice.effects ?? [];
    if (effects.length > 0) {
      const lines = document.createElement('ul');
      lines.className = 'interlude-effects';
      for (const line of this.describeInterludeEffects(effects)) {
        const item = document.createElement('li');
        item.textContent = line;
        lines.appendChild(item);
      }
      card.appendChild(lines);
    }

    const isDecline = effects.length === 0;
    card.classList.toggle('is-decline', isDecline);

    const affordable = this.canAffordInterlude(effects);
    const button = document.createElement('button');
    button.className = `btn ${isDecline ? 'is-ghost' : 'is-play'}`;
    button.textContent = t(isDecline ? 'interlude.decline' : 'interlude.accept');
    button.disabled = !affordable;
    if (!affordable) button.title = t('interlude.cantAfford');
    button.addEventListener('click', () => this.callbacks.onChooseInterlude(choice.id));
    card.appendChild(button);

    return card;
  }

  /**
   * Traduce los efectos a lineas legibles. Es la fuente de verdad de lo que se
   * muestra: si el efecto cambia en el JSON, el texto cambia solo.
   */
  private describeInterludeEffects(effects: readonly InterludeEffect[]): string[] {
    const out: string[] = [];
    for (const effect of effects) {
      switch (effect.type) {
        case 'MONEY':
          out.push(
            effect.value >= 0
              ? t('shop.impactMoneyGain', { value: formatNumber(effect.value) })
              : t('shop.impactMoneyCost', { value: formatNumber(Math.abs(effect.value)) }),
          );
          break;
        case 'TARGET_MULTIPLIER': {
          const pct = Math.round(Math.abs(effect.value - 1) * 100);
          out.push(
            effect.value >= 1
              ? t('interlude.targetUp', { pct })
              : t('interlude.targetDown', { pct }),
          );
          break;
        }
        case 'JOKER_SLOT':
          out.push(
            effect.value >= 0
              ? t('shop.impactJokerSlot', { value: effect.value })
              : t('shop.impactJokerSlotNeg', { value: effect.value }),
          );
          break;
        case 'HANDS_DELTA':
          out.push(
            effect.value >= 0
              ? t('shop.impactHandsPlus', { value: effect.value })
              : t('shop.impactHands', { value: effect.value }),
          );
          break;
        case 'HAND_SIZE':
          out.push(
            effect.value >= 0
              ? t('shop.impactHandSize', { value: effect.value })
              : t('shop.impactHandSizeNeg', { value: effect.value }),
          );
          break;
        case 'CARD':
          out.push(t('shop.impactCardCount', { value: effect.count ?? 1 }));
          break;
        case 'PURGE_RANDOM':
          out.push(t('shop.impactPurge', { value: effect.count ?? 1 }));
          break;
        case 'UPGRADE_RANDOM':
          out.push(t('shop.impactUpgrade', { value: effect.count ?? 1 }));
          break;
        default:
          break;
      }
    }
    return out;
  }

  /** Puede pagar el coste en dinero de esta opcion? (Solo se chequea MONEY.) */
  private canAffordInterlude(effects: readonly InterludeEffect[]): boolean {
    let money = this.engine.run.money;
    for (const effect of effects) {
      if (effect.type === 'MONEY') money += effect.value;
    }
    return money >= 0;
  }

  private showBlindSelect(): void {
    const run = this.engine.run;
    const panel = document.createElement('div');
    panel.className = 'panel is-blind-select';

    // Los 3 ciegos de cada ante se juegan EN ORDEN y no se eligen. El progreso
    // `n/3` dice donde estas parado sin sugerir que haya una decision.
    const blindCount = this.engine.availableBlinds().length;
    const blindPos = Math.min(run.blindIndex + 1, blindCount);
    const current = this.engine.availableBlinds()[run.blindIndex];
    const currentTarget = current ? this.engine.targetFor(current) : 0;

    // --- Cabecera: PRÓXIMO DESAFÍO ---
    //
    // Antes esta pantalla repetia la misma informacion cuatro veces: "Ciego"
    // como titulo Y como explicacion, dos ordenes casi identicas, el objetivo
    // en el bloque principal Y dentro de la tarjeta, y la guia repitiendo la
    // frase final. Ahora hay UNA sola estructura.
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t('blindCard.upNextTitle');

    const subtitle = document.createElement('p');
    subtitle.className = 'panel-subtitle';
    subtitle.textContent = `${t('hud.ante')} ${run.ante} · ${t('blindCard.progress', { current: blindPos, total: blindCount })} · ${t('hud.money')} ${formatNumber(run.money)}`;

    // P2.3 — Aviso de que el objetivo esta alterado por un interludio. Sin
    // esto, un jugador que acepto "+15% de objetivo" veria un numero distinto
    // al del contenido y no sabria por que. Se mantiene porque NO es duplicado:
    // es un dato extra que ninguna otra parte de la pantalla dice.
    const interludeMul = run.interludeModifiers?.targetMultiplier ?? 1;
    let interludeNotice: HTMLElement | null = null;
    if (Math.abs(interludeMul - 1) > 0.001) {
      interludeNotice = document.createElement('p');
      interludeNotice.className = 'blind-help is-interlude';
      interludeNotice.dataset['act'] = 'blind-interlude-notice';
      const noticeTag = document.createElement('span');
      noticeTag.className = 'blind-help-tag';
      noticeTag.textContent = t('interlude.title');
      const noticeText = document.createElement('span');
      noticeText.className = 'blind-help-text';
      const pct = Math.round(Math.abs(interludeMul - 1) * 100);
      noticeText.textContent = t(
        interludeMul >= 1 ? 'interlude.targetUp' : 'interlude.targetDown',
        { pct },
      );
      interludeNotice.append(noticeTag, noticeText);
    }

    // --- Tarjeta unica del desafio en curso ---
    //
    // Solo se dibuja el ciego ACTUAL a tamano completo: los ya superados quedan
    // como una tira de puntos (ruta) y el siguiente no se adelanta. Antes se
    // listaban los 3 con toda su ficha y la pantalla se leia como una tienda.
    const focus = document.createElement('div');
    focus.className = 'blind-focus';

    // Tira de ruta: 3 marcas que dicen en que punto del ante estas.
    const route = document.createElement('div');
    route.className = 'blind-route';
    route.dataset['act'] = 'blind-route';
    for (let i = 0; i < blindCount; i++) {
      const dot = document.createElement('span');
      dot.className = 'blind-route-dot';
      if (i < run.blindIndex) dot.classList.add('is-done');
      if (i === run.blindIndex) dot.classList.add('is-now');
      dot.dataset['blindRouteIndex'] = String(i);
      route.appendChild(dot);
    }

    if (current) {
      const isBoss = (current.effects?.length ?? 0) > 0;

      const card = document.createElement('div');
      card.className = `blind-card is-current${isBoss ? ' is-boss' : ''}`;
      card.dataset['act'] = 'blind';
      card.dataset['blind'] = current.id;
      card.dataset['blindBoss'] = isBoss ? '1' : '0';
      card.dataset['blindCurrent'] = '1';
      if (current.tier) card.dataset['blindTier'] = current.tier;

      // Ilustracion: fondo a sangre (mismo patron que la cara de carta).
      const art = this.blindArt?.(current.art);
      if (art?.src) {
        const artImg = document.createElement('img');
        artImg.className = 'blind-art';
        artImg.src = art.src;
        artImg.alt = '';
        artImg.setAttribute('aria-hidden', 'true');
        card.appendChild(artImg);
      }

      // Cabecera: nombre + etiqueta JEFE.
      const head = document.createElement('div');
      head.className = 'blind-head';
      const name = document.createElement('div');
      name.className = 'blind-name';
      name.textContent = t(current.nameKey);
      head.append(name);
      if (isBoss) {
        const bossTag = document.createElement('span');
        bossTag.className = 'blind-tag is-boss';
        bossTag.textContent = t('blindCard.boss');
        head.append(bossTag);
      }

      // Descripcion: para un ciego normal es sabor; para un JEFE es su EFECTO
      // (el contenido pone la regla en `descKey`), asi que se etiqueta como tal
      // en vez de repetirla dos veces. En un ciego comun se muestra solo si
      // aporta algo distinto del nombre.
      const descText = t(current.descKey);
      let desc: HTMLElement | null = null;
      if (descText && descText !== t(current.nameKey)) {
        desc = document.createElement('div');
        desc.className = isBoss ? 'blind-effect' : 'blind-desc';
        if (isBoss) {
          const effectTag = document.createElement('span');
          effectTag.className = 'blind-effect-tag';
          effectTag.textContent = t('blindCard.effect');
          const effectBody = document.createElement('span');
          effectBody.className = 'blind-effect-text';
          effectBody.textContent = descText;
          desc.append(effectTag, effectBody);
        } else {
          desc.textContent = descText;
        }
      }

      // Estadisticas: Objetivo / Manos / Descartes. Una sola vez, en su zona
      // fija. Manos y descartes son los valores BASE de la run.
      const handsForBlind = Math.max(1, run.baseHands);
      const discardsForBlind = Math.max(0, run.baseDiscards);

      const stats = document.createElement('div');
      stats.className = 'blind-stats';
      stats.dataset['act'] = 'blind-stats';

      const objectiveCell = document.createElement('div');
      objectiveCell.className = 'blind-stat is-objective';
      objectiveCell.dataset['blindResource'] = 'objective';
      const objectiveLabel = document.createElement('span');
      objectiveLabel.className = 'blind-stat-label';
      objectiveLabel.textContent = t('guide.goalTitle');
      const objectiveValue = document.createElement('span');
      objectiveValue.className = 'blind-stat-value is-objective';
      objectiveValue.textContent = formatNumber(currentTarget);
      objectiveCell.append(objectiveLabel, objectiveValue);

      const handsCell = document.createElement('div');
      handsCell.className = 'blind-stat is-hands';
      handsCell.dataset['blindResource'] = 'hands';
      const handsLabel = document.createElement('span');
      handsLabel.className = 'blind-stat-label';
      handsLabel.textContent = t('guide.handsTitle');
      const handsValue = document.createElement('span');
      handsValue.className = 'blind-stat-value';
      handsValue.textContent = formatNumber(handsForBlind);
      handsCell.append(handsLabel, handsValue);

      const discardsCell = document.createElement('div');
      discardsCell.className = 'blind-stat is-discards';
      discardsCell.dataset['blindResource'] = 'discards';
      const discardsLabel = document.createElement('span');
      discardsLabel.className = 'blind-stat-label';
      discardsLabel.textContent = t('guide.discardsTitle');
      const discardsValue = document.createElement('span');
      discardsValue.className = 'blind-stat-value';
      discardsValue.textContent = formatNumber(discardsForBlind);
      discardsCell.append(discardsLabel, discardsValue);

      stats.append(objectiveCell, handsCell, discardsCell);

      // Recompensa: un solo lugar, con el multiplicador como contexto.
      const reward = document.createElement('div');
      reward.className = 'blind-reward';
      const rewardIcon = document.createElement('img');
      rewardIcon.className = 'blind-reward-icon';
      rewardIcon.src = 'ui/fungi.png';
      rewardIcon.alt = '';
      rewardIcon.setAttribute('aria-hidden', 'true');
      const rewardAmount = document.createElement('span');
      rewardAmount.className = 'blind-reward-amount';
      rewardAmount.textContent = `+${formatNumber(current.reward)}`;
      const rewardLabel = document.createElement('span');
      rewardLabel.textContent = t('blindCard.reward');
      reward.append(rewardIcon, rewardAmount, rewardLabel);
      const multTag = document.createElement('span');
      multTag.className = 'blind-reward-mult';
      multTag.textContent = `×${formatMultiplier(current.scoreMultiplier)} ${t('blindCard.mult')}`;
      reward.append(multTag);

      card.append(head);
      if (desc) card.appendChild(desc);
      card.append(stats, reward);
      focus.append(card);
    }

    // --- Una sola linea de ayuda ---
    //
    // Reemplaza a las dos ordenes casi identicas + la explicacion de "Ciego"
    // que se repetia cada vez. Se muestra SIEMPRE (no "una vez por run"): es la
    // unica frase que hay y resume como funciona la pantalla.
    const help = document.createElement('p');
    help.className = 'blind-help is-order';
    help.dataset['act'] = 'blind-help';
    const helpTag = document.createElement('span');
    helpTag.className = 'blind-help-tag';
    helpTag.textContent = t('hud.blind');
    const helpText = document.createElement('span');
    helpText.className = 'blind-help-text';
    helpText.textContent = t('blindCard.singleHelp');
    help.append(helpTag, helpText);

    // --- Acciones ---
    //
    // UNA accion principal (Luchar) y UNA secundaria (Menu). "Continuar
    // partida" NO va aca: en medio de una run no hay nada que continuar, eso
    // vive en el menu principal. El mazo se abre con un boton terciario.
    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const start = document.createElement('button');
    start.className = 'btn is-play';
    start.dataset['act'] = 'blind-start';
    start.textContent = t('blindCard.start');
    start.addEventListener('click', () => this.callbacks.onStartBlind());
    actions.appendChild(start);

    const deck = document.createElement('button');
    deck.className = 'btn';
    deck.textContent = `${t('deck.open')} (${run.deck.totalSize})`;
    deck.dataset['act'] = 'deck';
    deck.addEventListener('click', () => this.callbacks.onOpenDeck());

    const details = document.createElement('button');
    details.className = 'btn is-ghost';
    details.dataset['act'] = 'blind-details';
    details.textContent = t('blindCard.details');
    details.addEventListener('click', () => this.showRunDetails());

    const menu = document.createElement('button');
    menu.className = 'btn is-ghost';
    menu.dataset['act'] = 'blind-menu';
    menu.textContent = t('ui.menu');
    menu.addEventListener('click', () => this.callbacks.onQuitToMenu());

    actions.append(deck, details, menu);

    panel.append(title, subtitle, route, focus);
    if (interludeNotice) panel.appendChild(interludeNotice);
    panel.append(help, actions);
    this.openOverlay(panel);

    // La tarjeta entra sola (ya no hay cascada de 3).
    const card = focus.querySelector('.blind-card');
    if (card) {
      anim
        .sequence()
        .fromTo(
          card,
          { y: 18, opacity: 0 },
          { y: 0, opacity: 1, duration: anim.d(0.3), ease: anim.EASE.cssOut },
        );
    }
  }

  /**
   * Panel de detalles de la run (semilla incluida).
   *
   * La semilla dejo de estar a la vista durante el flujo normal: no es una
   * decision (no se puede cambiar) y ocupaba el lugar de datos que si importan.
   * Aca queda a mano quien la quiera compartir o repetir, sin ensuciar la
   * pantalla de desafio.
   */
  private showRunDetails(): void {
    const run = this.engine.run;
    const panel = document.createElement('div');
    panel.className = 'panel is-blind-details';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t('blindCard.detailsTitle');

    const list = document.createElement('div');
    list.className = 'details-list';
    const rows: Array<[string, string]> = [
      [t('ui.seed'), String(run.seed)],
      [t('hud.ante'), String(run.ante)],
      [t('ascension.title'), run.ascension > 0 ? `A${run.ascension}` : t('ascension.off')],
      [t('deck.title'), String(run.deck.totalSize)],
      [t('hud.money'), formatNumber(run.money)],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'details-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'details-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'details-value';
      valueEl.textContent = value;
      valueEl.dataset['detailsValue'] = label;
      row.append(labelEl, valueEl);
      list.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    const back = document.createElement('button');
    back.className = 'btn is-play';
    back.dataset['act'] = 'blind-details-back';
    back.textContent = t('ui.close');
    back.addEventListener('click', () => this.showBlindSelect());
    actions.appendChild(back);

    panel.append(title, list, actions);
    this.openOverlay(panel);
  }

  /**
   * P2.5 — Resumen numerico de lo que una oferta agrega al mazo.
   *
   * La tienda ya muestra el efecto en prosa; esto lo traduce a datos
   * comparables (sustrato, esporas, si trae habilidad). Sin esto, elegir entre
   * dos cartas obliga a leer las dos descripciones y recordarlas.
   *
   * Devuelve null para lo que no se puede resumir (dinero), y asi la tarjeta no
   * muestra un bloque vacio.
   */
  private buildOfferImpact(offer: ShopOffer): HTMLElement | null {
    const lines: string[] = [];

    if (offer.kind === 'card') {
      const def = this.engine.registry.tryGetCard(offer.refId);
      if (!def) return null;
      lines.push(t('shop.impactSubstrate', { value: def.baseSubstrate }));
      lines.push(t('shop.impactSpores', { value: def.baseSpores }));
      lines.push(
        (def.effects?.length ?? 0) > 0 ? t('shop.impactAbility') : t('shop.impactNoAbility'),
      );
    } else if (offer.kind === 'joker' || offer.kind === 'mutation') {
      lines.push(t('shop.impactJoker'));
      // Se avisa solo si NO hay ranura libre: es la advertencia que hace falta
      // en el momento de decidir, no un recordatorio permanente.
      if (this.engine.run.jokers.length >= this.engine.run.jokerSlots) {
        lines.push(t('shop.impactSlots'));
      }
    } else if (offer.kind === 'voucher') {
      const def = this.engine.registry.tryGetVoucher(offer.refId);
      lines.push(t('shop.impactVoucher'));
      if (def && !def.repeatable && this.engine.run.vouchers.includes(offer.refId)) {
        lines.push(t('shop.impactOwned'));
      }
    } else {
      return null;
    }

    const wrap = document.createElement('ul');
    wrap.className = 'offer-impact';
    wrap.dataset['act'] = 'offer-impact';
    for (const line of lines) {
      const item = document.createElement('li');
      item.textContent = line;
      wrap.appendChild(item);
    }
    return wrap;
  }

  private showShop(offers: ShopOffer[]): void {
    if (this.engine.run.status !== 'shop') return;

    const panel = document.createElement('div');
    panel.className = 'panel is-shop';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t('shop.title');

    const subtitle = document.createElement('p');
    subtitle.className = 'panel-subtitle';

    // --- Pestañas (Comprar / Vender) ---
    // Antes la tienda solo mostraba la estanteria: para deshacerse de un
    // Simbionte habia que salir de la tienda y usar la ficha del HUD. Aca la
    // venta es una PESTAÑA mas, con la misma jerarquia que comprar.
    const tabs = document.createElement('div');
    tabs.className = 'shop-tabs';
    tabs.setAttribute('role', 'tablist');

    const body = document.createElement('div');
    body.className = 'shop-body';

    let refreshBuy: () => void = () => {};

    const setTab = (tab: 'buy' | 'sell'): void => {
      tabs.querySelectorAll<HTMLButtonElement>('.shop-tab').forEach((b) => {
        const active = b.dataset['tab'] === tab;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      body.innerHTML = '';
      if (tab === 'buy') {
        body.appendChild(this.buildBuyTab(offers, (fn) => { refreshBuy = fn; }));
        refreshBuy();
      } else {
        body.appendChild(this.buildSellTab());
      }
    };

    for (const [id, key] of [['buy', 'shop.tabBuy'], ['sell', 'shop.tabSell']] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-tab';
      btn.dataset['tab'] = id;
      btn.dataset['act'] = `shop-tab-${id}`;
      btn.setAttribute('role', 'tab');
      btn.textContent = t(key);
      btn.addEventListener('click', () => setTab(id));
      tabs.appendChild(btn);
    }

    // La barra inferior (mazo, renovar, salir) es comun a las dos pestañas.
    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const deck = document.createElement('button');
    deck.className = 'btn';
    deck.textContent = `${t('deck.open')} (${this.engine.run.deck.totalSize})`;
    deck.dataset['act'] = 'deck';
    deck.addEventListener('click', () => this.callbacks.onOpenDeck());

    const reroll = document.createElement('button');
    reroll.className = 'btn';
    // El precio del reroll tambien pasa por el motor: un voucher puede bajarlo.
    reroll.textContent = t('shop.rerollCost', { cost: this.engine.rerollPrice });
    reroll.disabled = this.engine.run.money < this.engine.rerollPrice;
    reroll.addEventListener('click', () => this.callbacks.onReroll());

    const leave = document.createElement('button');
    leave.className = 'btn is-play';
    leave.textContent = t('action.leaveShop');
    leave.addEventListener('click', () => this.callbacks.onLeaveShop());

    actions.append(deck, reroll, leave);
    panel.append(title, subtitle, tabs, body, actions);
    this.openOverlay(panel);

    // Primera pestaña por defecto: comprar.
    setTab('buy');

    // Ver la nota de `shopRefresh`. Solo se recalcula lo que depende del
    // dinero: las tarjetas NO se reconstruyen, asi que las ilustraciones ya
    // dibujadas no se vuelven a generar en cada cambio de plata.
    this.shopRefresh = () => {
      const money = this.engine.run.money;
      subtitle.textContent = `${t('hud.money')}: ${formatNumber(money)} · ${t('hud.jokers')} ${this.engine.run.jokers.length}/${this.engine.run.jokerSlots}`;
      refreshBuy();
      reroll.disabled = money < this.engine.rerollPrice;
    };
    this.shopRefresh();
  }

  /**
   * Pestaña "Comprar": la estantería de siempre. `registerRefresh` deja que el
   * shell guarde el refresco por dinero (para `shopRefresh`).
   */
  private buildBuyTab(
    offers: ShopOffer[],
    registerRefresh?: (fn: () => void) => void,
  ): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'offer-grid';

    if (offers.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'offer-desc';
      empty.textContent = t('shop.empty');
      grid.appendChild(empty);
    }

    /** Botones de compra, para poder recalcular su estado sin rehacer el panel. */
    const buyButtons: {
      offer: ShopOffer;
      button: HTMLButtonElement;
      card: HTMLElement;
      priceEl: HTMLElement;
    }[] = [];
    /** Sellos de "vendida", en el mismo orden que `offers`. */
    const soldStamps: HTMLElement[] = [];

    for (const offer of offers) {
      // El precio REAL lo resuelve el motor (descuentos de vouchers incluidos).
      // Leer `offer.cost` aca pintaria un numero y cobraria otro.
      const price = this.engine.priceOf(offer);
      const card = document.createElement('div');
      card.className = `offer${offer.sold ? ' is-sold' : ''}`;
      if (offer.kind === 'voucher') card.classList.add('is-voucher');

      // Miniatura de la carta: misma cara procedural que la carta real.
      const artUrl = offerFaceUrl(offer, this.engine, t, {
        card: this.cardArt,
        joker: this.jokerArt,
      });
      if (artUrl) {
        const art = document.createElement('img');
        art.className = 'offer-art';
        art.src = artUrl;
        art.alt = t(offer.nameKey);
        art.loading = 'lazy';
        card.appendChild(art);
      } else {
        // Respaldo si la cara no se pudo componer: SIN este hueco la tarjeta se
        // queda mas baja que sus vecinas y la fila de precios se sale del panel.
        // El arte es lo que le da altura a todas por igual, tenga o no dibujo.
        const spacer = document.createElement('div');
        spacer.className = 'offer-art is-placeholder';
        spacer.setAttribute('aria-hidden', 'true');
        card.appendChild(spacer);
      }

      const kind = document.createElement('div');
      kind.className = 'offer-kind';
      // La etiqueta se traduce: `CARD`/`JOKER`/`VOUCHER` en crudo es la clave
      // del motor, no un texto para el jugador.
      kind.textContent = offerLabel(offer.kind);

      const name = document.createElement('div');
      name.className = 'offer-name';
      name.textContent = t(offer.nameKey);
      name.style.color = hexToCss(
        offer.kind === 'joker' || offer.kind === 'mutation'
          ? RARITY_COLOR[rarityOfOffer(this.engine, offer)]
          : ELEMENT_COLOR.neutral,
      );

      const desc = document.createElement('div');
      desc.className = 'offer-desc';
      desc.textContent = t(offer.descKey);

      // P2.5 — "Que aporta": el plan pide que las mejoras de la tienda sean mas
      // VISIBLES. `offer.descKey` describe el efecto en prosa, pero comparar dos
      // ofertas obliga a leer y traducir mentalmente. Esta lista dice en
      // numeros lo que la compra agrega al mazo, que es lo que se decide.
      const impact = this.buildOfferImpact(offer);
      if (impact) card.appendChild(impact);

      const footer = document.createElement('div');
      footer.className = 'offer-footer';

      const priceEl = document.createElement('span');
      priceEl.className = 'offer-price';
      priceEl.textContent = String(price);
      // El precio tachado "de lista" solo tiene sentido si hay descuento.
      if (price !== offer.cost) {
        priceEl.classList.add('is-discounted');
        const was = document.createElement('span');
        was.className = 'offer-price-was';
        was.textContent = String(offer.cost);
        footer.append(was);
        card.dataset['fullPrice'] = String(offer.cost);
      }

      const buy = document.createElement('button');
      buy.className = 'btn is-small';
      buy.textContent = offer.sold ? t('shop.sold') : t('action.buy');
      buy.disabled = !this.engine.canBuyOffer(offer);
      buy.addEventListener('click', () => this.callbacks.onBuy(offer.id));
      buyButtons.push({ offer, button: buy, card, priceEl });

      footer.append(priceEl, buy);
      card.append(kind, name, desc, footer);

      // Sello de vendida. Se agrega y se saca desde `shopRefresh`, porque una
      // oferta puede venderse con la tienda ya abierta.
      const stamp = document.createElement('span');
      stamp.className = 'offer-sold';
      stamp.textContent = t('shop.sold');
      stamp.hidden = !offer.sold;
      card.appendChild(stamp);
      soldStamps.push(stamp);

      grid.appendChild(card);
    }

    registerRefresh?.(() => {
      for (const entry of buyButtons) {
        // `canBuyOffer` ya sabe de slots de joker y de vouchers ya poseidos: la
        // UI no replica la regla, la pregunta.
        entry.button.disabled = !this.engine.canBuyOffer(entry.offer);
        entry.button.textContent = entry.offer.sold ? t('shop.sold') : t('action.buy');
        entry.card.classList.toggle('is-sold', entry.offer.sold);
      }
      soldStamps.forEach((stamp, i) => {
        stamp.hidden = !offers[i]?.sold;
      });
    });

    return grid;
  }

  /**
   * Pestaña "Vender": los Simbiontes que el jugador lleva encima, con su arte,
   * su rareza y su valor de venta. Vender ya existia por la ficha del HUD, pero
   * estaba escondido: aca es una decision explicita, con la ilustracion grande
   * y el precio a la vista. La confirmacion es en dos toques (igual que la
   * ficha) para que un roce no venda un legendario.
   */
  private buildSellTab(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sell-tab';

    const hint = document.createElement('p');
    hint.className = 'sell-hint';
    hint.textContent = t('shop.sellHint');
    wrap.appendChild(hint);

    const jokers = this.engine.run.jokers;
    if (jokers.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'offer-desc';
      empty.textContent = t('shop.sellEmpty');
      wrap.appendChild(empty);
      return wrap;
    }

    const grid = document.createElement('div');
    grid.className = 'offer-grid is-sell';

    for (const joker of jokers) {
      const value = jokerSellValue(joker);
      const rarity = joker.def.rarity;

      const card = document.createElement('div');
      card.className = `offer is-sell-card is-rarity-${rarity}`;
      card.style.setProperty('--joker-rarity', hexToCss(RARITY_COLOR[rarity]));

      // Misma cara procedural que la ficha del HUD y la oferta de tienda: se
      // arma una oferta sintetica para reusar `offerFaceUrl` y no duplicar el
      // dibujado de la ilustracion.
      const pseudo = {
        id: `sell:${joker.uid}`,
        kind: 'joker' as const,
        refId: joker.def.id,
        nameKey: joker.def.nameKey,
        descKey: joker.def.descKey,
        cost: value,
        art: joker.def.art,
        sold: false,
      };
      const artUrl = offerFaceUrl(pseudo, this.engine, t, {
        card: this.cardArt,
        joker: this.jokerArt,
      });
      if (artUrl) {
        const art = document.createElement('img');
        art.className = 'offer-art';
        art.src = artUrl;
        art.alt = t(joker.def.nameKey);
        art.loading = 'lazy';
        card.appendChild(art);
      } else {
        const spacer = document.createElement('div');
        spacer.className = 'offer-art is-placeholder';
        spacer.setAttribute('aria-hidden', 'true');
        card.appendChild(spacer);
      }

      const kind = document.createElement('div');
      kind.className = 'offer-kind';
      kind.textContent = t(`rarity.${rarity}`);

      const name = document.createElement('div');
      name.className = 'offer-name';
      name.textContent = t(joker.def.nameKey);
      name.style.color = hexToCss(RARITY_COLOR[rarity]);

      const desc = document.createElement('div');
      desc.className = 'offer-desc';
      desc.textContent = t(joker.def.descKey);

      const footer = document.createElement('div');
      footer.className = 'offer-footer';

      const priceEl = document.createElement('span');
      priceEl.className = 'offer-price is-gain';
      priceEl.textContent = `+${value}`;

      const sell = document.createElement('button');
      sell.className = 'btn is-small is-sell';
      sell.dataset['act'] = 'sell-joker-shop';
      sell.textContent = t('shop.sellAction', { value });
      // Confirmacion en dos toques: un roce no puede vender un legendario.
      let armed = false;
      let timer: number | null = null;
      const disarm = (): void => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        armed = false;
        card.classList.remove('is-confirming');
        sell.textContent = t('shop.sellAction', { value });
      };
      sell.addEventListener('click', () => {
        if (armed) {
          disarm();
          const nameText = t(joker.def.nameKey);
          this.callbacks.onSellJoker(joker.uid);
          this.toast(t('shop.sellDone', { name: nameText, value }), 'info');
          // Rehacer la pestaña para que el Simbionte vendido desaparezca ya.
          const body = card.closest('.shop-body');
          if (body) {
            body.innerHTML = '';
            body.appendChild(this.buildSellTab());
          }
          return;
        }
        armed = true;
        card.classList.add('is-confirming');
        sell.textContent = t('shop.sellConfirm', { value });
        timer = window.setTimeout(disarm, 3200);
      });

      footer.append(priceEl, sell);
      card.append(kind, name, desc, footer);
      grid.appendChild(card);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  private showGameOver(reason: 'loss' | 'victory'): void {
    const run = this.engine.run;
    const panel = document.createElement('div');
    panel.className = `panel is-gameover is-${reason}`;

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t(reason === 'victory' ? 'phase.victory' : 'phase.game_over');
    title.style.color = hexToCss(reason === 'victory' ? 0x4fd18b : 0xe05c8a);

    const subtitle = document.createElement('p');
    subtitle.className = 'panel-subtitle';
    subtitle.textContent = `${t('ui.seed')}: ${run.seed}`;

    const grid = document.createElement('div');
    grid.className = 'stat-grid';

    const stats: Array<[string, string | number]> = [
      // Score TOTAL de la run. Es lo primero que el jugador quiere ver al
      // terminar, y antes NO existia: el resumen solo mostraba la mejor mano
      // suelta, que se leia como "el ultimo puntaje".
      [t('result.totalScore'), formatNumber(run.totalScore)],
      [t('result.finalAnte'), run.ante],
      [t('result.blindsCleared'), run.stats.blindsCleared],
      [t('result.handsPlayed'), run.stats.handsPlayed],
      [t('result.bestHand'), formatNumber(run.stats.bestHand)],
      [t('result.cardsDestroyed'), run.stats.cardsDestroyed],
      [t('hud.deck'), run.deck.totalSize],
    ];

    for (const [label, value] of stats) {
      const cell = document.createElement('div');
      cell.className = 'stat-cell';
      const valueEl = document.createElement('div');
      valueEl.className = 'stat-cell-value';
      valueEl.textContent = String(value);
      const labelEl = document.createElement('div');
      labelEl.className = 'stat-cell-label';
      labelEl.textContent = label;
      cell.append(valueEl, labelEl);
      grid.appendChild(cell);
    }

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const lang = document.createElement('button');
    lang.className = 'btn is-ghost';
    lang.textContent = t('ui.language');
    lang.addEventListener('click', () => this.callbacks.onToggleLanguage());

    const restart = document.createElement('button');
    restart.className = 'btn is-play';
    restart.textContent = t('ui.newRun');
    restart.addEventListener('click', () => this.callbacks.onRestart());

    actions.append(lang, restart);
    panel.append(title, subtitle, grid, actions);
    this.openOverlay(panel);
  }

  // ==========================================================================
  // Tooltip, popups y toasts
  // ==========================================================================

  showTooltip(card: CardInstance, x: number, y: number, comboHint?: string): void {
    const def = card.def;
    this.elTooltip.innerHTML = '';

    const name = document.createElement('div');
    name.className = 'tooltip-name';
    name.textContent = t(def.nameKey);
    name.style.color = hexToCss(ELEMENT_COLOR[def.element]);

    // Taxonomia con badges GRANDES: Familia y Elemento son lo que mas se
    // consulta al comparar dos cartas, y como texto plano "Agaricácea ·
    // Esporas · Común" se leia de corrido y costaba encontrar uno de los dos.
    // Cada uno lleva su forma (chip de color con inicial) ademas del color, asi
    // la jerarquia no depende solo del tono.
    const taxonomy = document.createElement('div');
    taxonomy.className = 'tooltip-taxonomy';

    const elementBadge = document.createElement('span');
    elementBadge.className = 'tooltip-badge is-element';
    elementBadge.dataset['badge'] = 'element';
    elementBadge.style.setProperty('--badge-color', hexToCss(ELEMENT_COLOR[def.element]));
    const elementGlyph = document.createElement('span');
    elementGlyph.className = 'tooltip-badge-glyph';
    // La inicial del elemento es un ancla legible cuando no hay icono.
    elementGlyph.textContent = t(`element.${def.element}`).charAt(0).toUpperCase();
    const elementText = document.createElement('span');
    elementText.className = 'tooltip-badge-text';
    elementText.textContent = t(`element.${def.element}`);
    elementBadge.append(elementGlyph, elementText);

    const familyBadge = document.createElement('span');
    familyBadge.className = 'tooltip-badge is-family';
    familyBadge.dataset['badge'] = 'family';
    familyBadge.style.setProperty('--badge-color', hexToCss(ELEMENT_COLOR[def.element]));
    const familyGlyph = document.createElement('span');
    familyGlyph.className = 'tooltip-badge-glyph';
    familyGlyph.textContent = t(`family.${def.family}`).charAt(0).toUpperCase();
    const familyText = document.createElement('span');
    familyText.className = 'tooltip-badge-text';
    familyText.textContent = t(`family.${def.family}`);
    familyBadge.append(familyGlyph, familyText);

    taxonomy.append(elementBadge, familyBadge);

    const rarity = document.createElement('div');
    rarity.className = 'tooltip-rarity';
    rarity.textContent = t(`rarity.${def.rarity}`);

    const desc = document.createElement('div');
    desc.className = 'tooltip-desc';
    desc.textContent = t(def.descKey);

    // Estadisticas en zona FIJA (siempre Sustrato a la izquierda, Esporas a la
    // derecha) para que comparar dos cartas sea un barrido vertical y no una
    // busqueda. El nivel suma al valor base como antes.
    const stats = document.createElement('div');
    stats.className = 'tooltip-stats';

    const substrate = document.createElement('div');
    substrate.className = 'tooltip-stat is-substrate';
    substrate.dataset['tooltipStat'] = 'substrate';
    const sVal = document.createElement('div');
    sVal.className = 'tooltip-stat-value';
    sVal.style.color = hexToCss(0xf2a63b);
    sVal.textContent = `+${def.baseSubstrate + card.bonusSubstrate}`;
    const sLabel = document.createElement('div');
    sLabel.className = 'tooltip-stat-label';
    sLabel.textContent = t('hud.substrate');
    substrate.append(sVal, sLabel);

    const spores = document.createElement('div');
    spores.className = 'tooltip-stat is-spores';
    spores.dataset['tooltipStat'] = 'spores';
    const pVal = document.createElement('div');
    pVal.className = 'tooltip-stat-value';
    pVal.style.color = hexToCss(0x4fd18b);
    pVal.textContent = `×${def.baseSpores + card.bonusSpores}`;
    const pLabel = document.createElement('div');
    pLabel.className = 'tooltip-stat-label';
    pLabel.textContent = t('hud.spores');
    spores.append(pVal, pLabel);

    stats.append(substrate, spores);

    // HABILIDAD: la etiqueta va con FORMA (glifo ✦ + banda propia), no solo con
    // color, para no depender del tono (accesibilidad). El mismo tratamiento que
    // la cara de la carta y la mesa: una sola jerarquia en todo el juego.
    const hasAbility = (def.effects?.length ?? 0) > 0;
    let ability: HTMLElement | null = null;
    if (hasAbility) {
      ability = document.createElement('div');
      ability.className = 'tooltip-ability';
      ability.dataset['act'] = 'tooltip-ability';
      const abilityTag = document.createElement('span');
      abilityTag.className = 'tooltip-ability-tag';
      abilityTag.textContent = `✦ ${t('guide.abilityTag')}`;
      ability.appendChild(abilityTag);
      const abilityBody = document.createElement('span');
      abilityBody.className = 'tooltip-ability-text';
      abilityBody.textContent = t('guide.abilityHint');
      ability.appendChild(abilityBody);
    }

    this.elTooltip.append(name, taxonomy, rarity, desc, stats);
    if (ability) this.elTooltip.appendChild(ability);

    if (card.statuses.length > 0) {
      const statuses = document.createElement('div');
      statuses.className = 'tooltip-combos';
      statuses.style.color = hexToCss(0xe05c8a);
      statuses.textContent = card.statuses.map((s) => t(`status.${s.type}`)).join(' · ');
      this.elTooltip.appendChild(statuses);
    }

    if (comboHint) {
      const combos = document.createElement('div');
      combos.className = 'tooltip-combos';
      combos.textContent = comboHint;
      this.elTooltip.appendChild(combos);
    }

    // Se mantiene dentro de la pantalla: en landscape el margen es escaso.
    const margin = 14;
    const width = 290;
    const left = x + 18 + width > window.innerWidth ? x - width - 18 : x + 18;
    const top = Math.min(y - 10, window.innerHeight - this.elTooltip.offsetHeight - margin);
    this.elTooltip.style.left = `${Math.max(margin, left)}px`;
    this.elTooltip.style.top = `${Math.max(margin, top)}px`;
    this.elTooltip.classList.add('is-visible');
  }

  hideTooltip(): void {
    this.elTooltip.classList.remove('is-visible');
  }

  /** Numero flotante de puntos. `color` es un hex numerico. */
  /**
   * Un paso del calculo acaba de aparecer en pantalla: se muestra la operacion
   * y el contador sube. Lo llama el RENDER, que es quien escalona los pasos: el
   * contador tiene que ir al ritmo de lo que se VE, no al del motor (que emite
   * todo junto).
   */
  scoreTick(info: {
    index: number;
    text: string;
    color: number;
    sourceKey: string;
    isBonus: boolean;
    negative: boolean;
    x: number;
    y: number;
  }): void {
    const steps = Math.max(1, this.scoreStepCount);
    // El puntaje no se acumula de forma lineal, pero repartirlo entre los pasos
    // da un conteo que se lee bien y que CIERRA exacto en el total real.
    const shown = Math.round((this.scoreHandTotal * (info.index + 1)) / steps);
    // El ULTIMO paso es el que cierra la cuenta: se marca distinto y se queda
    // en pantalla mas tiempo, porque es el numero que el jugador se lleva.
    const isLast = info.index + 1 >= steps;

    this.elTickerOp.textContent = info.text;
    this.elTickerOp.style.color = hexToCss(info.color);
    this.elTickerSource.textContent = t(info.sourceKey);
    this.elTickerTotal.textContent = formatNumber(shown);
    this.elTicker.classList.toggle('is-bonus', info.isBonus);
    this.elTicker.classList.add('is-visible');

    // "Golpe" del numero con GSAP: reemplaza el truco de quitar/poner la clase
    // con un reflow FORZADO en medio (una lectura sincronica de layout por cada
    // paso de puntuacion). Ahora se anima el transform directo.
    anim.tweenOf(this.elTickerTotal, {
      keyframes: isLast
        ? [
            { scale: 1.38, duration: anim.d(0.18), ease: anim.EASE.cssBack },
            { scale: 1, duration: anim.d(0.26), ease: anim.EASE.cssOut },
          ]
        : [
            { scale: 1.16, duration: anim.d(0.11), ease: anim.EASE.cssBack },
            { scale: 1, duration: anim.d(0.11), ease: anim.EASE.cssOut },
          ],
    });
    this.elTicker.classList.toggle('is-final', isLast);

    // Un paso que RESTA se grafica como daño (veneno) y no como ganancia: es la
    // unica forma de que se vea que la mano esta perdiendo puntos, no sumando.
    if (info.negative) this.effect(info.x, info.y, 'poison');
    // Un bonus es un momento, no un numero: estalla.
    if (info.isBonus) this.effect(info.x, info.y, 'burst');

    if (this.tickerTimer !== null) window.clearTimeout(this.tickerTimer);
    this.tickerTimer = window.setTimeout(() => {
      this.elTicker.classList.remove('is-visible');
      this.tickerTimer = null;
    }, isLast ? 2600 : 1500);
  }

  /**
   * Efecto con sprite en una posicion de pantalla. Se autodestruye al terminar
   * la animacion: sin eso el DOM crece sin techo a lo largo de una partida.
   *
   * Los sprites vienen del Super Pixel Effects Gigapack y estan ADAPTADOS al
   * estilo pintado del juego (upscale suave + halo). Ver public/fx/LICENSE.txt.
   */
  effect(x: number, y: number, kind: 'poison' | 'burst'): void {
    const el = document.createElement('div');
    el.className = `fx-sprite fx-${kind}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.elPopups.appendChild(el);
    window.setTimeout(() => el.remove(), kind === 'poison' ? 1700 : 700);
  }

  popup(x: number, y: number, text: string, color: number): void {
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = hexToCss(color);
    this.elPopups.appendChild(el);
    // Autolimpieza: sin esto el DOM crece sin techo a lo largo de una partida.
    window.setTimeout(() => el.remove(), 1200);
  }

  toast(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast${kind === 'info' ? '' : ` is-${kind}`}`;
    el.textContent = message;
    this.elToasts.appendChild(el);
    window.setTimeout(() => el.remove(), 3200);
  }

  /**
   * Aviso no bloqueante: mas grande y mas lento que un toast, porque lo que
   * dice es una OPORTUNIDAD ("tenes la recompensa de hoy") y no una
   * confirmacion. Se autocierra solo: nada en la UI puede quedar esperando un
   * tap para desaparecer.
   */
  showBanner(
    key: string,
    params?: Record<string, unknown>,
    kind: 'info' | 'warn' | 'success' = 'info',
  ): void {
    const el = document.createElement('div');
    el.className = `banner${kind === 'info' ? '' : ` is-${kind}`}`;
    el.textContent = t(key, params);
    this.elBanner.appendChild(el);
    // Sale con animacion: quitarlo de golpe despues de 4 s se lee como un
    // parpadeo. El `remove()` final limpia el nodo igual que en los toasts.
    window.setTimeout(() => {
      el.classList.add('is-leaving');
      window.setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  /** Bloquea la UI mientras el motor resuelve (evita dobles clicks). */
  setBusy(busy: boolean): void {
    for (const button of this.elActions.querySelectorAll('button')) {
      button.disabled = busy || button.disabled;
    }
  }

  snapshotForDebug(): RunSnapshot {
    return this.engine.runSnapshot();
  }

  destroy(): void {
    this.cancelPendingClose();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.root.innerHTML = '';
  }
}

/**
 * Etiqueta de la clase de oferta. `kind` es la clave del motor (`card`,
 * `joker`, `mutation`, `voucher`) y NO se muestra cruda: se traduce, como todo
 * lo demas. Cae al `kind` en mayusculas si alguna clave faltara, para que una
 * oferta nueva se vea aunque nadie le haya escrito el texto todavia.
 */
function offerLabel(kind: ShopOffer['kind']): string {
  const key = `shop.kind.${kind}`;
  const label = t(key);
  return label === key ? kind.toUpperCase() : label;
}

/**
 * Rareza de una oferta (para colorear el nombre en la tienda).
 */
function rarityOfOffer(engine: GameEngine, offer: ShopOffer): keyof typeof RARITY_COLOR {
  const def = engine.registry.tryGetCard(offer.refId);
  if (def) return def.rarity;
  try {
    return engine.registry.getJoker(offer.refId).rarity;
  } catch {
    return 'common';
  }
}
