/**
 * Tutorial.ts — El GUION del tutorial optativo (puro).
 *
 * QUE ES. Una lista ordenada de pasos que explica FungiFlush jugando un Ante
 * completo (desafio 1 -> desafio 2 -> Jefe). Cada paso sabe en que estado del
 * juego se muestra, que elemento resaltar y si avanza solo o espera una accion
 * del jugador.
 *
 * QUE NO ES. Este modulo NO conoce el DOM, ni el motor, ni el HUD. No juega: no
 * toca `RunState`, no emite eventos, no decide puntajes. Solo dice "estando en
 * tal estado y con tal historial, el paso que corresponde es este". Eso lo hace
 * testeable en Node sin mocks y deja al motor ignorante de que hay un tutorial
 * (el tutorial es una RUN NORMAL: misma semilla, mismas reglas, mismo balance).
 *
 * POR QUE UN MODULO Y NO UN `if` EN EL HUD. El guion tiene doce pasos que
 * dependen del estado del juego (`GameStatus`), del ciego y de lo que el jugador
 * ya hizo. Repartir esa logica entre listeners del `bus` es como se llega a un
 * tutorial que se traba. Aca la secuencia es una funcion: dado el estado, cual
 * es el paso siguiente.
 */

import type { GameStatus } from '@engine/state/RunState';

/** Identificadores de cada paso. Estables: viajan al perfil y a los tests. */
export type TutorialStepId =
  | 'blind_select'
  | 'hand_dealt'
  | 'select_cards'
  | 'combo_hint'
  | 'play_hand'
  | 'score_breakdown'
  | 'reward_draft'
  | 'shop_intro'
  | 'purge_intro'
  | 'upgrade_intro'
  | 'boss_intro'
  | 'ante_complete';

export interface TutorialStep {
  id: TutorialStepId;
  /** Estado del juego en el que este paso puede mostrarse. */
  phase: GameStatus;
  /**
   * Selector CSS del elemento a resaltar (spotlight). Cadena vacia = tarjeta
   * centrada sin resaltado (pasos de texto puro).
   */
  anchor: string;
  /** Clave i18n del titulo. */
  titleKey: string;
  /** Clave i18n del cuerpo. */
  bodyKey: string;
  /**
   * `tap` = el jugador pulsa "Siguiente". `player_action` = el paso describe una
   * accion y avanza cuando el jugador la hace (con "Saltar" siempre disponible,
   * o el tutorial se trabaria si la accion no ocurre).
   */
  advanceOn: 'tap' | 'player_action';
  /**
   * Condicion opcional para MOSTRAR el paso. Si devuelve `false`, el paso se
   * SALTA: el guion nunca se traba esperando algo que no paso (p. ej. un combo
   * que la mano sorteada no produce).
   */
  require?: (ctx: TutorialContext) => boolean;
}

/** Lo minimo que un paso necesita saber del juego para decidir. */
export interface TutorialContext {
  status: GameStatus;
  /** Ciego actual dentro del ante (0, 1, 2). El 2 es el Jefe. */
  blindIndex: number;
  /** Numero de ante (1-based). */
  ante: number;
  /** Cartas que el jugador ya selecciono en la mano. */
  selectedCount: number;
  /** Cuantas manos jugo en este ciego. */
  handsPlayed: number;
  /** El ultimo combo detectado en la mano que se cerro, si hubo. */
  lastComboKind: 'family' | 'element' | 'diversity' | null;
  /** El jugador ya abrio la tienda de este ciego al menos una vez. */
  visitedShop: boolean;
  /** El jugador ya intento una purga (aunque no la confirmara). */
  sawPurge: boolean;
}

/** El paso inicial del guion. */
export const TUTORIAL_FIRST_STEP: TutorialStepId = 'blind_select';

/**
 * Semilla FIJA del tutorial. El guion asume que la mano que ve el jugador es
 * estable; con la semilla de la partida cambiaria en cada intento y los pasos
 * que citan cartas concretas mentirian. `0xF00D` no significa nada: es solo un
 * valor fijo y reconocible.
 */
export const TUTORIAL_SEED = 0xf00d;

/**
 * El guion, en orden. El ORDEN del array es el orden del tutorial: `nextStep`
 * lo recorre desde el paso actual hacia adelante y devuelve el primero que
 * cumpla su `require`.
 *
 * Los `anchor` son selectores de la UI REAL. Si un selector deja de existir, el
 * paso cae a tarjeta centrada (el HUD no resalta nada): un ancla rota degrada,
 * no rompe.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'blind_select',
    phase: 'blind_select',
    anchor: '[data-act="blind-start"]',
    titleKey: 'tutorial.blindSelect.title',
    bodyKey: 'tutorial.blindSelect.body',
    advanceOn: 'tap',
  },
  {
    id: 'hand_dealt',
    phase: 'playing',
    // La mano vive en WebGL (no es DOM): el ancla es la GUIA flotante que el
    // HUD pinta justo encima de las cartas y el chip del MAZO.
    anchor: '[data-act="select-hint"], [data-act="deck"]',
    titleKey: 'tutorial.handDealt.title',
    bodyKey: 'tutorial.handDealt.body',
    advanceOn: 'tap',
  },
  {
    id: 'select_cards',
    phase: 'playing',
    anchor: '[data-act="select-hint"], [data-act="deck"]',
    titleKey: 'tutorial.selectCards.title',
    bodyKey: 'tutorial.selectCards.body',
    advanceOn: 'player_action',
    // Este paso solo tiene sentido si el jugador todavia no eligio: si ya tiene
    // cartas seleccionadas, ya entendio el gesto.
    require: (ctx) => ctx.selectedCount === 0,
  },
  {
    id: 'combo_hint',
    phase: 'playing',
    anchor: '',
    titleKey: 'tutorial.comboHint.title',
    bodyKey: 'tutorial.comboHint.body',
    advanceOn: 'tap',
    // OPCIONAL: solo aparece si la mano que se cerro produjo un combo. La
    // semilla fija lo hace probable, no seguro; si no salio, se saltea.
    require: (ctx) => ctx.lastComboKind !== null,
  },
  {
    id: 'play_hand',
    phase: 'playing',
    anchor: '[data-act="play"]',
    titleKey: 'tutorial.playHand.title',
    bodyKey: 'tutorial.playHand.body',
    advanceOn: 'player_action',
    // Si ya jugo una mano, este paso llega tarde: el jugador ya sabe jugar.
    require: (ctx) => ctx.handsPlayed === 0,
  },
  {
    id: 'score_breakdown',
    phase: 'reward',
    anchor: '',
    titleKey: 'tutorial.scoreBreakdown.title',
    bodyKey: 'tutorial.scoreBreakdown.body',
    advanceOn: 'tap',
  },
  {
    id: 'reward_draft',
    phase: 'reward',
    anchor: '.panel.is-reward .offer, [data-act="offer"]',
    titleKey: 'tutorial.rewardDraft.title',
    bodyKey: 'tutorial.rewardDraft.body',
    advanceOn: 'tap',
  },
  {
    id: 'shop_intro',
    phase: 'shop',
    anchor: '.panel.is-shop .offer, [data-act="offer"]',
    titleKey: 'tutorial.shopIntro.title',
    bodyKey: 'tutorial.shopIntro.body',
    advanceOn: 'tap',
    require: (ctx) => !ctx.visitedShop,
  },
  {
    id: 'purge_intro',
    phase: 'shop',
    // No hay boton de purga: se hace ARRASTRANDO una carta al contenedor de
    // descarte dentro del panel de mazo. El ancla es el boton que ABRE el mazo,
    // que es donde el jugador tiene que empezar.
    anchor: '[data-act="deck"]',
    titleKey: 'tutorial.purgeIntro.title',
    bodyKey: 'tutorial.purgeIntro.body',
    advanceOn: 'tap',
    require: (ctx) => !ctx.sawPurge,
  },
  {
    id: 'upgrade_intro',
    phase: 'shop',
    // Las mejoras permanentes de la tienda son las MUTACIONES (`kind` real del
    // motor: card | joker | mutation | voucher).
    anchor: '[data-act="offer"][data-kind="mutation"], [data-act="offer"]',
    titleKey: 'tutorial.upgradeIntro.title',
    bodyKey: 'tutorial.upgradeIntro.body',
    advanceOn: 'tap',
  },
  {
    id: 'boss_intro',
    phase: 'blind_select',
    anchor: '[data-act="blind-start"]',
    titleKey: 'tutorial.bossIntro.title',
    bodyKey: 'tutorial.bossIntro.body',
    advanceOn: 'tap',
    // Solo en el tercer ciego (el Jefe).
    require: (ctx) => ctx.blindIndex === 2,
  },
  {
    id: 'ante_complete',
    phase: 'reward',
    anchor: '',
    titleKey: 'tutorial.anteComplete.title',
    bodyKey: 'tutorial.anteComplete.body',
    advanceOn: 'tap',
  },
];

/** Indice de un paso en el guion, o -1. */
function indexOfStep(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((s) => s.id === id);
}

/**
 * El paso siguiente despues de `current`, o `null` si el tutorial termino.
 *
 * REGLA CLAVE: no se puede "saltar hacia atras". Se avanza desde el paso actual
 * recorriendo el guion hacia adelante y se devuelve el primer candidato cuyo
 * `phase` coincida con el estado del juego y cuyo `require` pase. Los pasos que
 * no aplican se consumen en silencio.
 *
 * `null` como `current` arranca el guion desde el principio.
 */
export function stepAfter(
  current: TutorialStepId | null,
  ctx: TutorialContext,
): TutorialStep | null {
  const from = current === null ? 0 : indexOfStep(current) + 1;
  for (let i = from; i < TUTORIAL_STEPS.length; i += 1) {
    const step = TUTORIAL_STEPS[i];
    if (!step) continue;
    if (step.phase !== ctx.status) continue;
    if (step.require && !step.require(ctx)) continue;
    return step;
  }
  return null;
}

/**
 * El paso que corresponde mostrar AHORA MISMO dado el estado, sin importar el
 * historial. Es lo que usa el controlador al entrar en un estado nuevo: busca
 * desde `after` (el ultimo paso ya visto) para no repetir uno anterior.
 */
export function currentStep(
  after: TutorialStepId | null,
  ctx: TutorialContext,
): TutorialStep | null {
  return stepAfter(after, ctx);
}

/** `true` si el id es el ultimo paso del guion (cierra el tutorial). */
export function isFinalStep(id: TutorialStepId): boolean {
  return TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]?.id === id;
}

/** Todos los ids, en orden. Util para tests y para el perfil. */
export function allStepIds(): TutorialStepId[] {
  return TUTORIAL_STEPS.map((s) => s.id);
}
