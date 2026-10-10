/**
 * Tutorial.ts — El GUION del tutorial optativo (puro).
 *
 * QUE ES. Una lista ordenada de pasos que explica FungiFlush jugando. Se divide
 * en DOS CAPITULOS, cada uno una run normal:
 *
 *   - `classic`: un Ante completo con el MAZO CLASICO (desafio 1 -> 2 -> Jefe).
 *     Enseña lo esencial (elegir, jugar, descarte, tienda) y la LOGICA que el
 *     jugador no ve: sustrato x esporas, los DOS EJES (elemento=esporas,
 *     familia=sustrato), el PREMIO DE CRUZAR EJES (penalizacion de solapamiento),
 *     diversidad, orden y arquetipos.
 *   - `advanced`: un bloque corto con un MAZO DE ARQUETIPO (Podredumbre) para
 *     demostrar EN VIVO el motor de podredumbre->cosecha, el re-disparo por
 *     posicion y los simbiontes. Son cartas que el mazo clasico NO tiene, por eso
 *     viven en su propio capitulo.
 *
 * QUE NO ES. Este modulo NO conoce el DOM, ni el motor, ni el HUD. No juega: no
 * toca `RunState`, no emite eventos, no decide puntajes. Solo dice "estando en
 * tal estado y con tal historial, el paso que corresponde es este". Eso lo hace
 * testeable en Node sin mocks y deja al motor ignorante de que hay un tutorial
 * (el tutorial es una RUN NORMAL: misma semilla, mismas reglas, mismo balance).
 *
 * POR QUE UN MODULO Y NO UN `if` en el HUD. El guion tiene veinticinco pasos que
 * dependen del estado del juego (`GameStatus`), del ciego, del capitulo y de lo
 * que el jugador ya hizo. Repartir esa logica entre listeners del `bus` es como
 * se llega a un tutorial que se traba. Aca la secuencia es una funcion: dado el
 * estado, cual es el paso siguiente.
 */

import type { GameStatus } from '@engine/state/RunState';

/** Los dos capitulos del tutorial. */
export type TutorialChapter = 'classic' | 'advanced';

/** Identificadores de cada paso. Estables: viajan al perfil y a los tests. */
export type TutorialStepId =
  // --- Capitulo A: mazo clasico (esencial + logica) ---
  | 'blind_select'
  | 'hand_dealt'
  | 'select_cards'
  | 'combo_hint'
  | 'element_family'
  | 'discard'
  | 'fungi_flush'
  | 'play_hand'
  | 'score_breakdown'
  | 'substrate_spores'
  | 'overlap_axes'
  | 'reward_draft'
  | 'shop_intro'
  | 'archetype_bias'
  | 'purge_intro'
  | 'upgrade_intro'
  | 'diversity_bonus'
  | 'order_bonus'
  | 'boss_intro'
  | 'ante_complete'
  // --- Capitulo B: mazo de arquetipo (demos en vivo) ---
  | 'chapter_b_intro'
  | 'decay_harvest'
  | 'retrigger_position'
  | 'joker_demo'
  | 'chapter_b_complete';

export interface TutorialStep {
  id: TutorialStepId;
  /** Capitulo en el que vive el paso. El escaneo filtra por el capitulo activo. */
  chapter: TutorialChapter;
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
  /** Capitulo activo. Los pasos de otro capitulo no se muestran. */
  chapter: TutorialChapter;
  /** Ciego actual dentro del ante (0, 1, 2). El 2 es el Jefe. */
  blindIndex: number;
  /** Numero de ante (1-based). */
  ante: number;
  /** Cartas que el jugador ya selecciono en la mano. */
  selectedCount: number;
  /** Cuantas manos jugo en este ciego. */
  handsPlayed: number;
  /**
   * Combo que la mano ACTUAL (todavia sin jugar) puede formar. Es lo que hace
   * que `combo_hint` aparezca ANTES de jugar: el aviso no depende de una mano ya
   * cerrada (que llegaba tarde y ademas nunca se disparaba por un bug de campo).
   */
  handComboKind: 'family' | 'element' | 'diversity' | null;
  /** El ultimo combo de la mano que se cerro, si hubo. */
  lastComboKind: 'family' | 'element' | 'diversity' | null;
  /** La ultima mano jugada penalizo la familia por solapamiento de ejes. */
  lastOverlap: boolean;
  /** Bonus de orden de la ultima mano jugada, si hubo. */
  lastOrder: 'ladder' | 'crown' | null;
  /** El jugador ya abrio la tienda de este ciego al menos una vez. */
  visitedShop: boolean;
  /** El jugador ya intento una purga (aunque no la confirmara). */
  sawPurge: boolean;
}

/** El paso inicial del guion. */
export const TUTORIAL_FIRST_STEP: TutorialStepId = 'blind_select';

/**
 * Arquetipo del capitulo avanzado. El mazo Podredumbre trae el motor
 * decay->cosecha y el re-disparo (`psilocybe_azurea`) que el clasico no tiene.
 */
export const TUTORIAL_ADVANCED_ARCHETYPE = 'decay';

/**
 * Semilla FIJA del tutorial. El guion asume que la mano que ve el jugador es
 * estable; con la semilla de la partida cambiaria en cada intento y los pasos
 * que citan cartas concretas mentirian. `0xF00D` no significa nada: es solo un
 * valor fijo y reconocible.
 *
 * Con el mazo clasico actual (elemento<->familia ya NO 1:1) esta semilla abre
 * una mano con 3 Putrefacciones poliporaceas y 3 Esporas agaricaceas: jugar las
 * tres putrefacciones dispara Floracion (elemento) + Colonia (familia) CON
 * solapamiento, que es justo lo que el paso `overlap_axes` necesita demostrar.
 */
export const TUTORIAL_SEED = 0xf00d;

/**
 * El guion, en orden. El ORDEN del array es el orden del tutorial: `stepAfter`
 * lo recorre desde el paso actual hacia adelante y devuelve el primero que
 * cumpla capitulo, fase y `require`.
 *
 * Los `anchor` son selectores de la UI REAL. Si un selector deja de existir, el
 * paso cae a tarjeta centrada (el HUD no resalta nada): un ancla rota degrada,
 * no rompe.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  // ==========================================================================
  // CAPITULO A — mazo clasico
  // ==========================================================================
  {
    id: 'blind_select',
    chapter: 'classic',
    phase: 'blind_select',
    anchor: '[data-act="blind-start"]',
    titleKey: 'tutorial.blindSelect.title',
    bodyKey: 'tutorial.blindSelect.body',
    advanceOn: 'tap',
  },
  {
    id: 'hand_dealt',
    chapter: 'classic',
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
    chapter: 'classic',
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
    chapter: 'classic',
    phase: 'playing',
    anchor: '[data-act="select-hint"], [data-act="deck"]',
    titleKey: 'tutorial.comboHint.title',
    bodyKey: 'tutorial.comboHint.body',
    advanceOn: 'tap',
    // Se muestra si la mano ACTUAL puede formar un combo. La semilla fija lo
    // hace probable, no seguro; si no salio, se saltea.
    require: (ctx) => ctx.handComboKind !== null,
  },
  {
    id: 'element_family',
    chapter: 'classic',
    phase: 'playing',
    anchor: '[data-act="select-hint"], [data-act="deck"]',
    titleKey: 'tutorial.elementFamily.title',
    bodyKey: 'tutorial.elementFamily.body',
    advanceOn: 'tap',
  },
  {
    id: 'discard',
    chapter: 'classic',
    phase: 'playing',
    // La pila de DESCARTE vive en WebGL (es una drop zone, no DOM), asi que no
    // hay selector propio. El ancla es la GUIA flotante sobre la mano, que es
    // donde el jugador tiene que empezar: seleccionar antes de descartar.
    anchor: '[data-act="select-hint"]',
    titleKey: 'tutorial.discard.title',
    // Reusa `guide.tutorialDiscard`: es EXACTAMENTE la explicacion del descarte
    // (estaba definida en ES/EN y sin usar en ningun sitio) y asi no se duplica
    // el texto en dos claves.
    bodyKey: 'guide.tutorialDiscard',
    advanceOn: 'tap',
    // Solo en la PRIMERA mano: es un gesto que se explica una vez.
    require: (ctx) => ctx.handsPlayed === 0,
  },
  {
    id: 'fungi_flush',
    chapter: 'classic',
    phase: 'playing',
    // El boton de la habilidad SI es DOM: se resalta el boton real del HUD.
    anchor: '[data-act="use-fungi-flush"]',
    titleKey: 'tutorial.fungiFlush.title',
    bodyKey: 'tutorial.fungiFlush.body',
    advanceOn: 'tap',
    // Solo en la primera mano. La habilidad no se puede DISPARAR todavia (hace
    // falta llegar a 3/3), asi que el paso explica y se cierra con "Siguiente";
    // nunca pide una accion que el jugador no pueda hacer.
    require: (ctx) => ctx.handsPlayed === 0,
  },
  {
    id: 'play_hand',
    chapter: 'classic',
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
    chapter: 'classic',
    phase: 'reward',
    anchor: '[data-act="breakdown"]',
    titleKey: 'tutorial.scoreBreakdown.title',
    bodyKey: 'tutorial.scoreBreakdown.body',
    advanceOn: 'tap',
  },
  {
    id: 'substrate_spores',
    chapter: 'classic',
    phase: 'reward',
    anchor: '[data-act="breakdown"]',
    titleKey: 'tutorial.substrateSpores.title',
    bodyKey: 'tutorial.substrateSpores.body',
    advanceOn: 'tap',
  },
  {
    id: 'overlap_axes',
    chapter: 'classic',
    phase: 'reward',
    anchor: '[data-act="breakdown"]',
    titleKey: 'tutorial.overlapAxes.title',
    bodyKey: 'tutorial.overlapAxes.body',
    advanceOn: 'tap',
    // La joya del tutorial: solo aparece si la mano jugada pago el solapamiento
    // (Colonia reducida a la mitad por usar las mismas cartas que la Floracion).
    require: (ctx) => ctx.lastOverlap,
  },
  {
    id: 'reward_draft',
    chapter: 'classic',
    phase: 'reward',
    anchor: '.panel.is-reward .offer, [data-act="offer"]',
    titleKey: 'tutorial.rewardDraft.title',
    bodyKey: 'tutorial.rewardDraft.body',
    advanceOn: 'tap',
  },
  {
    id: 'shop_intro',
    chapter: 'classic',
    phase: 'shop',
    anchor: '.panel.is-shop .offer, [data-act="offer"]',
    titleKey: 'tutorial.shopIntro.title',
    bodyKey: 'tutorial.shopIntro.body',
    advanceOn: 'tap',
    require: (ctx) => !ctx.visitedShop,
  },
  {
    id: 'archetype_bias',
    chapter: 'classic',
    phase: 'shop',
    anchor: '.panel.is-shop .offer, [data-act="offer"]',
    titleKey: 'tutorial.archetypeBias.title',
    bodyKey: 'tutorial.archetypeBias.body',
    advanceOn: 'tap',
  },
  {
    id: 'purge_intro',
    chapter: 'classic',
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
    chapter: 'classic',
    phase: 'shop',
    // Las mejoras permanentes de la tienda son las MUTACIONES (`kind` real del
    // motor: card | joker | mutation | voucher).
    anchor: '[data-act="offer"][data-kind="mutation"], [data-act="offer"]',
    titleKey: 'tutorial.upgradeIntro.title',
    bodyKey: 'tutorial.upgradeIntro.body',
    advanceOn: 'tap',
  },
  {
    id: 'diversity_bonus',
    chapter: 'classic',
    phase: 'shop',
    anchor: '[data-act="offer"]',
    titleKey: 'tutorial.diversityBonus.title',
    bodyKey: 'tutorial.diversityBonus.body',
    advanceOn: 'tap',
  },
  {
    id: 'order_bonus',
    chapter: 'classic',
    phase: 'shop',
    anchor: '[data-act="offer"]',
    titleKey: 'tutorial.orderBonus.title',
    bodyKey: 'tutorial.orderBonus.body',
    advanceOn: 'tap',
  },
  {
    id: 'boss_intro',
    chapter: 'classic',
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
    chapter: 'classic',
    phase: 'reward',
    anchor: '',
    titleKey: 'tutorial.anteComplete.title',
    bodyKey: 'tutorial.anteComplete.body',
    advanceOn: 'tap',
  },

  // ==========================================================================
  // CAPITULO B — mazo de arquetipo (Podredumbre): demos en vivo
  // ==========================================================================
  {
    id: 'chapter_b_intro',
    chapter: 'advanced',
    phase: 'blind_select',
    anchor: '[data-act="blind-start"]',
    titleKey: 'tutorial.chapterBIntro.title',
    bodyKey: 'tutorial.chapterBIntro.body',
    advanceOn: 'tap',
  },
  {
    id: 'decay_harvest',
    chapter: 'advanced',
    phase: 'playing',
    anchor: '[data-act="select-hint"], [data-act="deck"]',
    titleKey: 'tutorial.decayHarvest.title',
    bodyKey: 'tutorial.decayHarvest.body',
    advanceOn: 'tap',
  },
  {
    id: 'retrigger_position',
    chapter: 'advanced',
    phase: 'playing',
    anchor: '[data-act="select-hint"], [data-act="deck"]',
    titleKey: 'tutorial.retriggerPosition.title',
    bodyKey: 'tutorial.retriggerPosition.body',
    advanceOn: 'tap',
  },
  {
    id: 'joker_demo',
    chapter: 'advanced',
    phase: 'shop',
    anchor: '.panel.is-shop .offer, [data-act="offer"]',
    titleKey: 'tutorial.jokerDemo.title',
    bodyKey: 'tutorial.jokerDemo.body',
    advanceOn: 'tap',
  },
  {
    id: 'chapter_b_complete',
    chapter: 'advanced',
    phase: 'shop',
    anchor: '',
    titleKey: 'tutorial.chapterBComplete.title',
    bodyKey: 'tutorial.chapterBComplete.body',
    advanceOn: 'tap',
  },
];

/** Indice de un paso en el guion, o -1. */
function indexOfStep(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((s) => s.id === id);
}

/** El paso con ese id, o `null` si no existe. */
export function stepById(id: TutorialStepId): TutorialStep | null {
  return TUTORIAL_STEPS.find((s) => s.id === id) ?? null;
}

/**
 * `true` si el paso corresponde al contexto AHORA MISMO: mismo capitulo, misma
 * fase y `require` satisfecho.
 *
 * Es la MISMA condicion que usa `stepAfter` para elegir el siguiente, pero
 * expuesta aparte para que el controlador pueda preguntar "el paso que ya esta
 * en pantalla, sigue valiendo?" SIN avanzar. Eso es lo que hace idempotente al
 * avance: un cambio de estado que no afecta al paso en curso no lo consume.
 */
export function isStepApplicable(step: TutorialStep, ctx: TutorialContext): boolean {
  if (step.chapter !== ctx.chapter) return false;
  if (step.phase !== ctx.status) return false;
  if (step.require && !step.require(ctx)) return false;
  return true;
}

/**
 * El paso siguiente despues de `current`, o `null` si el capitulo termino.
 *
 * REGLA CLAVE: no se puede "saltar hacia atras". Se avanza desde el paso actual
 * recorriendo el guion hacia adelante y se devuelve el primer candidato que
 * aplique (`isStepApplicable`). Los pasos que no aplican se consumen en
 * silencio.
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
    if (!isStepApplicable(step, ctx)) continue;
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

/** `true` si el id es el ultimo paso de SU capitulo (cierra ese capitulo). */
export function isFinalStep(id: TutorialStepId): boolean {
  const step = TUTORIAL_STEPS.find((s) => s.id === id);
  if (!step) return false;
  const last = lastStepOfChapter(step.chapter);
  return last?.id === id;
}

/** Todos los ids, en orden. Util para tests y para el perfil. */
export function allStepIds(): TutorialStepId[] {
  return TUTORIAL_STEPS.map((s) => s.id);
}

/** Los pasos de un capitulo, en orden. */
export function stepsOfChapter(chapter: TutorialChapter): TutorialStep[] {
  return TUTORIAL_STEPS.filter((s) => s.chapter === chapter);
}

/** El ultimo paso de un capitulo, o `null` si el capitulo no tiene pasos. */
export function lastStepOfChapter(chapter: TutorialChapter): TutorialStep | null {
  const steps = stepsOfChapter(chapter);
  return steps[steps.length - 1] ?? null;
}
