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
  type CardDefinition,
  type CardInstance,
  type GameEngine,
  type JokerDefinition,
  type RunSnapshot,
  type ShopOffer,
} from '@engine/index';
import type { BoardView } from '@engine/board';
import { t } from '@i18n/index';
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';
import * as anim from '@render/anim';
import type { ProfileSettings } from '@meta/ProfileState';
import { offerFaceUrl } from './cardArt';
import { buildAscensionPanel, buildMenuPanel } from './MenuScreen';
import { buildCosmeticsPanel, type CosmeticKind, type CosmeticsState } from './CosmeticsScreen';
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

/**
 * Fase de la tirada del dado dentro del panel de ciego.
 *
 *   armed    -> el dado todavia no se tiro: el panel se aparta y queda la
 *               consigna de abajo, porque el cubo se tira sobre la arena.
 *   tumbling -> el cubo esta en el aire. El panel ya volvio, pero el resultado
 *               esta tapado y los ciegos bloqueados.
 *   ready    -> el dado se apoyo: resultado, "volver a tirar" y ciegos.
 */
type DiePhase = 'armed' | 'tumbling' | 'ready';

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
  onChooseBlind: (blindId: string) => void;
  onRestart: () => void;
  onToggleLanguage: () => void;
  onContinueRun: () => void;
  // --- Pantalla de inicio ---
  onStartRun: () => void;
  onOpenCollection: () => void;
  onOpenExpansions: () => void;
  onOpenPass: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
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
  /** Volver a tirar el dado multiplicador (paga dinero). */
  onRerollDie: () => void;
  // --- Fase 5: duelo micelial (hot-seat) ---
  onOpenBoard: () => void;
  // --- R4b: cosméticos (dorso de carta / tapete) ---
  onOpenCosmetics: () => void;
  onEquip: (kind: 'cardback' | 'felt', id: string) => void;
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

  // --- Dado (tirada manual) ---
  /** Elementos del panel de ciego que cambian con la fase del dado. */
  private elBlindPanel: HTMLElement | null = null;
  private elBlindGrid: HTMLElement | null = null;
  private elDieRow: HTMLElement | null = null;
  private elDieHint: HTMLElement | null = null;
  private diePhase: DiePhase = 'ready';
  /** Ultimo valor avisado por `syncArenaCovered`. */
  private arenaCovered = false;
  /**
   * Vencimiento del bloqueo por tirada. Misma red de seguridad que la del
   * puntaje: si el aviso de "el dado se apoyo" no llega, el jugador no puede
   * quedarse mirando un panel bloqueado para siempre.
   */
  private dieDeadline = 0;
  private dieTimer: number | null = null;

  private readonly unsubscribes: Array<() => void> = [];
  private lastStatus: string | null = null;
  /** Info del guardado disponible, para ofrecer "Continuar" al arrancar. */
  private continueLabel: string | null = null;
  /** Ascension (R1): se la empuja el controlador desde el perfil. */
  private ascensionState: { unlocked: number; selected: number; max: number } = {
    unlocked: 0,
    selected: 0,
    max: 0,
  };
  /** Cosméticos (R4b): se los empuja el controlador desde el perfil. */
  private cosmeticsState: CosmeticsState = {
    owned: ['default'],
    equipped: { cardback: 'default', felt: 'default' },
  };
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
    this.elBlind.className = 'hud-blind-name';
    this.elPreview.className = 'hud-preview';
    scoreBlock.append(scoreMain, this.elProgress, this.elBlind, this.elPreview);

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

    rightGroup.append(moneyBlock, langButton);
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

    this.root.append(
      top,
      this.elJokers,
      bottom,
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

      bus.on('score:hand', ({ total }) => {
        this.scoreHandTotal = total;
        this.elTickerTotal.textContent = '0';
      }),

      // El RENDER avisa que el dado se apoyo. Recien ahi se revela el resultado
      // y se desbloquean los ciegos: mostrar la cara al soltar el cubo
      // arruinaria la tirada entera.
      bus.on('die:settled', () => this.settleDie()),

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
      bus.on('shop:reroll', ({ offers }) => this.showShop(offers)),
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
    } else {
      this.elScore.textContent = '0';
      this.elTarget.textContent = '/ 0';
      this.elBlind.textContent = '';
    }

    this.renderCounters();
    this.renderJokers();
    this.renderActions();
    this.renderPreview();
    this.renderOverlay(run.status);
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
    const state: Array<[string, string, string | number, string]> = [
      ['ui_icon_collection', t('hud.deck'), run.deck.remaining, ''],
      ['ui_icon_joker_slot', t('hud.jokers'), run.jokers.length, ''],
    ];

    for (const [icon, label, value, extra] of [...resources, ...state]) {
      const cell = document.createElement('div');
      cell.className = `counter${resources.some((r) => r[0] === icon) ? ' is-resource' : ''}`;
      cell.title = label;

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
      // por la misma linea de base que un numero suelto y se leia peor.
      if (icon === 'ui_icon_joker_slot') {
        const cap = document.createElement('span');
        cap.className = 'counter-cap';
        cap.textContent = `/${run.jokerSlots}`;
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
      chip.className = 'joker-chip';
      chip.title = `${t(joker.def.nameKey)} — ${t(joker.def.descKey)}`;
      // Hook para que la ficha se pueda encontrar por uid cuando el joker
      // dispara (ver la suscripcion a `joker:triggered`).
      chip.dataset['uid'] = joker.uid;

      const name = document.createElement('span');
      name.className = 'joker-chip-name';
      name.textContent = t(joker.def.nameKey);

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

      chip.append(name, fires, sell);
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

    const discard = document.createElement('button');
    discard.className = 'btn is-discard';
    discard.textContent = t('action.discard');
    discard.disabled = selected === 0 || round.discardsLeft <= 0;
    discard.addEventListener('click', () => this.callbacks.onDiscard());

    const play = document.createElement('button');
    play.className = 'btn is-play';
    play.textContent = selected > 0 ? `${t('action.play')} (${selected})` : t('action.play');
    play.disabled = selected === 0 || round.handsLeft <= 0;
    play.addEventListener('click', () => this.callbacks.onPlay());

    this.elActions.append(clear, discard, play);
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
    this.openOverlay(panel);
    // Se queda lo justo para leerse, y despues entra el draft.
    window.setTimeout(() => {
      if (this.engine.run.status !== 'reward') return;
      then();
    }, 1500);
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
    // Las referencias al panel de ciego son del panel que se esta yendo: si
    // quedaran vivas, un `die:settled` tardio escribiria sobre un DOM huerfano.
    this.elBlindPanel = null;
    this.elBlindGrid = null;
    this.elDieRow = null;
    this.clearDieDeadline();
    // `is-throw` lo vuelve a poner `applyDiePhase()` si el panel que entra es el
    // de ciego sin tirada. Sin este reset, abrir Ajustes despues dejaria el
    // overlay sin capturar punteros y el canvas se comeria los clics.
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
    this.syncArenaCovered();
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
      this.syncArenaCovered();
      return;
    }

    this.cancelPendingClose();
    this.clearDieDeadline();
    this.elOverlay.classList.remove('is-open', 'is-throw');
    this.elOverlay.classList.add('is-closing');
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
      },
    );
    this.openOverlay(panel);
  }

  /**
   * Estado de ascension para el menu. Lo llama el controlador cada vez que el
   * perfil cambia (y antes de `showMenu`), porque el HUD no conoce el perfil.
   */
  setAscensionState(state: { unlocked: number; selected: number; max: number }): void {
    this.ascensionState = state;
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
   * Habilita el boton de duelo. Lo llama el controlador despues de leer el
   * contenido, porque el HUD no conoce el registro de packs.
   */
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
  // Fases del dado
  // ==========================================================================

  /**
   * El cubo esta en el aire: el panel vuelve pero con los ciegos bloqueados y
   * el resultado tapado. Lo llama el controlador al soltar el cubo y al volver
   * a tirar.
   */
  beginDieThrow(): void {
    if (this.diePhase === 'tumbling') return;
    this.diePhase = 'tumbling';
    this.applyDiePhase();
    this.armDieDeadline();
  }

  /** El dado se apoya: recien ahora se puede ver el resultado y elegir ciego. */
  private settleDie(): void {
    this.clearDieDeadline();
    if (this.diePhase === 'ready') return;
    this.diePhase = 'ready';
    this.applyDiePhase();
  }

  /**
   * Red de seguridad. Si el aviso del render no llega, el resultado se muestra
   * igual: un panel bloqueado para siempre es peor que un dado que no se anima.
   */
  private armDieDeadline(): void {
    this.clearDieDeadline();
    this.dieDeadline = performance.now() + 12000;
    this.dieTimer = window.setTimeout(() => {
      this.dieTimer = null;
      if (performance.now() < this.dieDeadline) return;
      this.settleDie();
    }, 12000);
  }

  private clearDieDeadline(): void {
    if (this.dieTimer !== null) {
      clearTimeout(this.dieTimer);
      this.dieTimer = null;
    }
  }

  /** Vuelca la fase del dado al DOM sin reconstruir el panel. */
  private applyDiePhase(): void {
    const panel = this.elBlindPanel;
    if (!panel) return;

    // El panel se aparta durante TODA la tirada, no solo antes de soltar el
    // cubo: el dado gira sobre la arena y el panel ocupa media pantalla, asi
    // que si volviera al soltar, la tirada —que es el evento— quedaria tapada.
    // Vuelve cuando el dado se apoya, que es cuando hay algo que decidir.
    const throwing = this.diePhase !== 'ready';
    panel.classList.toggle('is-die-armed', throwing);
    this.elOverlay.classList.toggle('is-throw', throwing);
    if (this.elDieHint) {
      // Con el dado ya apoyado la consigna desaparece con el resto del panel,
      // asi que el texto solo tiene que ser correcto en las dos fases de tirada.
      this.elDieHint.textContent = t(this.diePhase === 'armed' ? 'die.arm' : 'die.tumbling');
    }

    // Red de seguridad: los ciegos no se pueden elegir hasta que el dado se
    // apoye. Elegir antes seria decidir sin saber el multiplicador.
    const locked = throwing;
    if (this.elBlindGrid) this.elBlindGrid.classList.toggle('is-locked', locked);
    for (const card of panel.querySelectorAll('.blind-card')) {
      (card as HTMLElement).setAttribute('aria-disabled', String(locked));
    }

    if (this.elDieRow) this.fillDieRow(this.elDieRow);
    this.syncArenaCovered();
  }

  /** Contenido de la fila del dado segun la fase. */
  private fillDieRow(row: HTMLElement): void {
    row.innerHTML = '';
    const die = this.engine.run.die;

    const info = document.createElement('span');
    info.className = 'die-row-info';

    if (!die) {
      info.textContent = t('die.arm');
      row.appendChild(info);
      return;
    }
    if (this.diePhase !== 'ready') {
      info.textContent = t('die.tumbling');
      info.classList.add('is-tumbling');
      row.appendChild(info);
      return;
    }

    info.textContent = t('die.rolled', { face: die.face, mult: die.multiplier });
    const cost = this.engine.rerollDieCost();
    const again = document.createElement('button');
    again.className = 'btn is-ghost is-small';
    again.textContent = t('die.reroll', { cost });
    again.dataset['act'] = 'reroll-die';
    again.disabled = this.engine.run.money < cost;
    again.addEventListener('click', () => this.callbacks.onRerollDie());
    row.append(info, again);
  }

  private showBlindSelect(): void {
    const run = this.engine.run;
    const panel = document.createElement('div');
    panel.className = 'panel is-blind-select';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t('phase.blind_select');

    const subtitle = document.createElement('p');
    subtitle.className = 'panel-subtitle';
    subtitle.textContent = `${t('hud.ante')} ${run.ante} · ${t('hud.money')} ${formatNumber(run.money)}`;

    const grid = document.createElement('div');
    grid.className = 'blind-grid';

    const blinds = this.engine.availableBlinds();
    blinds.forEach((blind, index) => {
      const target = this.engine.targetFor(blind);
      // Un ciego es JEFE si trae efectos ambientales: es la convencion del
      // contenido (ver blinds.json: solo los `*_boss` declaran `effects`).
      const isBoss = (blind.effects?.length ?? 0) > 0;
      const isCurrent = index === run.blindIndex;

      const card = document.createElement('div');
      card.className = [
        'blind-card',
        isCurrent ? 'is-current' : '',
        isBoss ? 'is-boss' : '',
      ]
        .filter(Boolean)
        .join(' ');
      // Hooks de test/smoke: id, tier y estado del ciego, sin depender del
      // orden DOM.
      card.dataset['act'] = 'blind';
      card.dataset['blind'] = blind.id;
      card.dataset['blindBoss'] = isBoss ? '1' : '0';
      if (blind.tier) card.dataset['blindTier'] = blind.tier;
      if (isCurrent) card.dataset['blindCurrent'] = '1';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      // --- Ilustracion ---
      // Va PRIMERO en el DOM y el CSS la pone de fondo: es el mismo patron que
      // la cara de carta de la tienda, y deja el texto por encima sin capas
      // extra. Sin arte, la tarjeta se queda con su material.
      const art = this.blindArt?.(blind.art);
      if (art?.src) {
        const artImg = document.createElement('img');
        artImg.className = 'blind-art';
        artImg.src = art.src;
        artImg.alt = '';
        artImg.setAttribute('aria-hidden', 'true');
        card.appendChild(artImg);
      }

      // --- Cabecera: nombre + etiqueta de jefe ---
      const head = document.createElement('div');
      head.className = 'blind-head';

      const name = document.createElement('div');
      name.className = 'blind-name';
      name.textContent = t(blind.nameKey);

      head.append(name);
      if (isBoss) {
        const bossTag = document.createElement('span');
        bossTag.className = 'blind-tag is-boss';
        bossTag.textContent = t('blindCard.boss');
        head.append(bossTag);
      }

      const desc = document.createElement('div');
      desc.className = 'blind-desc';
      desc.textContent = t(blind.descKey);

      // --- Metricas: multiplicador y objetivo ---
      const metrics = document.createElement('div');
      metrics.className = 'blind-metrics';

      const mult = document.createElement('div');
      mult.className = 'blind-metric';
      const multValue = document.createElement('div');
      multValue.className = 'blind-metric-value is-mult';
      // `x1` y `x1.5` se leen mejor que `x1.0`: se cae el decimal inutil.
      multValue.textContent = `×${formatMultiplier(blind.scoreMultiplier)}`;
      const multLabel = document.createElement('div');
      multLabel.className = 'blind-metric-label';
      multLabel.textContent = t('blindCard.mult');
      mult.append(multValue, multLabel);

      const tgt = document.createElement('div');
      tgt.className = 'blind-metric';
      const tgtValue = document.createElement('div');
      tgtValue.className = 'blind-metric-value is-target';
      tgtValue.textContent = formatNumber(target);
      const tgtLabel = document.createElement('div');
      tgtLabel.className = 'blind-metric-label';
      tgtLabel.textContent = t('blindCard.target');
      tgt.append(tgtValue, tgtLabel);

      metrics.append(mult, tgt);

      // --- Recompensa ---
      const reward = document.createElement('div');
      reward.className = 'blind-reward';
      const rewardIcon = document.createElement('img');
      rewardIcon.className = 'blind-reward-icon';
      rewardIcon.src = 'ui/fungi.png';
      rewardIcon.alt = '';
      rewardIcon.setAttribute('aria-hidden', 'true');
      const rewardAmount = document.createElement('span');
      rewardAmount.className = 'blind-reward-amount';
      rewardAmount.textContent = `+${formatNumber(blind.reward)}`;
      const rewardLabel = document.createElement('span');
      rewardLabel.textContent = t('blindCard.reward');
      reward.append(rewardIcon, rewardAmount, rewardLabel);

      card.append(head, desc, metrics, reward);

      const choose = (): void => this.callbacks.onChooseBlind(blind.id);
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });

      grid.appendChild(card);
    });

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    if (this.continueLabel) {
      const resume = document.createElement('button');
      resume.className = 'btn';
      resume.textContent = `${t('ui.continue')} — ${this.continueLabel}`;
      resume.addEventListener('click', () => this.callbacks.onContinueRun());
      actions.appendChild(resume);
    }

    const deck = document.createElement('button');
    deck.className = 'btn';
    deck.textContent = `${t('deck.open')} (${run.deck.totalSize})`;
    deck.dataset['act'] = 'deck';
    deck.addEventListener('click', () => this.callbacks.onOpenDeck());

    const newRun = document.createElement('button');
    newRun.className = 'btn is-ghost';
    newRun.textContent = t('ui.newRun');
    newRun.addEventListener('click', () => this.callbacks.onRestart());

    const langBtn = document.createElement('button');
    langBtn.className = 'btn is-ghost';
    langBtn.textContent = t('ui.language');
    langBtn.addEventListener('click', () => this.callbacks.onToggleLanguage());

    actions.append(deck, newRun, langBtn);

    // --- DADO: hay que TIRARLO a mano antes de poder elegir ---
    //
    // Tres fases, y el orden importa:
    //   armed    -> todavia no se tiro. El panel se aparta y queda la consigna.
    //   tumbling -> el cubo esta en el aire. El panel ya volvio, pero los ciegos
    //               estan bloqueados: el resultado no se puede spoilear.
    //   ready    -> el dado se apoyo. Recien aca aparece el resultado, la opcion
    //               de volver a tirar y los ciegos.
    const dieRow = document.createElement('div');
    dieRow.className = 'die-row';

    const hint = document.createElement('p');
    hint.className = 'die-hint';
    hint.textContent = t('die.arm');

    panel.append(title, subtitle, dieRow, grid, actions, hint);
    this.openOverlay(panel);

    // Las referencias se toman DESPUES de `openOverlay`: es quien las limpia
    // (son del panel que se esta yendo). Tomarlas antes dejaba `elBlindPanel` en
    // null y `applyDiePhase()` no hacia nada: el panel se quedaba capturando
    // punteros y el cubo no se podia arrastrar.
    this.elBlindPanel = panel;
    this.elBlindGrid = grid;
    this.elDieRow = dieRow;
    this.elDieHint = hint;
    this.diePhase = run.die ? 'ready' : 'armed';
    this.applyDiePhase();
    // Los ciegos entran en cascada. Es ADITIVO: el panel ya tiene su propia
    // animacion de entrada; esto solo escalona las tarjetas de adentro.
    anim
      .sequence()
      .fromTo(
        grid.querySelectorAll('.blind-card'),
        { y: 18, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: anim.d(0.3),
          ease: anim.EASE.cssOut,
          stagger: { amount: anim.d(0.18) },
        },
      );
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
    subtitle.textContent = `${t('hud.money')}: ${formatNumber(this.engine.run.money)} · ${t('hud.jokers')} ${this.engine.run.jokers.length}/${this.engine.run.jokerSlots}`;

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

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const sellInfo = document.createElement('span');
    sellInfo.className = 'panel-subtitle';
    sellInfo.style.margin = '0';
    sellInfo.textContent = t('action.sell');

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

    actions.append(sellInfo, deck, reroll, leave);
    panel.append(title, subtitle, grid, actions);
    this.openOverlay(panel);

    // Ver la nota de `shopRefresh`. Solo se recalcula lo que depende del
    // dinero: las tarjetas NO se reconstruyen, asi que las ilustraciones ya
    // dibujadas no se vuelven a generar en cada cambio de plata.
    this.shopRefresh = () => {
      const money = this.engine.run.money;
      subtitle.textContent = `${t('hud.money')}: ${formatNumber(money)} · ${t('hud.jokers')} ${this.engine.run.jokers.length}/${this.engine.run.jokerSlots}`;
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
      reroll.disabled = money < this.engine.rerollPrice;
    };
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

    const meta = document.createElement('div');
    meta.className = 'tooltip-meta';
    meta.textContent = `${t(`element.${def.element}`)} · ${t(`family.${def.family}`)} · ${t(`rarity.${def.rarity}`)}`;

    const desc = document.createElement('div');
    desc.className = 'tooltip-desc';
    desc.textContent = t(def.descKey);

    const stats = document.createElement('div');
    stats.className = 'tooltip-stats';

    const substrate = document.createElement('div');
    substrate.className = 'tooltip-stat';
    const sVal = document.createElement('div');
    sVal.className = 'tooltip-stat-value';
    sVal.style.color = hexToCss(0xf2a63b);
    sVal.textContent = String(def.baseSubstrate + card.bonusSubstrate);
    const sLabel = document.createElement('div');
    sLabel.className = 'tooltip-stat-label';
    sLabel.textContent = t('hud.substrate');
    substrate.append(sVal, sLabel);

    const spores = document.createElement('div');
    spores.className = 'tooltip-stat';
    const pVal = document.createElement('div');
    pVal.className = 'tooltip-stat-value';
    pVal.style.color = hexToCss(0x4fd18b);
    pVal.textContent = `x${def.baseSpores + card.bonusSpores}`;
    const pLabel = document.createElement('div');
    pLabel.className = 'tooltip-stat-label';
    pLabel.textContent = t('hud.spores');
    spores.append(pVal, pLabel);

    stats.append(substrate, spores);
    this.elTooltip.append(name, meta, desc, stats);

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
