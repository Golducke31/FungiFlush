/**
 * main.ts — Controlador de la aplicacion.
 *
 * Es el unico lugar donde se conocen las capas a la vez. Su trabajo es
 * cablearlas y nada mas:
 *
 *     ContentRegistry  <-- packs de contenido (base + expansiones)
 *     GameEngine       <-- estado y reglas
 *     SceneManager     <-- lee el bus, dibuja
 *     HUD              <-- lee el bus, muestra texto, emite intenciones
 *
 * El controlador traduce "intencion del jugador" a "metodo del motor".
 * No tiene logica de juego ni de dibujo.
 *
 * CAMBIO IMPORTANTE: el juego ya NO arranca una run apenas carga. Arranca en
 * el menu (`engine.enterMenu()`), que es la pantalla de inicio.
 */

import {
  DIE_FACES,
  RNG,
  GameEngine,
  MAX_PLAY_SIZE_DEFAULT,
  bus,
  detectCombos,
  type CardDefinition,
  type CardInstance,
  type ElementType,
  type JokerDefinition,
  type Rarity,
  type RunSaveData,
} from '@engine/index';
import type { BoardState } from '@engine/board';
import { bootstrapContent } from '@content/bootstrap';
import { currentLanguage, initI18n, setLanguage, t, toggleLanguage, validateDictionaryCoverage } from '@i18n/index';
import { ProfileStore } from '@persistence/ProfileStore';
import { RunStore } from '@persistence/RunStore';
import { Storage } from '@persistence/Storage';
import { isTouchOnly } from './pointer';
import { EntitlementStore } from '@meta/EntitlementStore';
import { PackGate } from '@meta/PackGate';
import { HISTORY_CAP } from '@meta/ProfileState';
import { ARCHETYPES, biasFor, starterFor } from '@meta/Archetypes';
import { notifier } from '@notify/notify';
import {
  AchievementTracker,
  parseAchievements,
  type AchievementContext,
  type AchievementDef,
} from '@retention/AchievementTracker';
import { parseMissions, MISSION_EVENTS, type GameEventName } from '@engine/index';
import {
  claimDaily,
  evaluateDaily,
  parseDailyTable,
  type DailyClaim,
  type DailyRewardTable,
} from '@retention/DailyReward';
import { parseSeason, addXp, claimTier } from '@retention/SeasonTracker';
import { UnlockTracker, parseUnlockRules, type UnlockDef } from '@meta/UnlockTracker';
import type { RetentionReward } from '@retention/types';
import dailyRewardsData from '@data/daily-rewards.json';
import achievementsData from '@data/achievements.json';
import missionsData from '@data/missions.json';
import unlockRulesData from '@data/unlock-rules.json';
import seasonsData from '@data/seasons.json';
import {
  ArtAssets,
  CARD_DISPLAY_FONT,
  CARD_TEXT_FONT,
  SceneManager,
  resolveQuality,
} from '@render/index';
import type { QualityTier } from '@render/index';
import { ELEMENT_COLOR } from '@render/palette';
import { HUD } from '@ui/HUD';
import { sortHand, type SortMode } from '@ui/handSort';
import {
  buildCollectionCarousel,
  type CollectionCarouselFrame,
  type CollectionEntry,
  type CollectionState,
} from '@ui/CollectionScreen';
import type { CarouselEntryView } from '@render/CardCarousel';
import {
  buildDeckCarouselFrame,
  sortCards,
  type DeckCarouselFrame,
} from '@ui/DeckBuilderScreen';
import { buildPassPanel } from '@ui/EventPassPanel';
import type { BoardScreen } from '@ui/BoardScreen';
import { attachAudioHooks } from '@audio/AudioBus';
import en from '@i18n/en.json';
import es from '@i18n/es.json';

/** Version de la app. La comparan los packs (`requires.appMin`). */
const APP_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Pantalla de carga
// ---------------------------------------------------------------------------

function buildLoader(): { setProgress: (r: number) => void; hide: () => void } {
  const element = document.createElement('div');
  element.className = 'loader';

  const title = document.createElement('div');
  title.className = 'loader-title';
  title.textContent = 'FungiFlush';

  const bar = document.createElement('div');
  bar.className = 'loader-bar';
  const fill = document.createElement('div');
  fill.className = 'loader-bar-fill';
  bar.appendChild(fill);

  const text = document.createElement('div');
  text.className = 'loader-text';
  text.textContent = t('ui.loading');

  element.append(title, bar, text);
  document.body.appendChild(element);

  return {
    setProgress: (ratio) => {
      fill.style.width = `${Math.round(ratio * 100)}%`;
    },
    hide: () => {
      element.classList.add('is-hidden');
      window.setTimeout(() => element.remove(), 600);
    },
  };
}

/**
 * El movimiento reducido tiene que apagar tambien las animaciones de CSS, que
 * no pasan por el render. La clase vive en `<html>` y el CSS hace el resto.
 */
function applyReduceMotionClass(reduceMotion: boolean): void {
  document.documentElement.classList.toggle('reduce-motion', reduceMotion);
}

/** Aviso de rotacion: el juego esta pensado para landscape. */
function buildRotateNotice(): void {
  const notice = document.createElement('div');
  notice.className = 'rotate-notice';

  const icon = document.createElement('div');
  icon.className = 'rotate-icon';
  icon.textContent = '📱';

  const text = document.createElement('div');
  text.textContent = currentLanguage() === 'es' ? 'Girá el dispositivo' : 'Rotate your device';

  notice.append(icon, text);
  document.body.appendChild(notice);

  // El aviso de rotar es para dispositivos que se sostienen: se usa el umbral
  // "sin raton" (`isTouchOnly`), no el de layout (`isCoarsePointer`).
  const isTouch = isTouchOnly();
  if (isTouch) notice.classList.add('is-enabled');
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // --- Contenido (packs) ---
  // Va ANTES del i18n porque los packs pueden aportar su propio diccionario.
  const content = await bootstrapContent({ appVersion: APP_VERSION, dictionaries: { en, es } });
  await initI18n(undefined, content.packDictionaries);

  const loader = buildLoader();
  document.documentElement.lang = currentLanguage();
  buildRotateNotice();

  // --- Persistencia (perfil permanente + run) ---
  const storage = new Storage();
  const saveBackend = await storage.init();
  const profileStore = new ProfileStore(storage);
  const runStore = new RunStore(storage);
  const profile = await profileStore.load();

  // El idioma guardado en el perfil gana sobre el detectado.
  if (profile.settings.lang !== currentLanguage()) await setLanguage(profile.settings.lang);
  document.documentElement.lang = currentLanguage();
  applyReduceMotionClass(profile.settings.reduceMotion);

  // --- Assets ---
  const assets = new ArtAssets();
  await assets.loadAll((ratio) => loader.setProgress(ratio * 0.85));

  // --- Acceso por DLC ---
  const entitlements = EntitlementStore.from(profile.entitlements);
  // Los ids ganados por retencion (racha/logro/pase) se pasan como array VIVO:
  // un desbloqueo a mitad de sesion entra al toque en sorteos/drafts y deja de
  // listarse como bloqueado en la Coleccion/Tienda.
  //
  // El 4to argumento es el mapa de CONDICIONES pendientes (R2), tambien VIVO:
  // `UnlockTracker` lo reescribe al arrancar (publica las puertas) y borra cada
  // entrada al abrirse. Es lo que hace que una carta bloqueada por jugar se
  // muestre grisada con "ganá un ciego en el ante 6" en vez de un candado mudo.
  const gate = new PackGate(
    entitlements,
    content.registry,
    {
      cards: profile.collection.unlockedCardIds,
      jokers: profile.collection.unlockedJokerIds,
    },
    profile.collection.pendingUnlocks,
  );

  // --- Retencion (datos) ---
  // JSON plano, NO packs: asi no pasan por `ContentRegistry.validate` ni por
  // `artCoverage`. Se parsean al entrar y una entrada invalida se descarta.
  const dailyTable: DailyRewardTable = parseDailyTable(dailyRewardsData);
  const achievementDefs: AchievementDef[] = parseAchievements(achievementsData);
  // R2: puertas de contenido por jugar. Se parsean al arrancar y las condiciones
  // se publican en el perfil para que la Coleccion sepa explicar cada candado.
  const unlockDefs: UnlockDef[] = parseUnlockRules(unlockRulesData);
  // P4: temporada unica (Founder). `null` si el JSON no sirve: el paso queda
  // como "proximamente" y no tumba el arranque.
  const seasonDef = parseSeason(seasonsData);
  // P2.6: misiones de run. Igual que el resto de `src/data/*.json`, plano y sin
  // pasar por el validador de packs. Una mision rota se descarta sola.
  const missionDefs = parseMissions(missionsData);

  // El aviso del sistema se detecta al arrancar (barato y sin efectos); el
  // PERMISO se pide recien en contexto, ver `onClaimDaily`.
  void notifier.init();

  // --- Motor ---
  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  const seed = seedParam ? Number(seedParam) || undefined : undefined;
  /** Override de calidad por URL. Es la via que usa el smoke para probar el tier alto. */
  const qualityParam = params.get('quality');
  const forcedQuality: QualityTier | null =
    qualityParam === 'low' || qualityParam === 'medium' || qualityParam === 'high'
      ? qualityParam
      : null;

  const engine = new GameEngine({
    bundle: content.registry.toBundle(gate),
    contentFilter: gate.cardFilter(),
    jokerFilter: gate.jokerFilter(),
    contentHash: content.registry.contentHash(),
    packIds: content.loadedIds,
    ...(seed !== undefined ? { seed } : {}),
    // Mazo inicial del perfil. Hasta ahora `starterOverrides` se guardaba pero
    // nadie lo leia: las copias extra del pase no hacian nada.
    ...(profile.starterOverrides.length > 0
      ? { starterOverrides: profile.starterOverrides }
      : {}),
    // P2.6: misiones de run. El motor no conoce el archivo; se le inyectan.
    missions: missionDefs,
  });

  // --- Audio (no-op, con los ganchos ya conectados) ---
  attachAudioHooks();

  // --- Autoguardado ---
  // Se escribe 1.5 s despues del ultimo cambio de estado, asi que una mano
  // entera produce UNA escritura, no doscientas. El menu no se guarda nunca.
  let savedRun: RunSaveData | null = null;

  bus.on('state:changed', ({ run }) => {
    if (run.status === 'menu') {
      runStore.cancelAutosave();
      return;
    }
    if (run.status === 'game_over' || run.status === 'victory') {
      // Una run terminada no se continua: se borra el guardado.
      runStore.cancelAutosave();
      void runStore.clear();
      return;
    }
    runStore.autosave(() => engine.serialize());
  });

  // --- Coleccion: descubrimiento de cartas ---
  // Se marca una carta como "vista" la primera vez que aparece en una mano o
  // que se crea. El perfil debouncea la escritura, asi que esto no golpea el
  // disco una vez por carta dibujada.
  const seen = new Set(profile.collection.seenCardIds);
  const markSeen = (cardId: string): void => {
    if (seen.has(cardId)) return;
    seen.add(cardId);
    profileStore.patch((p) => {
      if (!p.collection.seenCardIds.includes(cardId)) p.collection.seenCardIds.push(cardId);
    });
  };
  bus.on('card:drawn', ({ card }) => markSeen(card.def.id));
  bus.on('card:created', ({ card }) => markSeen(card.def.id));

  // --- Estadisticas de perfil ---
  bus.on('game:over', ({ reason, ante }) => {
    // El banner se emite FUERA del patch: `patch` es sincrono y devuelve una
    // copia nueva, asi que el aviso tiene que esperar a que el guardado real
    // haya ocurrido para no anunciar un nivel que todavia no existe.
    let unlockedAscension = 0;
    profileStore.patch((p) => {
      p.stats.runs += 1;
      if (reason === 'victory') p.stats.wins += 1;
      p.stats.bestAnte = Math.max(p.stats.bestAnte, ante);
      // R5: historial de la partida. Lo ultimo primero y capeado. Se deduplica
      // por `seed` porque `game:over` puede reemitirse si el jugador restaura
      // una run ya terminada (el save se escribe al morir, no al salir).
      const already = p.history.some((h) => h.seed === engine.run.seed);
      if (!already) {
        const stats = engine.run.stats;
        p.history.unshift({
          seed: engine.run.seed,
          ante,
          ascension: engine.run.ascension,
          win: reason === 'victory',
          reason: reason === 'victory' ? 'victory' : 'loss',
          at: Date.now(),
          // Un historial que solo dice "ganaste/perdiste" no cuenta una run.
          // Estos cuatro numeros son los que hacen que dos derrotas en el mismo
          // ante se lean distinto (una llego con 40k de mejor mano, la otra con
          // 3k), y el arquetipo dice CON QUE se jugo.
          bestHand: stats.bestHand,
          totalScore: engine.run.totalScore,
          blindsCleared: stats.blindsCleared,
          cardsDestroyed: stats.cardsDestroyed,
          archetype: engine.run.archetype,
        });
        if (p.history.length > HISTORY_CAP) p.history.length = HISTORY_CAP;
      }
      // R1: ganar en el nivel N desbloquea N+1 (hasta el maximo del contenido).
      // `highestUnlocked` es MONOTONO: nunca baja, ni siquiera perdiendo A8.
      if (reason === 'victory') {
        const max = engine.registry.maxAscension();
        const next = Math.min(engine.run.ascension + 1, max);
        if (next > p.ascension.highestUnlocked) {
          p.ascension.highestUnlocked = next;
          unlockedAscension = next;
        }
      }
      // P4: XP de temporada por run (ante * 50, +200 si gana).
      if (seasonDef) addXp(p, seasonDef.id, ante * 50 + (reason === 'victory' ? 200 : 0));
    });
    if (seasonDef) {
      const total =
        profileStore.current.entitlements.passes.find((x) => x.seasonId === seasonDef.id)?.xp ?? 0;
      bus.emit('pass:xp', {
        seasonId: seasonDef.id,
        amount: ante * 50 + (reason === 'victory' ? 200 : 0),
        total,
      });
    }
    if (unlockedAscension > 0) {
      bus.emit('banner:show', {
        key: 'banner.ascension.unlocked',
        params: { level: unlockedAscension, name: t(engine.registry.ascension(unlockedAscension).nameKey) },
        kind: 'success',
      });
    }
  });

  // --- Dado multiplicador (Simbionte legendario) ---
  // Ya NO hay tirada manual al entrar al ciego: cada ante juega sus 3 ciegos en
  // orden, sin eleccion. El dado queda como habilidad ACTIVA del Simbionte
  // legendario `joker_loaded_die`: se carga con un boton y su cara multiplica
  // las esporas de la proxima mano.

  // El dado se aparca en su rincon si hay una cara cargada por el Simbionte.
  bus.on('blind:selected', () => {
    const die = engine.loadedDieFace;
    if (die) scene.parkDie(die.face, DIE_FACES);
  });

  // El Simbionte cargo una cara: el cubo se va al rincon mostrando el resultado.
  bus.on('die:loaded', ({ die }) => {
    scene.parkDie(die.face, DIE_FACES);
  });

  // Al entrar a la seleccion de ciego ya no hay nada que armar: el panel es
  // informativo (la ruta del ante) y el boton "Comenzar" arranca el ciego.

  /**
   * Entradas de la coleccion: TODO el contenido del registro (incluido el de
   * DLC sin comprar, que se muestra bloqueado) con su estado y si el jugador
   * ya lo descubrio.
   */
  const buildCollection = (): CollectionEntry[] => {
    const stateOf = (id: string): CollectionState => {
      // Un desbloqueo de retencion se muestra como 'unlocked' (con su origen),
      // distinto de 'owned' (parte de un pack comprado).
      if (profile.collection.unlockSource[id]) return 'unlocked';
      const state = gate.contentState(id);
      return state === 'allowed' ? 'owned' : state;
    };
    const packTitleOf = (id: string): string | undefined => {
      const packId = content.registry.packOf(id);
      return packId ? content.registry.manifestOf(packId)?.titleKey : undefined;
    };
    /**
     * Por que esta bloqueado. Solo tiene sentido para las puertas por jugar: el
     * candado de un DLC ya lo explica el pack.
     */
    const lockReasonOf = (id: string): string | undefined => gate.lockReasonKey(id);

    const entries: CollectionEntry[] = [];
    for (const card of content.registry.poolOf('card') as CardDefinition[]) {
      entries.push({
        id: card.id,
        nameKey: card.nameKey,
        element: card.element,
        rarity: card.rarity,
        kind: 'card',
        state: stateOf(card.id),
        seen: seen.has(card.id),
        ...(profile.collection.unlockSource[card.id]
          ? { unlockSource: profile.collection.unlockSource[card.id] }
          : {}),
        ...(packTitleOf(card.id) ? { packTitleKey: packTitleOf(card.id) } : {}),
        ...(lockReasonOf(card.id) ? { lockReasonKey: lockReasonOf(card.id) } : {}),
      });
    }
    for (const joker of content.registry.poolOf('joker') as JokerDefinition[]) {
      entries.push({
        id: joker.id,
        nameKey: joker.nameKey,
        element: 'neutral',
        rarity: joker.rarity,
        kind: 'joker',
        state: stateOf(joker.id),
        seen: seen.has(joker.id),
        ...(profile.collection.unlockSource[joker.id]
          ? { unlockSource: profile.collection.unlockSource[joker.id] }
          : {}),
        ...(packTitleOf(joker.id) ? { packTitleKey: packTitleOf(joker.id) } : {}),
        ...(lockReasonOf(joker.id) ? { lockReasonKey: lockReasonOf(joker.id) } : {}),
      });
    }

    // Orden estable: primero los descubiertos, despues por rareza.
    const rank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3, mythic: 4 };
    entries.sort(
      (a, b) =>
        Number(b.seen) - Number(a.seen) ||
        (rank[b.rarity] ?? 0) - (rank[a.rarity] ?? 0) ||
        a.id.localeCompare(b.id),
    );
    return entries;
  };

  // --- Validacion de contenido en desarrollo ---
  if (import.meta.env.DEV) {
    const errors = content.issues.filter((i) => i.level === 'error');
    if (errors.length > 0) console.error(`[FungiFlush] ${errors.length} errores de contenido:`, errors);
    for (const skipped of content.skipped) {
      console.warn(`[FungiFlush] pack omitido: ${skipped.id} (${skipped.reason})`);
    }
    const missing = validateDictionaryCoverage(content.registry.toBundle(), { en, es });
    if (missing.length > 0) {
      console.warn(`[FungiFlush] ${missing.length} claves i18n faltantes:`, missing.slice(0, 10));
    }
  }

  // --- Tipografia ---
  // El texto de las cartas se HORNEA en un canvas 2D. Si una webfont todavia no
  // termino de cargar cuando se genera la primera textura, la carta queda con
  // la fuente de respaldo hasta que algo la regenere (un cambio de idioma o de
  // nivel), y eso no se nota hasta que se ve una carta vieja al lado de una
  // nueva. Esperar aca es barato: sin fuente propia resuelve al toque.
  try {
    // Se piden los dos pesos REALES que usa el canvas de las cartas.
    await Promise.all([
      document.fonts.load(`400 31px ${CARD_DISPLAY_FONT}`),
      document.fonts.load(`700 21px ${CARD_TEXT_FONT}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Un navegador sin la API de fuentes no puede tener webfonts propias.
  }

  // --- Render ---
  const canvas = document.getElementById('fungiflush-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root');
  if (!canvas || !uiRoot) throw new Error('Faltan #fungiflush-canvas o #ui-root en el DOM.');

  const lastPointer = { x: 0, y: 0 };
  window.addEventListener(
    'pointermove',
    (event) => {
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
    },
    { passive: true },
  );

  let hud: HUD | null = null;

  const scene = new SceneManager({
    canvas,
    engine,
    assets,
    callbacks: {
      onCardClick: (uid) => {
        engine.toggleSelect(uid);
      },
      onHoverChange: (card) => {
        if (!hud) return;
        if (!card) {
          hud.hideTooltip();
          return;
        }
        const selection = engine.round?.selected ?? [];
        let hint: string | undefined;
        if (selection.length > 0) {
          const round = engine.round;
          const cards = round
            ? round.hand.filter((c) => selection.includes(c.uid) || c.uid === card.uid)
            : [];
          const combos = detectCombos(cards);
          if (combos.length > 0) hint = combos.map((c) => t(c.nameKey)).join(' · ');
        }
        hud.showTooltip(card, lastPointer.x, lastPointer.y, hint);
      },
      onScorePopup: (x, y, text, color) => hud?.popup(x, y, text, color),
      onScoreTick: (info) => hud?.scoreTick(info),
      // El monitor de frames bajo el nivel solo. El render no muestra avisos:
      // avisa y el controlador decide. NO se persiste en el perfil a proposito:
      // es un ajuste de la sesion, y el jugador puede forzarlo en Ajustes.
      onQualityDowngraded: () => hud?.toast(t('settings.quality.downgraded'), 'warn'),
      /**
       * El jugador LANZO el cubo del dado.
       *
       * El flujo de ciego ya no pide una tirada manual (ver arriba), asi que
       * esta via quedo sin uso: el dado solo aparece como habilidad del
       * Simbionte legendario, que se anima con `onUseLoadedDie`. Se deja el
       * no-op explicito para que el render pueda seguir ofreciendo el arrastre
       * del cubo sin romper nada si algun dia se reusa.
       */
      onDieThrown: () => {},
      /**
       * El jugador arrastro una carta y la solto en una zona.
       *
       * El render solo sabe QUE zona es; el significado vive aca. Los tres
       * caminos usan metodos que ya existian (o `discardCards`, que es el
       * mismo camino que `discardSelected`): arrastrar no inventa reglas.
       */
      onCardDrop: (uid, zone) => {
        const round = engine.round;
        if (!round) return;
        const isSelected = round.selected.includes(uid);

        if (zone === 'play') {
          // Ya estaba seleccionada: soltarla en la zona de juego no la saca.
          // Un drop es una intencion, no un toggle.
          if (isSelected) return;
          if (!engine.toggleSelect(uid)) {
            hud?.toast(t('action.selectionFull', { count: MAX_PLAY_SIZE_DEFAULT }), 'warn');
          }
          return;
        }

        if (zone === 'hand') {
          if (isSelected) engine.toggleSelect(uid);
          return;
        }

        if (zone === 'discard') {
          if (!engine.discardCards([uid])) hud?.toast(t('action.noDiscards'), 'warn');
        }
      },
      /**
       * El jugador toco la carta que YA estaba centrada en el anillo.
       *
       * El render solo reporta el indice; que hacer con el lo decide la pantalla
       * que abrio el carrusel (`carouselActivate`, registrado por `openDeck` /
       * `onOpenCollection`). Sin handler (ninguna pantalla de anillo abierta) el
       * gesto no hace nada, que es lo correcto.
       */
      onCarouselActivate: (index) => carouselActivate?.(index),
    },
  });

  // --- Calidad grafica ---
  // El SceneManager ya aplico lo que detecto por dispositivo al construirse.
  // Aca solo se corrige si el perfil (o la URL) piden otra cosa. Cuando el
  // ajuste es `auto` y coincide con lo detectado no se toca nada: asi el motivo
  // reportado sigue siendo el de la deteccion (`software`, `mobile`, ...).
  const applyQualitySetting = (): void => {
    const detected = scene.detectedQuality();
    const setting = profileStore.current.settings.quality;
    const tier = forcedQuality ?? resolveQuality(setting, detected.tier);
    const reason = forcedQuality || setting !== 'auto' ? 'manual' : detected.reason;
    if (tier !== scene.quality().tier || scene.quality().reason !== reason) {
      scene.applyQuality(tier, reason);
    }
  };
  applyQualitySetting();

  if (params.get('perf') === '1') scene.startPerf();

  /** El mazo usa el mismo anillo que la coleccion. */
  const DECK_CAROUSEL = { radius: 9, halfSpan: 5, wrap: true, lift: 1.9 };

  /**
   * Handler del gesto "tocar la carta centrada" en el carrusel activo.
   *
   * El render no conoce el panel que hay detras: solo avisa el indice tocado.
   * Cada pantalla que monta un anillo (mazo, coleccion) registra aca que hacer
   * con ese indice — normalmente abrir su detalle. Se limpia al cerrar.
   */
  let carouselActivate: ((index: number) => void) | null = null;

  const openDeck = (highlightUid?: string): void => {
    const state = hud?.deckState(highlightUid);
    if (!hud || !state) return;
    let frame: DeckCarouselFrame;
    const focus = (i: number): void => frame.setFocus(i);
    // EL CARRUSEL Y EL FRAME tienen que compartir el mismo orden de cartas.
    // El frame ordena segun el filtro (elemento/estado/...) y el preview lee
    // por indice; si el carrusel renderiza en el orden del mazo, el indice
    // apunta a OTRA carta y el detalle no coincide con la carta enfocada.
    // Por eso: ordenamos aca, le pasamos el array al frame, y cada cambio de
    // orden se aplica a los dos a la vez.
    const sorted = sortCards(state.cards, 'element');
    // La carta resaltada (p. ej. la que se acaba de mejorar) define el foco
    // inicial. Antes el foco caia siempre en el indice 0 y la carta mejorada
    // "se iba" del centro del anillo: el jugador la mejoraba y la perdia de
    // vista. Ahora el anillo se para en ELLA y el detalle la muestra.
    const focusIndex = highlightUid
      ? Math.max(0, sorted.findIndex((c) => c.uid === highlightUid))
      : 0;
    const toEntries = (cards: CardInstance[]): CarouselEntryView[] =>
      cards.map((card) => ({
        uid: card.uid,
        discovered: true,
        cardId: card.def.id,
        level: card.level,
        // El anillo tiene que dibujar la carta REAL de la run, con sus mejoras:
        // con solo el nivel, los numeros del sustrato/esporas se quedaban en los
        // del nivel 1 aunque el detalle del panel ya mostrara los nuevos.
        bonusSubstrate: card.bonusSubstrate,
        bonusSpores: card.bonusSpores,
      }));
    frame = buildDeckCarouselFrame(state, {
      onPurge: doPurge,
      onUpgrade: doUpgrade,
      onEvolve: doEvolve,
      onClose: () => {
        carouselActivate = null;
        scene.setCarousel(null);
        hud?.closePanel();
      },
      onSorted: (cards) => {
        scene.setCarousel(toEntries(cards), focus, DECK_CAROUSEL);
        frame.setSorted(cards);
      },
    });
    // El frame ya ordeno internamente con `sortCards(..., 'element')` al
    // arrancar, pero no compartia ese orden con el carrusel (que recibia
    // `state.cards` en el orden del mazo). Se lo damos nosotros para que el
    // indice del preview y el del anillo apunten a la misma carta.
    frame.setSorted(sorted, highlightUid);
    // Tocar la carta centrada abre su detalle: el anillo no cambia de giro, asi
    // que el gesto se sentia muerto. Se usa el mismo `setFocus` que ya usa el
    // giro, porque el panel del mazo muestra UNA carta (la enfocada).
    carouselActivate = (index) => frame.setFocus(index);
    hud.showPanel(frame.panel, { carousel: true });
    scene.setCarousel(toEntries(sorted), focus, DECK_CAROUSEL);
    // El anillo arranca dibujando la entrada 0 (setEntries resetea el giro).
    // Se lo gira a la carta enfocada para que el anillo y el detalle coincidan.
    if (focusIndex > 0) scene.focusCarousel(focusIndex);
  };

  const doPurge = (uid: string): void => {
    if (!engine.purgeCard(uid)) {
      hud?.toast(
        engine.canEditDeck() ? t('deck.cannotAfford') : t('deck.onlyBetweenBlinds'),
        'warn',
      );
      return;
    }
    openDeck();
  };

  const doUpgrade = (uid: string): void => {
    const card = engine.run.deck.allCards.find((c) => c.uid === uid);
    if (!engine.upgradeCard(uid)) {
      hud?.toast(
        engine.canEditDeck() ? t('deck.cannotUpgrade') : t('deck.onlyBetweenBlinds'),
        'warn',
      );
      return;
    }
    if (card) hud?.toast(t('deck.upgraded', { name: t(card.def.nameKey), level: card.level }), 'info');
    openDeck(uid);
  };

  const doEvolve = (uid: string): void => {
    const card = engine.run.deck.allCards.find((c) => c.uid === uid);
    if (!engine.evolveCard(uid)) {
      hud?.toast(engine.canEditDeck() ? t('evolve.blocked') : t('deck.onlyBetweenBlinds'), 'warn');
      return;
    }
    if (card) hud?.toast(t('evolve.done', { name: t(card.def.nameKey) }), 'info');
    openDeck(uid);
  };

  // --- R1: ascension ---
  // El HUD no conoce el perfil, asi que el estado le llega empujado. Se llama
  // en cada apertura de menu y cada vez que el jugador cambia de nivel; si el
  // techo del contenido es mayor que lo desbloqueado, el panel ya lo explica.
  const syncAscension = (): void => {
    const p = profileStore.current;
    const max = engine.registry.maxAscension();
    // Modificadores reales por nivel, para que el panel derive "que cambia"
    // en vez de repetir prosa escrita a mano (que se desincroniza del JSON).
    const modifiers: Array<Record<string, number | boolean | undefined> | undefined> = [undefined];
    for (let level = 1; level <= max; level++) {
      modifiers[level] = engine.registry.ascension(level).modifiers as Record<
        string,
        number | boolean | undefined
      >;
    }
    hud?.setAscensionState({
      unlocked: p.ascension.highestUnlocked,
      selected: p.ascension.selected,
      max,
      modifiers,
    });
  };

  // --- R4b: cosméticos ---
  // Mismo patrón que la ascensión: el HUD no conoce el perfil. Empuja el estado
  // y, al arrancar y al cambiar, dice al render qué dorso/tapete mostrar.
  const syncCosmetics = (): void => {
    const c = profileStore.current.cosmetics;
    hud?.setCosmeticsState({
      owned: [...c.owned],
      equipped: { cardback: c.equippedCardBack, felt: c.equippedFelt },
    });
    scene.setCardBack(c.equippedCardBack);
    scene.setFelt(c.equippedFelt);
  };

  // --- R5: historial ---
  // Igual que ascensión/cosméticos: el HUD no conoce el perfil, se lo empuja.
  const syncHistory = (): void => {
    hud?.setHistoryState(profileStore.current.history.map((h) => ({ ...h })));
  };

  // --- Arquetipos ---
  // El HUD no conoce ni el perfil ni `archetypes.json`: se le empuja la lista
  // (con las claves i18n) y el total de cartas de cada mazo inicial. El total se
  // calcula con el MISMO `buildStarterDeck` que arranca la run, para que el
  // numero de la tarjeta no mienta.
  const starterSizeOf = (id: string): number => {
    const overrides = starterFor(id);
    if (!overrides) return 0;
    const resolved = engine.registry.buildStarterDeck(new RNG(1), overrides);
    return resolved.length;
  };

  const syncArchetypes = (): void => {
    const list = ARCHETYPES.map((a) => ({
      id: a.id,
      nameKey: a.nameKey,
      taglineKey: a.taglineKey,
      howKey: a.howKey,
      weaknessKey: a.weaknessKey,
      element: a.element as string,
    }));
    const starterSizes: Record<string, number> = {};
    for (const a of ARCHETYPES) starterSizes[a.id] = starterSizeOf(a.id);
    hud?.setArchetypeState({
      list,
      selected: profileStore.current.archetype.selected,
      starterSizes,
    });
  };

  // --- HUD ---
  /**
   * Criterio de orden PERSISTENTE de la mano (Task 7).
   *
   * Antes ordenar era un acto de un solo uso: al descartar/robar la mano
   * volvia al orden del motor y habia que reordenar a mano cada vez. Ahora el
   * criterio elegido se guarda y se RE-APLICA solo cuando cambia la mano, asi
   * el jugador elige una vez y el orden se mantiene.
   *
   * `'default'` = sin orden automatico (es el estado inicial, y volver a
   * elegirlo lo apaga).
   */
  let stickySortMode: SortMode = 'default';

  hud = new HUD({
    engine,
    root: uiRoot,
    // La UI no conoce los assets: se los presta el render. Asi la miniatura del
    // mazo es el MISMO WebP que la carta en la mano.
    cardArt: (def) => scene.cardArt(def),
    jokerArt: (def) => scene.jokerArt(def),
    blindArt: (art) => scene.blindArt(art),
    appInfo: {
      version: APP_VERSION,
      contentHash: content.registry.contentHash(),
      packs: content.loadedIds,
      skipped: content.skipped,
    },
    callbacks: {
      // El barrido va ANTES de la accion: la captura del frame viejo tiene que
      // ocurrir con la escena todavia en el estado anterior (ver `playTransition`).
      onPlay: () => {
        scene.playTransition();
        engine.playHand();
      },
      onDiscard: () => engine.discardSelected(),
      onClear: () => engine.clearSelection(),
      /**
       * Orden de la mano (P1.3/P1.4/P2.1).
       *
       * El criterio lo resuelve `sortHand()` (puro, en `ui/handSort.ts`) y el
       * motor lo aplica con `reorderHand()`, que valida que la lista sea una
       * permutacion exacta de la mano: si no, no toca nada. Ordenar nunca
       * consume recursos ni cambia cartas.
       */
      onSortHand: (mode) => {
        const round = engine.round;
        if (!round) return;
        // El criterio queda GUARDADO: se vuelve a aplicar cuando la mano cambie
        // (descartar, robar, jugar). `'default'` lo apaga.
        stickySortMode = mode;
        const ordered = sortHand(round.hand, mode);
        const before = round.hand.map((c) => c.uid).join(',');
        const after = ordered.map((c) => c.uid).join(',');
        if (!engine.reorderHand(ordered.map((c) => c.uid))) return;
        hud?.applySortMode(mode);
        // El motor emite `state:changed` y el RENDER reordena `handCards` desde
        // ahi, asi que el abanico se mueve solo. Si la mano ya estaba en ese
        // orden, no hay nada que mover y se avisa: sin esto el boton parecia
        // roto en una mano de 2 cartas iguales.
        if (before === after && mode !== 'default') hud?.toast(t('sort.alreadySorted'), 'info');
      },
      onBuy: (offerId) => {
        // El motivo del rechazo se calcula ACA, no en el aviso generico: antes
        // cualquier fallo decia "no alcanza el dinero", incluso cuando la oferta
        // ya estaba vendida o no quedaba slot de joker. Un aviso que miente
        // manda al jugador a juntar plata para algo que no puede comprar.
        const offer = engine.run.shop?.offers.find((o) => o.id === offerId);
        if (!offer || offer.sold) return;
        if (offer.kind === 'joker' && engine.run.jokers.length >= engine.run.jokerSlots) {
          hud?.toast(t('action.slotsFull'), 'warn');
          return;
        }
        if (!engine.buyOffer(offerId)) hud?.toast(t('action.cantAfford'), 'warn');
      },
      onReroll: () => {
        if (!engine.rerollShop()) hud?.toast(t('action.cantAfford'), 'warn');
      },
      onSellJoker: (uid) => engine.sellJoker(uid),
      onFocusJoker: (uid) => scene.flashJoker(uid),
      /**
       * Un panel tapa la arena. El dado se esconde: durante la tirada esta al
       * DOBLE de tamano en el centro, asi que en el mazo o en la coleccion
       * quedaba flotando delante del carrusel.
       */
      onArenaCovered: (covered: boolean) => scene.setDieVisible(!covered),
      onLeaveShop: () => {
        scene.playTransition();
        engine.leaveShop();
      },
      // Los 3 ciegos del ante son una RUTA, no una eleccion: sin argumento, el
      // motor arranca el ciego que toca por `blindIndex`.
      onStartBlind: () => {
        scene.playTransition();
        engine.chooseBlind();
      },
      // P2.4 — El HUD dibuja la decision; el MOTOR aplica los efectos. Si la
      // opcion no se puede pagar, `chooseInterlude` devuelve false y el panel
      // se queda abierto (el boton ya esta deshabilitado, pero esto cubre el
      // caso de que el estado cambie bajo los pies del jugador).
      onChooseInterlude: (choiceId) => {
        if (!engine.chooseInterlude(choiceId)) {
          hud?.toast(t('interlude.cantAfford'), 'warn');
        }
      },
      onRestart: () => {
        savedRun = null;
        hud?.setContinueAvailable(null);
        void runStore.clear();
        engine.startRun();
        scene.setMode('run');
      },
      /**
       * Salir al MENU PRINCIPAL desde la partida.
       *
       * Tres cosas que NO son opcionales:
       *   1. El guardado se BORRA. Si sobreviviera, al volver al menu el chip
       *      "Continuar" ofreceria retomar una run que el jugador acaba de
       *      abandonar.
       *   2. `savedRun` se limpia para que el chip no reaparezca en memoria.
       *   3. La escena vuelve a modo menu (decorado + sin arena de juego).
       */
      onQuitToMenu: () => {
        savedRun = null;
        hud?.setContinueAvailable(null);
        void runStore.clear();
        engine.enterMenu();
        scene.setMode('menu', { reduceMotion: profileStore.current.settings.reduceMotion });
      },
      onContinueRun: () => {
        if (!savedRun) return;
        if (engine.restore(savedRun)) {
          savedRun = null;
          hud?.setContinueAvailable(null);
          scene.setMode('run');
        } else {
          hud?.toast(t('log.saveIncompatible'), 'warn');
        }
      },
      onToggleLanguage: () => {
        void toggleLanguage().then(() => {
          document.documentElement.lang = currentLanguage();
        });
      },
      // --- Pantalla de inicio ---
      onStartRun: () => {
        void runStore.clear();
        // La ascension ELEGIDA viaja al motor aca. `selected` vive en el perfil
        // (persistente) y `startRun` la recorta al techo del contenido.
        engine.startRun(seed, profileStore.current.ascension.selected);
        scene.setMode('run');
        // P0.3 (v2) — Guia de inicio. Se ofrece UNA vez por PERFIL
        // (`seenTutorial`, persistido): antes era una vez por run y en memoria,
        // asi que quien cerraba la app en el primer ciego la volvia a ver en
        // cada partida. El cierre la marca vista; reabrirla desde el menu no
        // depende de esto.
        if (!profileStore.current.seenTutorial) {
          window.setTimeout(() => hud?.showTutorial(), 420);
        }
      },
      // El arquetipo elegido en el panel arranca la run con SU mazo y SU sesgo.
      // Se persiste como preferencia para que el proximo arranque lo recuerde.
      onStartRunWithArchetype: (archetypeId) => {
        void runStore.clear();
        const starter = starterFor(archetypeId);
        const bias = biasFor(archetypeId);
        // El motor no conoce `archetypes.json`: se le inyectan el mazo y el
        // sesgo YA resueltos, y el id solo para guardarlo en la run.
        engine.setArchetypeLoadout(starter, bias);
        engine.startRun(seed, profileStore.current.ascension.selected, archetypeId);
        profileStore.patch((p) => {
          p.archetype.selected = archetypeId;
        });
        syncArchetypes();
        scene.setMode('run');
        if (!profileStore.current.seenTutorial) {
          window.setTimeout(() => hud?.showTutorial(), 420);
        }
      },
      onSelectAscension: (level) => {
        // El nivel elegido nunca supera el desbloqueado en el perfil. El panel
        // ya no ofrece los trabados, pero se valida igual: el perfil es la
        // fuente de verdad y un estado imposible no debe poder escribirse.
        profileStore.patch((p) => {
          p.ascension.selected = Math.max(0, Math.min(level, p.ascension.highestUnlocked));
        });
        // El menu se redibuja para que el chip muestre el nivel nuevo.
        syncAscension();
        hud?.showAscension();
      },
      onPanelOpened: (isCarousel) => {
        // Un panel que NO monta sobre el carrusel apaga la escena 3D: si no, el
        // anillo quedaria vivo detras del panel nuevo (p. ej. el mazo DOM).
        if (!isCarousel) scene.setCarousel(null);
      },
      onOpenCollection: () => {
        // La Coleccion vive sobre el CARRUSEL 3D: el marco DOM solo manda los
        // filtros y el detalle; el anillo esta en el canvas y recibe el input.
        const all = buildCollection();
        const toViews = (list: CollectionEntry[]): CarouselEntryView[] =>
          list.map((e) => ({
            uid: e.id,
            discovered: e.seen,
            ...(e.kind === 'joker' ? { jokerId: e.id } : { cardId: e.id }),
          }));

        // `frame` se referencia desde sus propios callbacks: se declara antes
        // y se asigna despues (los callbacks corren mas tarde, no al construir).
        let frame: CollectionCarouselFrame;
        const focusHandler = (i: number): void => frame.setFocus(i);
        frame = buildCollectionCarousel(all, {
          onClose: () => {
            carouselActivate = null;
            scene.setCarousel(null);
            hud?.closePanel();
          },
          onFiltered: (filtered) => scene.setCarousel(toViews(filtered), focusHandler),
          onOpenStore: () => hud?.toast(t('store.comingSoon'), 'info'),
          onOpenPass: () => showPass(),
        });
        // Tocar la carta centrada abre su detalle (mismo patron que el mazo).
        carouselActivate = (index) => frame.setFocus(index);
        hud?.showPanel(frame.panel, { carousel: true });
        scene.setCarousel(toViews(all), focusHandler);
      },
      onOpenExpansions: () => hud?.toast(t('store.comingSoon'), 'info'),
      onOpenPass: () => showPass(),
      onOpenSettings: () => hud?.showSettings(profileStore.current.settings),
      onOpenAbout: () => hud?.showAbout(),
      // Reabrir la guia desde el menu. Ademas de mostrarla, se marca vista en
      // el perfil: alguien que la busca en el menu ya no necesita el aviso
      // automatico de la primera run.
      onOpenGuide: () => {
        hud?.showTutorial(true);
        if (!profileStore.current.seenTutorial) {
          profileStore.patch((p) => {
            p.seenTutorial = true;
          });
        }
      },
      onOpenBoard: () => {
        void openBoard();
      },
      // --- Retencion: la UI solo pide; quien escribe en el perfil es aca ---
      onOpenDaily: () => openDaily(),
      onClaimDaily: () => {
        // La recompensa se aplica DENTRO del patch: si el proceso muere antes
        // del debounce, no queda un "desbloqueado" en memoria que no existe en
        // el disco. El resultado sale por un objeto porque `claimDaily` corre
        // en el callback y una variable suelta no sobrevive al analisis de
        // tipos (y tampoco se lee con claridad).
        const box: { claim: DailyClaim | null } = { claim: null };
        profileStore.patch((p) => {
          box.claim = claimDaily(p, Date.now(), dailyTable);
        });
        const claim = box.claim;
        if (!claim?.ok) {
          openDaily();
          return;
        }
        // Pedir el permiso EN CONTEXTO: el claim es un gesto del usuario, y el
        // navegador/OS solo lo concede dentro de uno. Si ya se pregunto antes
        // (o se denego), `notify.ts` no insiste. Solo lo pedimos si el jugador
        // dejo las notificaciones diarias prendidas: si las apago, no molestar.
        if (profileStore.current.settings.notifyDaily) void notifier.ensurePermission();
        bus.emit(
          'daily:claim',
          claim.reward ? { streak: claim.streak, reward: claim.reward } : { streak: claim.streak },
        );
        hud?.toast(
          t('daily.claimDone', { name: claim.reward ? rewardName(claim.reward) : '—' }),
          'info',
        );
        openDaily();
      },
      onOpenAchievements: () => hud?.showAchievements(achievementViews()),
      // --- R4b: cosméticos ---
      onOpenCosmetics: () => hud?.showCosmetics(),
      onEquip: (kind, id) => {
        // El perfil es la fuente de verdad; el render solo refleja. Un id que
        // no se posee no llega aca (el panel solo lista lo que `owned` trae).
        profileStore.patch((p) => {
          if (kind === 'cardback') p.cosmetics.equippedCardBack = id;
          else if (kind === 'felt') p.cosmetics.equippedFelt = id;
        });
        if (kind === 'cardback') scene.setCardBack(id);
        else if (kind === 'felt') scene.setFelt(id);
      },
      // --- R5: historial ---
      onOpenHistory: () => hud?.showHistory(),
      // --- Fase 2 ---
      onPickReward: (offerId) => {
        if (!engine.chooseReward(offerId)) hud?.toast(t('log.rewardUnavailable'), 'warn');
      },
      onUseLoadedDie: () => {
        // Habilidad del Simbionte legendario: carga el dado. El motor sortea la
        // cara (RNG sembrado) y aca el cubo la anima hasta apoyarse; recien
        // entonces se muestra el resultado.
        const die = engine.useLoadedDie();
        if (!die) return;
        scene.tossDie(die.face, () => bus.emit('die:settled', { face: die.face }));
      },
      onOpenDeck: () => openDeck(),
      onPurge: doPurge,
      onUpgrade: doUpgrade,
      onEvolve: doEvolve,
      // P1.5 — Persistir estado de paneles UI en el perfil.
      onUiStateChange: (state) => {
        profileStore.patch((p) => {
          p.ui.missionsOpen = state.missionsOpen;
          p.ui.helpOpen = state.helpOpen;
        });
      },
    },
  });

  // P1.5 — Restaurar estado de paneles UI desde el perfil.
  hud.setUiState(profileStore.current.ui);

  hud.bindCollectionProvider(buildCollection);

  // --- Task 7: auto-orden de la mano ---
  // Con un criterio activo, la mano se reordena SOLA. Se reaplica en
  // `state:changed`, pero la DECISION de reordenar no se toma por composicion
  // sino por SECUENCIA: se compara el orden actual contra el que pide el
  // criterio y solo se actua si difieren.
  //
  // Antes se filtraba por una firma de uids ordenados alfabeticamente (firma
  // INDEPENDIENTE del orden): eso evitaba el bucle, pero tambien impedia
  // corregir la mano cuando el orden cambiaba SIN cambiar los miembros — un
  // descarte que vuelve a entrar, una carta que el motor mueve de lugar. La
  // mano se quedaba desordenada sin que nadie lo notara.
  //
  // Ahora el guard real es `current === after`: si la mano ya esta como el
  // criterio pide, no se emite estado y el ciclo se corta solo. No hace falta
  // ninguna firma.
  bus.on('state:changed', () => {
    const round = engine.round;
    if (!round || engine.run.status !== 'playing') return;
    if (stickySortMode === 'default') return;
    const ordered = sortHand(round.hand, stickySortMode);
    const current = round.hand.map((c) => c.uid).join(',');
    const after = ordered.map((c) => c.uid).join(',');
    if (current === after) return;
    engine.reorderHand(ordered.map((c) => c.uid));
  });

  // ==========================================================================
  // Retencion: recompensa diaria y logros
  // ==========================================================================
  //
  // Toda la REGLA vive en `src/retention/*` (puro, sin DOM). Este bloque solo
  // traduce: le da al tracker el contexto de la partida y convierte los eventos
  // en algo visible (panel, toast, banner). El motor no sabe nada de esto.

  /**
   * Nombre visible de un reward. El registry del MOTOR es el que sabe los
   * nombres (es el contenido ya filtrado por DLC), asi que se resuelve aca.
   *
   * FALLBACK: si el id no resuelve a una definicion (contenido retirado, id mal
   * escrito en un JSON de contenido, o un DLC que el jugador no tiene), NO se
   * muestra el id crudo (`joker_golden_mold`), que es ilegible para el jugador.
   * Se "embellece": snake_case -> palabras capitalizadas. Sigue siendo un
   * fallback honesto (no inventa un nombre que no existe), pero deja de parecer
   * un bug de localizacion.
   */
  const prettyId = (id: string): string =>
    id
      .split('_')
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const rewardName = (reward: RetentionReward): string => {
    if (reward.type === 'card') {
      const def = engine.registry.tryGetCard(reward.id);
      return def ? t(def.nameKey) : prettyId(reward.id);
    }
    if (reward.type === 'joker') {
      const def = engine.registry.tryGetJoker(reward.id);
      return def ? t(def.nameKey) : prettyId(reward.id);
    }
    return prettyId(reward.id);
  };
  hud.bindRewardNames(rewardName);

  /** Abre el panel diario con el estado ACTUAL del perfil (no uno cacheado). */
  const openDaily = (): void => {
    const state = evaluateDaily(profileStore.current, Date.now(), dailyTable);
    hud?.showDailyReward(state, dailyTable, () => {
      // Cerro sin reclamar: queda el banner. Es el recordatorio que sobrevive
      // al panel, y es tambien el fallback cuando no hay permiso de avisos.
      if (!evaluateDaily(profileStore.current, Date.now(), dailyTable).alreadyClaimedToday) {
        bus.emit('banner:show', { key: 'banner.daily.ready', kind: 'info' });
      }
      hud?.showMenu();
    });
  };

  /** P4: abre (o re-renderiza) el panel del Pase de Temporada. */
  const showPass = (): void => {
    if (!seasonDef) {
      hud?.toast(t('pass.comingSoon'), 'info');
      return;
    }
    const pass =
      profileStore.current.entitlements.passes.find((p) => p.seasonId === seasonDef.id) ??
      { seasonId: seasonDef.id, xp: 0, premium: false, claimed: [] };
    const panel = buildPassPanel(seasonDef, pass, rewardName, {
      onClaim: (level) => {
        let granted = false;
        profileStore.patch((p) => {
          if (seasonDef) granted = claimTier(p, seasonDef, level);
        });
        if (granted) hud?.toast(t('pass.claimed'), 'info');
        // Re-renderiza para reflejar el nuevo estado (reclamado / mas XP).
        showPass();
      },
      onClose: () => hud?.hideOverlay(),
    });
    hud?.showPanel(panel);
  };

  const achievementViews = () =>
    achievementDefs.map((def) => {
      const unlocked = profileStore.current.achievements.unlockedIds.includes(def.id);
      const max = def.incremental?.max ?? 0;
      return {
        id: def.id,
        name: t(def.nameKey),
        desc: t(def.descKey),
        unlocked,
        current: unlocked ? max : (profileStore.current.achievements.progress[def.id] ?? 0),
        max,
        rewardLabel: def.reward ? rewardName(def.reward) : null,
      };
    });

  /**
   * Contexto de partida para los predicados de logros. Es un snapshot y no el
   * estado vivo: el tracker es puro y no puede salir a buscar nada por su
   * cuenta.
   */
  const achievementContext = (): AchievementContext => {
    const run = engine.run;
    return {
      ante: run?.ante ?? 0,
      money: run?.money ?? 0,
      jokerCount: run?.jokers.length ?? 0,
      // El mazo que Cuenta el jugador: incluye lo que tiene en la mano.
      deckSize: engine.deckSize,
      runs: profileStore.current.stats.runs,
      wins: profileStore.current.stats.wins,
      bestAnte: profileStore.current.stats.bestAnte,
    };
  };

  const achievements = new AchievementTracker({
    bus,
    defs: achievementDefs,
    profile: profileStore,
    getContext: achievementContext,
  });
  achievements.start();

  // --------------------------------------------------------------------------
  // P2.6: misiones de run
  // --------------------------------------------------------------------------
  //
  // El motor NO se auto-escucha: el controlador reenvia cada evento relevante a
  // `advanceMissionsOn`. Asi el motor no necesita saber la forma exacta de los
  // payloads y la lista de eventos queda en un solo lugar (`MISSION_EVENTS`).
  for (const event of MISSION_EVENTS) {
    bus.on(event as GameEventName, (payload) => {
      engine.advanceMissionsOn(event, payload);
    });
  }

  // El aviso de mision cumplida lo pide quien la detecta: el banner sobrevive a
  // los paneles abiertos, y una mision se puede cumplir en plena tienda.
  bus.on('mission:completed', ({ nameKey, reward }) => {
    bus.emit('banner:show', {
      key: 'banner.mission.completed',
      params: { name: t(nameKey), reward: String(reward) },
    });
  });

  // --------------------------------------------------------------------------
  // R2: puertas de contenido (desbloqueo por jugar)
  // --------------------------------------------------------------------------
  //
  // Mismo contexto que los logros (es un snapshot, no el estado vivo) pero
  // DISTINTA responsabilidad: esto no es una medalla, es una PUERTA. Antes de
  // escuchar hay que PUBLICAR las condiciones en el perfil, porque el
  // `PackGate` ya se construyo y lee ese mapa para grisar la Coleccion. Si se
  // publicaran despues, el primer render de la Coleccion mostraria candados sin
  // motivo.
  const unlocks = new UnlockTracker({
    bus,
    defs: unlockDefs,
    profile: profileStore,
    getContext: achievementContext,
  });
  unlocks.publishConditions();
  unlocks.start();

  // El aviso es IN-APP y no opcional: abrir una puerta cambia el pool de
  // sorteos, y enterarse de que hay contenido nuevo es la recompensa. El banner
  // es mas prominente que un toast y sobrevive al panel que este abierto.
  bus.on('unlock:granted', ({ nameKey }) => {
    bus.emit('banner:show', {
      key: 'banner.unlock.granted',
      params: { name: t(nameKey) },
      kind: 'success',
    });
  });

  // Un logro se anuncia SIEMPRE in-app (el banner es mas prominente que un
  // toast y no se pierde detras de un boton) y se amplifica con un aviso del
  // sistema si el jugador lo habilito. El banner es el fallback garantizado:
  // si el permiso de notificaciones se denego, el jugador igual ve el logro.
  bus.on('achievement:unlocked', ({ nameKey }) => {
    const name = t(nameKey);
    bus.emit('banner:show', { key: 'banner.achievement.unlocked', params: { name }, kind: 'success' });
    if (profileStore.current.settings.notifyAchievements) {
      notifier.notify({ title: t('notify.achievement.title'), body: t('notify.achievement.body', { name }) });
    }
  });

  // Un voucher cambia las REGLAS de la run, no una pieza de la mesa: el jugador
  // acaba de pagar por algo que no ve en ningun lado (ni en la mano, ni en los
  // jokers). Sin el aviso, la compra parece no haber hecho nada. El HUD ya
  // tacha la oferta, pero el banner es lo que dice QUE cambio.
  bus.on('voucher:bought', ({ voucher }) => {
    const def = engine.registry.tryGetVoucher(voucher);
    if (!def) return;
    bus.emit('banner:show', {
      key: 'banner.voucher.bought',
      params: { name: t(def.nameKey) },
      kind: 'success',
    });
  });

  // La recompensa diaria amplifica el momento con un aviso del sistema: el
  // "volve mañana por el dia N+1" es el verdadero gancho de retencion. El
  // banner in-app ya lo cubre el panel + el toast, asi que aca solo sumamos la
  // notificacion del SO cuando el permiso esta concedido.
  bus.on('daily:claim', ({ streak, reward }) => {
    if (!profileStore.current.settings.notifyDaily) return;
    const name = reward ? rewardName(reward) : '—';
    notifier.notify({
      title: t('notify.daily.title'),
      body: t('notify.daily.claimed', { day: streak, next: streak + 1, name }),
    });
  });

  // ==========================================================================
  // Fase 5: duelo micelial (hot-seat)
  // ==========================================================================
  //
  // El duelo NO es parte de la run: es un modo aparte, con su propio estado y
  // su propio ciclo. Por eso no toca `engine.run.status` ni el autoguardado —
  // un duelo no se guarda, se juega y se termina.
  //
  // El motor del tablero se carga con `await import()`: `combat` y
  // `MatchController` no viajan hasta que alguien abre un duelo.
  let match: {
    state: BoardState;
    screen: BoardScreen;
    api: typeof import('@engine/board');
  } | null = null;

  const boardDefs = content.registry.boardDefs();
  hud.setBoardAvailable(boardDefs.length > 0);

  const boardResolvers = {
    // Se resuelve contra el registro del MOTOR (ya filtrado por el gate de
    // DLC), no contra el de contenido: el duelo solo puede usar lo que el
    // jugador tiene. Si un id no existe, se muestra el id crudo en vez de
    // romper la pantalla.
    nameOf: (defId: string): string => {
      const def = engine.registry.tryGetCard(defId);
      return def ? t(def.nameKey) : defId;
    },
    colorOf: (defId: string): number => {
      const def = engine.registry.tryGetCard(defId);
      return def ? ELEMENT_COLOR[def.element] : 0x9aa5b1;
    },
    elementOf: (defId: string): ElementType => {
      const def = engine.registry.tryGetCard(defId);
      return def ? def.element : 'neutral';
    },
    rarityOf: (defId: string): Rarity => {
      const def = engine.registry.tryGetCard(defId);
      return def ? def.rarity : 'common';
    },
  };

  /** Redibuja la pantalla con la vista redactada del jugador activo. */
  const paintMatch = (): void => {
    if (!match) return;
    const { state, screen, api } = match;
    screen.update(api.viewFor(state, state.currentPlayer));
  };

  const openBoard = async (): Promise<void> => {
    if (boardDefs.length === 0) {
      hud?.toast(t('board.noData'), 'warn');
      return;
    }
    const api = await import('@engine/board');

    const callbacks = {
      onPlace: (cell: number, uid: string, faceDown: boolean) => {
        const current = match;
        if (!current || current.state.status !== 'placing') return;
        const result = api.applyCommand(current.state, {
          t: 'place',
          by: current.state.currentPlayer,
          cell,
          uid,
          faceDown,
        });
        if (result.error) {
          hud?.toast(result.error, 'warn');
          return;
        }
        current.state = result.state;
        current.screen.logSteps(result.steps);
        current.screen.markFlips(result.steps);
        paintMatch();
      },
      onConcede: () => {
        const current = match;
        if (!current || current.state.status !== 'placing') return;
        const result = api.applyCommand(current.state, {
          t: 'concede',
          by: current.state.currentPlayer,
        });
        current.state = result.state;
        paintMatch();
      },
      onRematch: () => {
        void openBoard();
      },
      onClose: () => {
        match = null;
        hud?.closeBoard();
        hud?.showMenu();
      },
    };

    const seed = (Date.now() ^ 0x5bf03635) >>> 0;
    const state = api.createMatch({ defs: boardDefs, seed });
    const screen = hud?.showBoard(api.viewFor(state, state.currentPlayer), boardResolvers, callbacks);
    if (!screen) return;
    match = { state, screen, api };
  };

  // La purga y la recompensa avisan por toast: son acciones irreversibles y el
  // jugador merece una confirmacion visible, no solo un cambio silencioso.
  bus.on('deck:purged', ({ card }) => hud?.toast(t('deck.purged', { name: t(card.def.nameKey) }), 'info'));

  hud.bindSettingsPatch((patch) => {
    profileStore.patch((p) => {
      Object.assign(p.settings, patch);
    });
    // Cambiar la calidad rearma el DPR, las particulas y (mas adelante) los
    // pases de post-procesamiento: se resuelve contra lo detectado por si el
    // jugador volvio a `auto`.
    if (patch.quality !== undefined) applyQualitySetting();
    if (patch.reduceMotion !== undefined) applyReduceMotionClass(profileStore.current.settings.reduceMotion);
    scene.setMode(engine.run?.status === 'menu' ? 'menu' : 'run', {
      reduceMotion: profileStore.current.settings.reduceMotion,
    });
  });

  // --- Resize / orientacion ---
  let resizeTimer = 0;
  const handleResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => scene.resize(), 90);
  };
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);

  // --- Pausa al perder foco: no gastar bateria dibujando de fondo ---
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scene.stop();
    else scene.start();
  });

  // --- Panel de debug (F3) ---
  if (import.meta.env.DEV) {
    const debug = document.createElement('div');
    debug.style.cssText =
      'position:fixed;bottom:8px;left:8px;font:11px monospace;color:#7f8fa0;background:rgba(0,0,0,.55);padding:5px 9px;border-radius:6px;pointer-events:none;z-index:200;display:none;white-space:pre';
    document.body.appendChild(debug);
    let visible = false;
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'F3') return;
      visible = !visible;
      debug.style.display = visible ? 'block' : 'none';
    });
    window.setInterval(() => {
      if (!visible) return;
      const stats = scene.stats();
      const quality = scene.quality();
      const perf = scene.perfReport();
      const lines = [
        // La calidad va primero: sin esto, un "va lento" no se puede interpretar.
        `tier        ${quality.tier} (${quality.reason}) dpr ${quality.dpr.toFixed(2)}`,
        `fx          ${quality.composer ? 'composer' : 'directo'} bloom ${quality.bloom ? 'si' : 'no'} grade ${quality.gradeMix}`,
        ...Object.entries(stats).map(([key, value]) => `${key.padEnd(11)} ${value}`),
      ];
      if (perf) {
        lines.push(`perf        p50 ${perf.p50.toFixed(1)}ms p95 ${perf.p95.toFixed(1)}ms (${perf.frames})`);
      }
      debug.textContent = lines.join('\n');
    }, 250);
  }

  // --- Arrancar en el MENU ---
  scene.start();
  engine.enterMenu();
  scene.setMode('menu', { reduceMotion: profile.settings.reduceMotion });
  // Antes de dibujar el menu: el chip de ascension lee este estado.
  syncAscension();
  // Cosméticos (R4b): aplica el dorso/tapete guardado y alimenta el panel.
  syncCosmetics();
  syncHistory();
  // Arquetipos: el chip del menu y el panel de "Nueva partida" leen esto.
  syncArchetypes();

  savedRun = await runStore.load();
  if (savedRun) {
    hud.setContinueAvailable(`${t('hud.ante')} ${savedRun.ante} · ${t('ui.seed')} ${savedRun.seed}`);
  }

  loader.setProgress(1);
  loader.hide();

  // --- Primera apertura del dia: la recompensa se ofrece sola ---
  // El boot entra directo al menu y no hay vuelta al menu a mitad de run, asi
  // que este es el UNICO momento donde el daily puede aparecer sin que el
  // jugador lo pida. `?daily=0` lo apaga: lo usa el smoke para poder seguir
  // midiendo la pantalla de inicio sin que un modal se le cruce.
  if (params.get('daily') !== '0') {
    const state = evaluateDaily(profileStore.current, Date.now(), dailyTable);
    if (!state.alreadyClaimedToday) openDaily();
  }

  if (import.meta.env.DEV) {
    console.info(
      `%cFungiFlush%c listo. Packs: ${content.loadedIds.join(', ')}. Guardado: ${saveBackend}. F3 = stats.`,
      'color:#4fd18b;font-weight:bold',
      'color:#93a4b5',
    );
  }

  if (import.meta.env.DEV) {
    Object.assign(window as unknown as Record<string, unknown>, {
      __fungiflush: {
        engine,
        scene,
        hud,
        bus,
        content,
        profileStore,
        runStore,
        achievements,
        // Puertas de contenido (R2): el smoke necesita comprobar que una carta
        // bloqueada por jugar NO entra al pool y que se sabe explicar el motivo.
        unlocks,
        gate,
        collection: buildCollection,
        // El duelo vive en una clausura de `boot()`. Se expone como funcion
        // porque la sesion se reemplaza en cada revancha, y el smoke test
        // necesita leer el estado real (sobre todo para comprobar que la mano
        // del rival NO esta en el DOM).
        board: () => match,
        // Calidad y medicion: el smoke y el panel F3 leen de aca.
        quality: () => scene.quality(),
        perf: () => scene.perfReport(),
        // i18n para tests: traducir nameKeys y verificar que el preview
        // del carrusel coincide con la carta enfocada.
        t,
        // Abre el MAZO en su carrusel 3D (la vista real, no la grilla DOM).
        // Se expone porque el carrusel solo se abria desde el boton del menu o
        // de la tienda, y las herramientas de captura/smoke necesitan medir el
        // HUD movil con ese panel abierto.
        openDeck: () => openDeck(),
      },
    });
  }
}

boot().catch((error) => {
  console.error('[FungiFlush] Fallo el arranque:', error);
  document.body.innerHTML = `<pre style="color:#e05c8a;font:13px monospace;padding:24px">Fallo el arranque:\n${String(error)}</pre>`;
});
