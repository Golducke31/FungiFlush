/**
 * BoardScreen.ts — El duelo micelial en hot-seat.
 *
 * POR QUE EN DOM Y NO EN 3D
 * -------------------------
 * El tablero es una grilla de 4x4 con OCHO numeros por carta: es informacion
 * densa y exacta, justo lo que el DOM hace mejor que un canvas (texto nitido,
 * hit-testing gratis, accesible). La mesa 3D sigue detras como escenario, igual
 * que en el resto del juego: el HUD es DOM, la escena es Three.js.
 *
 * INFORMACION OCULTA
 * ------------------
 * Este componente NO conoce `BoardState`: recibe un `BoardView` ya redactado
 * por `viewFor()`. La mano del rival llega como un numero. Es lo que hace
 * honesto al hot-seat hoy y lo que va a servir tal cual cuando el duelo sea
 * online (el servidor manda exactamente este objeto).
 *
 * LA CORTINA
 * ----------
 * Entre turnos aparece una cortina con "pasa el dispositivo". No es adorno: sin
 * ella el jugador que acaba de mover ve la mano del siguiente. La cortina se
 * levanta a mano con un boton, y el turno no empieza hasta que se levanta.
 */

// `BattleStep` y compania son TIPOS: no cuestan nada en runtime. El unico
// valor que hace falta (`ARROW_DIRS`) sale del motor, no del modulo del
// tablero: si el HUD importara `@engine/board`, el chunk diferido del duelo
// dejaria de ser diferido.
import type { BattleStep, BoardCardView, BoardView, PlayerIndex } from '@engine/board';
import { ARROW_DIRS } from '@engine/index';
import { t } from '@i18n/index';
import { hexToCss } from '@render/palette';

export interface BoardResolvers {
  /** Nombre legible de una carta a partir de su `defId`. */
  nameOf: (defId: string) => string;
  /** Color del elemento de la carta (hex numerico). */
  colorOf: (defId: string) => number;
}

export interface BoardScreenCallbacks {
  onPlace: (cell: number, uid: string, faceDown: boolean) => void;
  onConcede: () => void;
  onRematch: () => void;
  onClose: () => void;
}

/** Posicion de cada flecha dentro de la grilla 3x3. */
const ARROW_AREA: Record<string, string> = {
  N: '1 / 2',
  NE: '1 / 3',
  E: '2 / 3',
  SE: '3 / 3',
  S: '3 / 2',
  SW: '3 / 1',
  W: '2 / 1',
  NW: '1 / 1',
};

function playerLabel(player: PlayerIndex): string {
  return t('board.player', { n: player + 1 });
}

export class BoardScreen {
  readonly element: HTMLElement;

  private view: BoardView;
  private readonly resolve: BoardResolvers;
  private readonly callbacks: BoardScreenCallbacks;

  /** `curtain` = hay que pasar el dispositivo antes de jugar. */
  private phase: 'curtain' | 'playing' = 'curtain';
  private selectedUid: string | null = null;
  private faceDown = false;
  private lastPlayer: PlayerIndex | null = null;
  /** Celda que se volteo en la ultima resolucion, para el destello. */
  private lastFlip: number | null = null;

  private readonly elBoard = document.createElement('div');
  private readonly elHand = document.createElement('div');
  private readonly elStatus = document.createElement('div');
  private readonly elLog = document.createElement('ol');
  private readonly elCurtain = document.createElement('div');
  private readonly elActions = document.createElement('div');

  constructor(view: BoardView, resolve: BoardResolvers, callbacks: BoardScreenCallbacks) {
    this.view = view;
    this.resolve = resolve;
    this.callbacks = callbacks;

    this.element = document.createElement('div');
    this.element.className = 'panel is-board';
    this.build();
    this.update(view);
  }

  // -------------------------------------------------------------------------
  // Estructura
  // -------------------------------------------------------------------------

  private build(): void {
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = t('board.title');

    const subtitle = document.createElement('p');
    subtitle.className = 'panel-subtitle';
    subtitle.textContent = t('board.hotseat');

    this.elStatus.className = 'board-status';
    this.elBoard.className = 'board-grid';
    this.elHand.className = 'board-hand';
    this.elLog.className = 'board-log';
    // Texto del recuadro vacio. Se pinta con `::before` desde el CSS.
    this.elLog.dataset['empty'] = t('board.logEmpty');
    this.elCurtain.className = 'board-curtain';
    this.elActions.className = 'panel-actions';

    const main = document.createElement('div');
    main.className = 'board-main';
    main.append(this.elBoard, this.elStatus);

    const side = document.createElement('div');
    side.className = 'board-side';
    side.append(this.elLog, this.elHand);

    const body = document.createElement('div');
    body.className = 'board-body';
    body.append(main, side);

    const concede = document.createElement('button');
    concede.className = 'btn is-ghost';
    concede.dataset['act'] = 'concede';
    concede.textContent = t('board.concede');
    concede.addEventListener('click', () => this.callbacks.onConcede());

    const close = document.createElement('button');
    close.className = 'btn';
    close.dataset['act'] = 'close';
    close.textContent = t('board.close');
    close.addEventListener('click', () => this.callbacks.onClose());

    this.elActions.append(concede, close);

    this.element.append(title, subtitle, body, this.elActions, this.elCurtain);
  }

  // -------------------------------------------------------------------------
  // Actualizacion
  // -------------------------------------------------------------------------

  /**
   * Redibuja con una vista nueva. Si el turno cambio, levanta la cortina: el
   * que acaba de mover no puede ver la mano del siguiente.
   */
  update(view: BoardView): void {
    const playerChanged = this.lastPlayer !== view.currentPlayer;
    this.view = view;
    this.lastPlayer = view.currentPlayer;

    if (view.status === 'finished') {
      this.phase = 'playing';
      this.elCurtain.classList.remove('is-open');
      this.selectedUid = null;
    } else if (playerChanged) {
      this.phase = 'curtain';
      this.selectedUid = null;
      this.faceDown = false;
      this.elCurtain.classList.add('is-open');
      // El registro NO se limpia aca: se limpia cuando el siguiente jugador
      // levanta la cortina. Asi el que recibe el dispositivo ve que le
      // acaban de hacer antes de empezar su turno.
    }

    this.renderCurtain();
    this.renderStatus();
    this.renderBoard();
    this.renderHand();
  }

  /** Muestra lo que paso en la ultima colocacion, en orden. */
  logSteps(steps: readonly BattleStep[]): void {
    this.elLog.innerHTML = '';
    for (const step of steps) this.elLog.appendChild(this.buildLogEntry(step));
    this.elLog.scrollTop = this.elLog.scrollHeight;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private renderCurtain(): void {
    this.elCurtain.innerHTML = '';
    if (this.phase !== 'curtain') return;

    const name = document.createElement('div');
    name.className = 'board-curtain-player';
    name.textContent = playerLabel(this.view.currentPlayer);

    const hint = document.createElement('p');
    hint.className = 'board-curtain-hint';
    hint.textContent = t('board.passDevice');

    const ready = document.createElement('button');
    ready.className = 'btn is-play is-large';
    ready.dataset['act'] = 'ready';
    ready.textContent = t('board.ready');
    ready.addEventListener('click', () => {
      this.phase = 'playing';
      this.elCurtain.classList.remove('is-open');
      // Recien aca se limpia el registro: ya se leyo lo que paso en el turno
      // anterior.
      this.elLog.innerHTML = '';
      this.renderHand();
      this.renderStatus();
      this.renderBoard();
    });

    this.elCurtain.append(name, hint, ready);
  }

  private renderStatus(): void {
    const { view } = this;
    this.elStatus.innerHTML = '';

    if (view.status === 'finished') {
      const result = document.createElement('div');
      result.className = 'board-result';
      result.dataset['act'] = 'result';
      result.textContent =
        view.winner === null
          ? t('board.draw')
          : t('board.wins', { player: playerLabel(view.winner) });
      this.elStatus.appendChild(result);

      const rematch = document.createElement('button');
      rematch.className = 'btn is-play';
      rematch.dataset['act'] = 'rematch';
      rematch.textContent = t('board.rematch');
      rematch.addEventListener('click', () => this.callbacks.onRematch());
      this.elStatus.appendChild(rematch);
      return;
    }

    const turn = document.createElement('div');
    turn.className = 'board-turn';
    turn.textContent = playerLabel(view.currentPlayer);

    const hint = document.createElement('div');
    hint.className = 'board-hint';
    if (this.selectedUid === null) {
      hint.textContent = t('board.pickCard');
    } else {
      hint.textContent = t('board.pickCell');
    }

    const counts = document.createElement('div');
    counts.className = 'board-counts';
    const mine = view.cells.filter((c) => c?.owner === view.currentPlayer).length;
    const theirs = view.cells.filter((c) => c && c.owner !== view.currentPlayer).length;
    counts.textContent = t('board.cells', { mine, theirs });

    const rival = document.createElement('div');
    rival.className = 'board-hint';
    rival.textContent = t('board.opponentHand', { count: view.opponentHandSize });

    this.elStatus.append(turn, hint, counts, rival);
  }

  private renderBoard(): void {
    this.elBoard.innerHTML = '';
    for (let index = 0; index < this.view.cells.length; index++) {
      const card = this.view.cells[index] ?? null;
      const cell = document.createElement('button');
      cell.className = 'board-cell';
      cell.dataset['cell'] = String(index);
      cell.dataset['owner'] = card ? String(card.owner) : '';
      if (card) {
        cell.classList.add('is-occupied');
        if (!card.faceUp) cell.classList.add('is-facedown');
        if (this.lastFlip === index) cell.classList.add('is-flipped');
      }
      if (!card && this.selectedUid !== null && this.phase === 'playing') {
        cell.classList.add('is-legal');
      }

      if (card) {
        cell.append(this.buildCardFace(card));
        cell.title = this.resolve.nameOf(card.defId);
      } else {
        const empty = document.createElement('span');
        empty.className = 'board-cell-empty';
        cell.appendChild(empty);
      }

      cell.addEventListener('click', () => this.handleCellClick(index));
      this.elBoard.appendChild(cell);
    }
  }

  private renderHand(): void {
    this.elHand.innerHTML = '';
    // Terminada la partida no hay mano que mostrar ni que ocultar: un rotulo
    // de "mano oculta" al lado del ganador solo confunde.
    if (this.view.status === 'finished') return;

    const visible = this.phase === 'playing' && this.view.status === 'placing';

    const label = document.createElement('div');
    label.className = 'board-hand-label';
    label.textContent = visible
      ? t('board.yourHand')
      : t('board.handHidden', { player: playerLabel(this.view.currentPlayer) });
    this.elHand.appendChild(label);

    if (!visible) return;

    for (const card of this.view.hand) {
      const chip = document.createElement('button');
      chip.className = 'board-hand-card';
      chip.dataset['uid'] = card.uid;
      if (card.uid === this.selectedUid) chip.classList.add('is-selected');
      chip.append(this.buildCardFace(card));
      chip.addEventListener('click', () => this.handleHandClick(card.uid));
      this.elHand.appendChild(chip);
    }

    const toggle = document.createElement('button');
    toggle.className = `btn is-small${this.faceDown ? ' is-play' : ' is-ghost'}`;
    toggle.dataset['act'] = 'facedown';
    toggle.textContent = t('board.faceDown');
    toggle.addEventListener('click', () => {
      this.faceDown = !this.faceDown;
      this.renderHand();
    });
    this.elHand.appendChild(toggle);
  }

  /** La cara de una carta: 8 flechas alrededor del nombre, en una grilla 3x3. */
  private buildCardFace(card: BoardCardView): HTMLElement {
    const face = document.createElement('span');
    face.className = 'board-face';
    face.style.setProperty('--card-color', hexToCss(this.resolve.colorOf(card.defId)));

    for (let dir = 0; dir < ARROW_DIRS.length; dir++) {
      const value = card.arrows[dir] ?? 0;
      if (value <= 0) continue;
      const arrow = document.createElement('span');
      arrow.className = 'board-arrow';
      arrow.dataset['dir'] = ARROW_DIRS[dir];
      arrow.style.gridArea = ARROW_AREA[ARROW_DIRS[dir] ?? 'N'] ?? '1 / 2';
      arrow.textContent = String(value);
      face.appendChild(arrow);
    }

    const name = document.createElement('span');
    name.className = 'board-face-name';
    name.textContent = this.resolve.nameOf(card.defId);
    face.appendChild(name);

    if (!card.faceUp) face.classList.add('is-hidden-face');
    return face;
  }

  private buildLogEntry(step: BattleStep): HTMLElement {
    const item = document.createElement('li');
    item.className = `board-log-step is-${step.kind}`;
    item.dataset['kind'] = step.kind;

    const attacker = this.resolve.nameOf(this.defIdOf(step.attackerUid));
    const defender = step.defenderUid ? this.resolve.nameOf(this.defIdOf(step.defenderUid)) : '';

    switch (step.kind) {
      case 'place':
        item.textContent = t('board.stepPlace', { name: attacker });
        break;
      case 'reveal':
        item.textContent = t('board.stepReveal', { name: defender });
        break;
      case 'flip':
        item.textContent = t('board.stepFlip', {
          attacker,
          defender,
          attack: step.attack,
          defense: step.defense,
        });
        break;
      case 'tie':
        item.textContent = t('board.stepTie', {
          attacker,
          defender,
          attack: step.attack,
          defense: step.defense,
        });
        break;
      default:
        item.textContent = t('board.stepHold', {
          attacker,
          defender,
          attack: step.attack,
          defense: step.defense,
        });
        break;
    }
    return item;
  }

  // -------------------------------------------------------------------------
  // Interaccion
  // -------------------------------------------------------------------------

  private handleHandClick(uid: string): void {
    if (this.phase !== 'playing' || this.view.status !== 'placing') return;
    this.selectedUid = this.selectedUid === uid ? null : uid;
    this.renderHand();
    this.renderStatus();
    this.renderBoard();
  }

  private handleCellClick(index: number): void {
    if (this.phase !== 'playing' || this.view.status !== 'placing') return;
    if (this.view.cells[index]) return;
    if (this.selectedUid === null) return;
    this.callbacks.onPlace(index, this.selectedUid, this.faceDown);
  }

  /** Marca la ultima celda volteada para el destello. */
  markFlips(steps: readonly BattleStep[]): void {
    const flip = [...steps].reverse().find((s) => s.kind === 'flip');
    this.lastFlip = flip ? flip.cell : null;
  }

  /** El `defId` de una carta por uid, mirando el tablero y la propia mano. */
  private defIdOf(uid: string): string {
    for (const card of this.view.cells) if (card?.uid === uid) return card.defId;
    for (const card of this.view.hand) if (card.uid === uid) return card.defId;
    return uid;
  }

  destroy(): void {
    this.element.innerHTML = '';
  }
}
