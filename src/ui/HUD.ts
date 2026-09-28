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
import { createCardCanvas, type CardTextureSpec } from '@render/index';
import type { ProfileSettings } from '@meta/ProfileState';
import { buildMenuPanel } from './MenuScreen';
import { buildSettingsPanel } from './SettingsScreen';
import { buildAboutPanel } from './AboutScreen';
import { buildRewardPanel } from './RewardPanel';
import { buildDeckBuilderPanel, type DeckCardInfo } from './DeckBuilderScreen';
import { buildCollectionPanel, type CollectionEntry } from './CollectionScreen';
import { BoardScreen, type BoardResolvers, type BoardScreenCallbacks } from './BoardScreen';

export interface HudCallbacks {
  onPlay: () => void;
  onDiscard: () => void;
  onClear: () => void;
  onBuy: (offerId: string) => void;
  onReroll: () => void;
  onSellJoker: (uid: string) => void;
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
  // --- Fase 2: recompensa y deckbuilding ---
  /** `null` = saltar el draft. */
  onPickReward: (offerId: string | null) => void;
  onPurge: (uid: string) => void;
  onUpgrade: (uid: string) => void;
  onEvolve: (uid: string) => void;
  onOpenDeck: () => void;
  // --- Fase 5: duelo micelial (hot-seat) ---
  onOpenBoard: () => void;
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

export class HUD {
  private readonly engine: GameEngine;
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLElement;
  /** Ilustracion real de una carta. Ver la nota del constructor. */
  private readonly cardArt?: (def: CardDefinition) => HTMLImageElement | undefined;
  /** Ilustracion real de un joker. Ver la nota del constructor. */
  private readonly jokerArt?: (def: JokerDefinition) => HTMLImageElement | undefined;
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
  private elMoney = document.createElement('span');
  private elBlind = document.createElement('div');
  private elCounters = document.createElement('div');
  private elJokers = document.createElement('div');
  private elActions = document.createElement('div');
  private elOverlay = document.createElement('div');
  private elTooltip = document.createElement('div');
  private elPopups = document.createElement('div');
  private elToasts = document.createElement('div');
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

  private readonly unsubscribes: Array<() => void> = [];
  private lastStatus: string | null = null;
  /** Info del guardado disponible, para ofrecer "Continuar" al arrancar. */
  private continueLabel: string | null = null;
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
  }) {
    this.engine = options.engine;
    this.root = options.root;
    this.callbacks = options.callbacks;
    this.cardArt = options.cardArt;
    this.jokerArt = options.jokerArt;
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
    anteBlock.className = 'hud-block';
    const anteLabel = document.createElement('div');
    anteLabel.className = 'hud-label';
    anteLabel.textContent = t('hud.ante');
    this.elAnte.className = 'hud-value';
    anteBlock.append(anteLabel, this.elAnte);

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
      }),

      bus.on('score:hand', ({ total }) => {
        this.scoreHandTotal = total;
        this.elTickerTotal.textContent = '0';
      }),

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

      bus.on('round:win', ({ reward }) => {
        this.toast(`${t('result.blindCleared')} +${reward}`, 'info');
      }),

      bus.on('round:loss', () => {
        this.toast(t('result.blindFailed'), 'error');
      }),

      bus.on('log', ({ level, key, params }) => {
        this.toast(t(key, params), level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info');
      }),

      bus.on('i18n:changed', () => {
        this.build();
        this.render();
      }),
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

  private renderCounters(): void {
    const round = this.engine.round;
    const run = this.engine.run;
    this.elCounters.innerHTML = '';
    if (!round) return;

    const entries: Array<[string, string | number, string]> = [
      [t('hud.hands'), round.handsLeft, round.handsLeft <= 1 ? 'is-empty' : ''],
      [t('hud.discards'), round.discardsLeft, round.discardsLeft === 0 ? 'is-empty' : ''],
      [t('hud.deck'), run.deck.remaining, ''],
      [t('hud.jokers'), `${run.jokers.length}/${run.jokerSlots}`, ''],
    ];

    for (const [label, value, extra] of entries) {
      const cell = document.createElement('div');
      cell.className = 'counter';
      const valueEl = document.createElement('div');
      valueEl.className = `counter-value ${extra}`.trim();
      valueEl.textContent = String(value);
      const labelEl = document.createElement('div');
      labelEl.className = 'hud-label';
      labelEl.textContent = label;
      cell.append(valueEl, labelEl);
      this.elCounters.appendChild(cell);
    }
  }

  private renderJokers(): void {
    const run = this.engine.run;
    this.elJokers.innerHTML = '';
    if (!run) return;

    for (const joker of run.jokers) {
      const chip = document.createElement('div');
      chip.className = 'joker-chip';
      chip.title = `${t(joker.def.nameKey)} — ${t(joker.def.descKey)}`;

      const name = document.createElement('span');
      name.className = 'joker-chip-name';
      name.textContent = t(joker.def.nameKey);

      const fires = document.createElement('span');
      fires.className = 'joker-chip-fires';
      fires.textContent = `x${joker.firedCount}`;

      chip.append(name, fires);
      chip.addEventListener('click', () => this.callbacks.onSellJoker(joker.uid));
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
    this.lastStatus = status;

    switch (status) {
      case 'menu':
        this.showMenu();
        break;
      case 'blind_select':
        this.showBlindSelect();
        break;
      case 'reward':
        this.showReward();
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

  private openOverlay(content: HTMLElement): void {
    this.cancelPendingClose();
    // El panel anterior deja de existir: su refresco tambien. `showShop` vuelve
    // a asignarlo justo despues de llamar aca.
    this.shopRefresh = null;
    this.elOverlay.innerHTML = '';
    this.elOverlay.appendChild(content);
    // Si ya estaba abierto, quitar y volver a poner `is-open` en el mismo
    // frame no reinicia la animacion: hay que forzar un reflow entre medias.
    this.elOverlay.classList.remove('is-open', 'is-closing');
    void this.elOverlay.offsetWidth;
    this.elOverlay.classList.add('is-open');
  }

  /**
   * Cierra CON animacion. El contenido no se borra hasta `animationend`,
   * porque si lo borramos antes el panel desaparece de golpe y la salida no
   * se ve. `pointer-events` durante la salida lo apaga el CSS.
   */
  hideOverlay(): void {
    if (this.elOverlay.classList.contains('is-closing')) return; // ya cerrando
    if (!this.elOverlay.classList.contains('is-open')) {
      this.elOverlay.innerHTML = '';
      return;
    }

    this.cancelPendingClose();
    this.elOverlay.classList.remove('is-open');
    this.elOverlay.classList.add('is-closing');

    const seq = ++this.closeSeq;
    const finish = (): void => {
      // Un `openOverlay()` posterior ya reprogramo esto: no pisar su contenido.
      if (seq !== this.closeSeq) return;
      this.closeTimer = null;
      this.elOverlay.classList.remove('is-closing');
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
  showPanel(content: HTMLElement): void {
    this.openOverlay(content);
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
      },
    );
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
  showDeckBuilder(highlightUid?: string): void {
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

    this.showPanel(
      buildDeckBuilderPanel(
        {
          cards,
          money: this.engine.run.money,
          purgeCost: this.engine.purgeCost,
          canEdit: this.engine.canEditDeck(),
          info,
          ...(highlightUid ? { highlightUid } : {}),
          ...(this.cardArt ? { cardArt: this.cardArt } : {}),
        },
        {
          onPurge: (uid) => this.callbacks.onPurge(uid),
          onUpgrade: (uid) => this.callbacks.onUpgrade(uid),
          onEvolve: (uid) => this.callbacks.onEvolve(uid),
          onClose: () => {
            this.lastStatus = null;
            this.render();
          },
        },
      ),
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
      const card = document.createElement('div');
      card.className = `blind-card${index === run.blindIndex ? ' is-current' : ''}`;

      const name = document.createElement('div');
      name.className = 'blind-name';
      name.textContent = t(blind.nameKey);

      const desc = document.createElement('div');
      desc.className = 'blind-desc';
      desc.textContent = t(blind.descKey);

      const targetEl = document.createElement('div');
      targetEl.className = 'blind-target';
      targetEl.textContent = `${t('hud.target')}: ${formatNumber(target)}`;

      card.append(name, desc, targetEl);
      card.addEventListener('click', () => this.callbacks.onChooseBlind(blind.id));
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

    panel.append(title, subtitle, grid, actions);
    this.openOverlay(panel);
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
    const buyButtons: { offer: ShopOffer; button: HTMLButtonElement; card: HTMLElement }[] = [];

    for (const offer of offers) {
      const affordable = this.engine.run.money >= offer.cost;
      const card = document.createElement('div');
      card.className = `offer${offer.sold ? ' is-sold' : ''}`;

      // Miniatura de la carta: misma cara procedural que la carta real.
      const artUrl = offerArtUrl(offer, this.engine, this.cardArt, this.jokerArt);
      if (artUrl) {
        const art = document.createElement('img');
        art.className = 'offer-art';
        art.src = artUrl;
        art.alt = t(offer.nameKey);
        art.loading = 'lazy';
        card.appendChild(art);
      }

      const kind = document.createElement('div');
      kind.className = 'offer-kind';
      kind.textContent = offer.kind.toUpperCase();

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

      const price = document.createElement('span');
      price.className = 'offer-price';
      price.textContent = String(offer.cost);

      const buy = document.createElement('button');
      buy.className = 'btn is-small';
      buy.textContent = offer.sold ? t('shop.sold') : t('action.buy');
      buy.disabled = offer.sold || !affordable;
      buy.addEventListener('click', () => this.callbacks.onBuy(offer.id));
      buyButtons.push({ offer, button: buy, card });

      footer.append(price, buy);
      card.append(kind, name, desc, footer);
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
    const cost = 5 + (this.engine.run.shop?.rerolls ?? 0);
    reroll.textContent = t('shop.rerollCost', { cost });
    reroll.disabled = this.engine.run.money < cost;
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
        entry.button.disabled = entry.offer.sold || money < entry.offer.cost;
        entry.button.textContent = entry.offer.sold ? t('shop.sold') : t('action.buy');
        entry.card.classList.toggle('is-sold', entry.offer.sold);
      }
      reroll.disabled = money < cost;
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
  }): void {
    const steps = Math.max(1, this.scoreStepCount);
    // El puntaje no se acumula de forma lineal, pero repartirlo entre los pasos
    // da un conteo que se lee bien y que CIERRA exacto en el total real.
    const shown = Math.round((this.scoreHandTotal * (info.index + 1)) / steps);

    this.elTickerOp.textContent = info.text;
    this.elTickerOp.style.color = hexToCss(info.color);
    this.elTickerSource.textContent = t(info.sourceKey);
    this.elTickerTotal.textContent = formatNumber(shown);
    this.elTicker.classList.toggle('is-bonus', info.isBonus);
    this.elTicker.classList.add('is-visible');

    // Reinicia el "golpe" del numero: quitar y volver a poner la clase en el
    // mismo frame no reinicia la animacion, hay que forzar un reflow en medio.
    this.elTickerTotal.classList.remove('is-bump');
    void this.elTickerTotal.offsetWidth;
    this.elTickerTotal.classList.add('is-bump');

    if (this.tickerTimer !== null) window.clearTimeout(this.tickerTimer);
    this.tickerTimer = window.setTimeout(() => {
      this.elTicker.classList.remove('is-visible');
      this.tickerTimer = null;
    }, 1400);
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

/** Rareza de una oferta (para colorear el nombre en la tienda). */
function rarityOfOffer(engine: GameEngine, offer: ShopOffer): keyof typeof RARITY_COLOR {
  const def = engine.registry.tryGetCard(offer.refId);
  if (def) return def.rarity;
  try {
    return engine.registry.getJoker(offer.refId).rarity;
  } catch {
    return 'common';
  }
}

/**
 * Cara de la carta en la tienda: `createCardCanvas` con el `ArtSpec` de la
 * carta, MAS la ilustracion real si el render la tiene. Con la imagen, el
 * canvas sale igual que la carta en la mano; sin ella cae a la silueta
 * procedural. Voucher no tiene carta, asi que devuelve `null`.
 */
function offerArtUrl(
  offer: ShopOffer,
  engine: GameEngine,
  cardArt?: (def: CardDefinition) => HTMLImageElement | undefined,
  jokerArt?: (def: JokerDefinition) => HTMLImageElement | undefined,
): string | null {
  let spec: CardTextureSpec | null = null;
  // Ilustracion real, si la hay. `createCardCanvas` la usa como fondo a sangre
  // y dibuja encima el nombre y los chips: o sea, la cara REAL de la carta.
  // Sin esto la tienda dibujaba una silueta procedural, distinta de la que el
  // jugador tiene en la mano.
  let realArt: HTMLImageElement | undefined;
  try {
    if (offer.kind === 'card') {
      const def = engine.registry.tryGetCard(offer.refId);
      if (!def) return null;
      realArt = cardArt?.(def);
      spec = {
        kind: 'card',
        name: t(offer.nameKey),
        desc: t(offer.descKey),
        element: def.element,
        family: def.family,
        rarity: def.rarity,
        art: def.art,
        substrate: def.baseSubstrate,
        spores: def.baseSpores,
      };
    } else if (offer.kind === 'joker' || offer.kind === 'mutation') {
      const def = engine.registry.tryGetJoker(offer.refId);
      if (!def) return null;
      realArt = jokerArt?.(def);
      spec = {
        kind: offer.kind === 'mutation' ? 'mutation' : 'joker',
        name: t(offer.nameKey),
        desc: t(offer.descKey),
        element: 'neutral',
        family: 'agaricaceae',
        rarity: def.rarity,
        art: def.art,
        cost: def.cost,
      };
    }
  } catch {
    return null;
  }
  if (!spec) return null;
  try {
    const canvas = createCardCanvas(spec, realArt);
    try {
      return canvas.toDataURL('image/webp', 0.85);
    } catch {
      // Algun entorno no codifica webp en canvas: caer a png para no perder
      // la miniatura.
      return canvas.toDataURL('image/png');
    }
  } catch {
    return null;
  }
}
