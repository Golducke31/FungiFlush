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
  GameEngine,
  MAX_PLAY_SIZE_DEFAULT,
  bus,
  detectCombos,
  type CardDefinition,
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
import { EntitlementStore } from '@meta/EntitlementStore';
import { PackGate } from '@meta/PackGate';
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
import type { CollectionEntry, CollectionState } from '@ui/CollectionScreen';
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

  const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
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
  const gate = new PackGate(entitlements, content.registry);

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
    profileStore.patch((p) => {
      p.stats.runs += 1;
      if (reason === 'victory') p.stats.wins += 1;
      p.stats.bestAnte = Math.max(p.stats.bestAnte, ante);
    });
  });

  /**
   * Entradas de la coleccion: TODO el contenido del registro (incluido el de
   * DLC sin comprar, que se muestra bloqueado) con su estado y si el jugador
   * ya lo descubrio.
   */
  const buildCollection = (): CollectionEntry[] => {
    const stateOf = (id: string): CollectionState => {
      const state = gate.contentState(id);
      return state === 'allowed' ? 'owned' : state;
    };
    const packTitleOf = (id: string): string | undefined => {
      const packId = content.registry.packOf(id);
      return packId ? content.registry.manifestOf(packId)?.titleKey : undefined;
    };

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
        ...(packTitleOf(card.id) ? { packTitleKey: packTitleOf(card.id) } : {}),
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
        ...(packTitleOf(joker.id) ? { packTitleKey: packTitleOf(joker.id) } : {}),
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

  // --- HUD ---
  hud = new HUD({
    engine,
    root: uiRoot,
    // La UI no conoce los assets: se los presta el render. Asi la miniatura del
    // mazo es el MISMO WebP que la carta en la mano.
    cardArt: (def) => scene.cardArt(def),
    jokerArt: (def) => scene.jokerArt(def),
    appInfo: {
      version: APP_VERSION,
      contentHash: content.registry.contentHash(),
      packs: content.loadedIds,
      skipped: content.skipped,
    },
    callbacks: {
      onPlay: () => engine.playHand(),
      onDiscard: () => engine.discardSelected(),
      onClear: () => engine.clearSelection(),
      onBuy: (offerId) => {
        if (!engine.buyOffer(offerId)) hud?.toast(t('action.cantAfford'), 'warn');
      },
      onReroll: () => {
        if (!engine.rerollShop()) hud?.toast(t('action.cantAfford'), 'warn');
      },
      onSellJoker: (uid) => engine.sellJoker(uid),
      onLeaveShop: () => engine.leaveShop(),
      onChooseBlind: (blindId) => engine.chooseBlind(blindId),
      onRestart: () => {
        savedRun = null;
        hud?.setContinueAvailable(null);
        void runStore.clear();
        engine.startRun();
        scene.setMode('run');
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
        engine.startRun(seed);
        scene.setMode('run');
      },
      onOpenCollection: () => hud?.showCollection(),
      onOpenExpansions: () => hud?.toast(t('store.comingSoon'), 'info'),
      onOpenPass: () => hud?.toast(t('pass.comingSoon'), 'info'),
      onOpenSettings: () => hud?.showSettings(profileStore.current.settings),
      onOpenAbout: () => hud?.showAbout(),
      onOpenBoard: () => {
        void openBoard();
      },
      // --- Fase 2 ---
      onPickReward: (offerId) => {
        if (!engine.chooseReward(offerId)) hud?.toast(t('log.rewardUnavailable'), 'warn');
      },
      onOpenDeck: () => hud?.showDeckBuilder(),
      onPurge: (uid) => {
        if (!engine.purgeCard(uid)) {
          hud?.toast(
            engine.canEditDeck() ? t('deck.cannotAfford') : t('deck.onlyBetweenBlinds'),
            'warn',
          );
          return;
        }
        hud?.showDeckBuilder();
      },
      onUpgrade: (uid) => {
        const card = engine.run.deck.allCards.find((c) => c.uid === uid);
        if (!engine.upgradeCard(uid)) {
          hud?.toast(
            engine.canEditDeck() ? t('deck.cannotUpgrade') : t('deck.onlyBetweenBlinds'),
            'warn',
          );
          return;
        }
        if (card) hud?.toast(t('deck.upgraded', { name: t(card.def.nameKey), level: card.level }), 'info');
        hud?.showDeckBuilder(uid);
      },
      onEvolve: (uid) => {
        const card = engine.run.deck.allCards.find((c) => c.uid === uid);
        if (!engine.evolveCard(uid)) {
          hud?.toast(
            engine.canEditDeck() ? t('evolve.blocked') : t('deck.onlyBetweenBlinds'),
            'warn',
          );
          return;
        }
        if (card) hud?.toast(t('evolve.done', { name: t(card.def.nameKey) }), 'info');
        hud?.showDeckBuilder(uid);
      },
    },
  });

  hud.bindCollectionProvider(buildCollection);

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

  savedRun = await runStore.load();
  if (savedRun) {
    hud.setContinueAvailable(`${t('hud.ante')} ${savedRun.ante} · ${t('ui.seed')} ${savedRun.seed}`);
  }

  loader.setProgress(1);
  loader.hide();

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
        // El duelo vive en una clausura de `boot()`. Se expone como funcion
        // porque la sesion se reemplaza en cada revancha, y el smoke test
        // necesita leer el estado real (sobre todo para comprobar que la mano
        // del rival NO esta en el DOM).
        board: () => match,
        // Calidad y medicion: el smoke y el panel F3 leen de aca.
        quality: () => scene.quality(),
        perf: () => scene.perfReport(),
      },
    });
  }
}

boot().catch((error) => {
  console.error('[FungiFlush] Fallo el arranque:', error);
  document.body.innerHTML = `<pre style="color:#e05c8a;font:13px monospace;padding:24px">Fallo el arranque:\n${String(error)}</pre>`;
});
