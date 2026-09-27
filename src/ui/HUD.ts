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

import { bus, type CardInstance, type GameEngine, type RunSnapshot, type ShopOffer } from '@engine/index';
import { t } from '@i18n/index';
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';

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

  private readonly unsubscribes: Array<() => void> = [];
  private lastStatus: string | null = null;
  /** Info del guardado disponible, para ofrecer "Continuar" al arrancar. */
  private continueLabel: string | null = null;

  constructor(options: { engine: GameEngine; root: HTMLElement; callbacks: HudCallbacks }) {
    this.engine = options.engine;
    this.root = options.root;
    this.callbacks = options.callbacks;
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
    moneyBlock.className = 'hud-block';
    const moneyLabel = document.createElement('div');
    moneyLabel.className = 'hud-label';
    moneyLabel.textContent = t('hud.money');
    this.elMoney.className = 'hud-value is-money';
    moneyBlock.append(moneyLabel, this.elMoney);

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

    this.root.append(top, this.elJokers, bottom, this.elPopups, this.elToasts, this.elTooltip, this.elOverlay);
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

      bus.on('money:changed', ({ money, delta }) => {
        this.elMoney.textContent = formatNumber(money);
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
      case 'blind_select':
        this.showBlindSelect();
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
    this.elOverlay.innerHTML = '';
    this.elOverlay.appendChild(content);
    this.elOverlay.classList.add('is-open');
  }

  hideOverlay(): void {
    this.elOverlay.classList.remove('is-open');
    this.elOverlay.innerHTML = '';
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

  private showBlindSelect(): void {
    const run = this.engine.run;
    const panel = document.createElement('div');
    panel.className = 'panel';

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

    const newRun = document.createElement('button');
    newRun.className = 'btn is-ghost';
    newRun.textContent = t('ui.newRun');
    newRun.addEventListener('click', () => this.callbacks.onRestart());

    const langBtn = document.createElement('button');
    langBtn.className = 'btn is-ghost';
    langBtn.textContent = t('ui.language');
    langBtn.addEventListener('click', () => this.callbacks.onToggleLanguage());

    actions.append(newRun, langBtn);

    panel.append(title, subtitle, grid, actions);
    this.openOverlay(panel);
  }

  private showShop(offers: ShopOffer[]): void {
    if (this.engine.run.status !== 'shop') return;

    const panel = document.createElement('div');
    panel.className = 'panel';

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

    for (const offer of offers) {
      const affordable = this.engine.run.money >= offer.cost;
      const card = document.createElement('div');
      card.className = `offer${offer.sold ? ' is-sold' : ''}`;

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

    actions.append(sellInfo, reroll, leave);
    panel.append(title, subtitle, grid, actions);
    this.openOverlay(panel);
  }

  private showGameOver(reason: 'loss' | 'victory'): void {
    const run = this.engine.run;
    const panel = document.createElement('div');
    panel.className = 'panel';

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
