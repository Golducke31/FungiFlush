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
import { HISTORY_CAP, type ColonyRunResult } from '@meta/ProfileState';
import {
  DAILY_HARD_CAP,
  applyBlindAward,
  bonusForMission,
  colonyLevelNameKey,
  computeBlindAward,
  dailyRemaining,
  grantSpores,
  levelViews,
  nextLevelInfo,
  type ColonyBonus,
} from '@meta/Colony';
import { createGooglePlayProvider, linkAccount, makeRunResult, queueRunResult, unlinkAccount } from '@meta/Account';
import type { AccountIdentity } from '@meta/Account';
import { formatRank, milestoneViews, percentileOf, rankTierFor, type LeaderboardBoard } from '@meta/Leaderboard';
import { flushPendingResults, refreshBoards } from '@meta/LeaderboardSync';
import {
  createLeaderboardClient,
  createOfflineTransport,
  leaderboardEndpointFromEnv,
} from './net/LeaderboardClient';
import type { DeckCatalogCard, LeaderboardPanelState, LeaderboardScopeView } from '@ui/MenuScreen';
import { ARCHETYPES, biasFor, starterFor } from '@meta/Archetypes';
import { DEFAULT_DECK_ID, MAX_DECK_PRESETS, biasFromDeck, sanitizeDeck, validateDeck } from '@meta/DeckPresets';
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
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';
import { HUD } from '@ui/HUD';
import { sortHand } from '@ui/handSort';
import {
  buildCollectionCarousel,
  buildCollectionGrid,
  type CollectionCarouselFrame,
  type CollectionEntry,
  type CollectionGridFrame,
  type CollectionState,
} from '@ui/CollectionScreen';
import type { CarouselEntryView } from '@render/CardCarousel';
import {
  buildDeckCarouselFrame,
  sortCards,
  type DeckCarouselFrame,
} from '@ui/DeckBuilderScreen';
import { buildPassPanel } from '@ui/EventPassPanel';
import { cardDefFaceUrl, jokerDefFaceUrl, faceComposeCount, faceCacheSize } from '@ui/cardArt';
import {
  TUTORIAL_SEED,
  TUTORIAL_STEPS,
  allStepIds,
  currentStep,
  isFinalStep,
  type TutorialContext,
  type TutorialStepId,
} from '@meta/Tutorial';
import type { PackCardView } from '@render/PackOpening';
import {
  DEFAULT_CARDS_PER_PACK,
  EXPANSION_PACK_ID,
  consumeExpansionPack,
  consumePack,
  drawPack,
  grantExpansionPack,
  grantPack,
  rollPackDrop,
  rollPackKind,
  type PackDropKind,
  type PackRarity,
} from '@meta/Packs';
import type { BoardScreen } from '@ui/BoardScreen';
import { attachAudioHooks, audio } from '@audio/AudioBus';
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

  // --- Audio ---
  attachAudioHooks();

  /**
   * Los sliders de Ajustes escriben `sfxVolume`/`musicVolume` en el perfil, pero
   * hasta ahora NADIE los leia: eran decorativos. Aca se aplican al grafo, al
   * arrancar y en cada cambio.
   */
  const applyAudioVolumes = (): void => {
    const settings = profileStore.current.settings;
    audio.setVolume('sfx', settings.sfxVolume);
    audio.setVolume('music', settings.musicVolume);
  };
  applyAudioVolumes();

  /** Musica por estado: el tema del menu en el menu, el de partida en el resto. */
  const syncMusic = (): void => {
    audio.playMusic((engine.run?.status ?? 'menu') === 'menu' ? 'menu' : 'ingame');
  };
  bus.on('state:changed', syncMusic);

  /**
   * El navegador arranca el `AudioContext` SUSPENDIDO hasta el primer gesto, asi
   * que la musica no puede sonar antes del primer tap. Se desbloquea una sola
   * vez y ahi si arranca.
   */
  const unlockAudio = (): void => {
    audio.unlock();
    applyAudioVolumes();
    // `playMusic(null)` limpia el estado que quedo pendiente mientras no habia
    // contexto; sin esto, el guard de "misma musica" impediria arrancar.
    audio.playMusic(null, 0);
    syncMusic();
    void audio.load();
  };
  window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // En movil, ocultar la pestana tiene que pausar: si no, sigue sonando atras.
  document.addEventListener('visibilitychange', () => audio.handleVisibility(document.hidden));

  // --- Autoguardado ---
  // Se escribe 1.5 s despues del ultimo cambio de estado, asi que una mano
  // entera produce UNA escritura, no doscientas. El menu no se guarda nunca.
  let savedRun: RunSaveData | null = null;

  /**
   * Texto del chip "Continuar" para un guardado dado (`null` = no hay run).
   *
   * Es la UNICA traduccion de "hay guardado" a "texto del chip": antes el
   * string se armaba inline en el boot, y cualquier otro punto del ciclo de vida
   * que quisiera refrescar el chip tenia que repetir la formula (o quedarse
   * desactualizado, que es lo que pasaba).
   */
  const continueLabelFor = (save: RunSaveData | null): string | null =>
    save ? `${t('hud.ante')} ${save.ante} · ${t('ui.seed')} ${save.seed}` : null;

  /** Empuja al HUD el estado de "Continuar" derivado de `savedRun`. */
  const syncContinueState = (): void => hud?.setContinueAvailable(continueLabelFor(savedRun));

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
  // SIMBIONTES: faltaba. La coleccion solo marcaba las CARTAS (`card:drawn` /
  // `card:created`), asi que comprar un simbionte nunca lo sumaba a
  // `seenCardIds` y la pestaña "Simbiontes" quedaba en 0/25 para siempre.
  bus.on('joker:added', ({ joker }) => markSeen(joker.def.id));
  // Los simbiontes de una partida RESTAURADA (cargar un guardado) entran por
  // `restore()`, que no emite `joker:added`. Marcarlos al arrancar la run hace
  // que un perfil viejo se ponga al dia solo.
  bus.on('run:start', () => {
    for (const joker of engine.run?.jokers ?? []) markSeen(joker.def.id);
  });

  // --------------------------------------------------------------------------
  // Colonia Fungi: Esporas de Colonia (meta-progresion)
  // --------------------------------------------------------------------------
  //
  // CAPA SEPARADA DEL COMBATE. El motor NO sabe que existe: superar un Ciego
  // acredita Esporas de Colonia en el perfil, y la Colonia no altera reglas,
  // cartas ni puntuaciones (no compra cartas mas fuertes, no da Sustrato ni
  // Esporas de partida, no recupera manos ni descartes).
  //
  // `runColony` es el acumulador de la run EN CURSO: es lo que la pantalla de
  // resultados muestra como "+N Esporas de Colonia". Se resetea en `run:start`.
  let runColony = {
    runId: '',
    startedAt: '',
    spores: 0,
    bonuses: [] as ColonyBonus[],
  };

  const pushColonyResult = (): void => {
    hud?.setColonyResult({
      spores: runColony.spores,
      bonuses: runColony.bonuses.map((b) => ({ ...b })),
    });
  };

  bus.on('run:start', () => {
    runColony = {
      runId: `${engine.run.seed}-${Date.now()}`,
      startedAt: new Date().toISOString(),
      spores: 0,
      bonuses: [],
    };
    pushColonyResult();
  });

  // Superar un Ciego es la fuente PRINCIPAL de Esporas de Colonia.
  bus.on('round:win', () => {
    const run = engine.run;
    const round = engine.round;
    if (!run || !round) return;
    const now = Date.now();
    const award = computeBlindAward(profileStore.current.colony, {
      ante: run.ante,
      blindIndex: run.blindIndex,
      // `history` guarda las manos jugadas del Ciego: si solo hay una, se
      // supero en la primera mano (bonificacion chica, el grueso es el Ciego).
      firstHandClear: round.history.length <= 1,
      discardsLeft: round.discardsLeft,
      now,
    });

    // Los Sobres ya NO caen en cualquier ciego: solo los suelta un JEFE, y no
    // siempre. `round:win` se emite ANTES de que `leaveShop` avance el
    // `blindIndex`, asi que en este instante `round.blind` es el ciego recien
    // vencido. `tier === 'boss'` es la etiqueta de contenido; `effects.length`
    // es el respaldo para contenido viejo que no declara `tier`.
    const blind = round.blind;
    const isBoss = blind?.tier === 'boss' || (blind?.effects?.length ?? 0) > 0;
    // RNG sembrado con el reloj: un drop NO necesita ser reproducible (a
    // diferencia de la run) y sembrarlo con la semilla de la partida filtraria
    // el estado del juego a la economia meta. Mismo criterio que `openPacks`.
    const dropRng = new RNG((Date.now() ^ 0x5f3759df) >>> 0);

    // El sorteo se resuelve ANTES del patch (que es sincrono): asi el resultado
    // y el tipo de sobre quedan fijos y el `patch` solo los aplica.
    const dropRoll = isBoss
      ? rollPackDrop(dropRng, profileStore.current.packs.bossMisses)
      : null;
    const dropKind: PackDropKind = dropRoll?.drop ? rollPackKind(dropRng) : 'base';

    let levelAfter = 0;
    let newRewards: string[] = [];
    let packTotal = 0;
    profileStore.patch((p) => {
      const result = applyBlindAward(p.colony, award, now);
      levelAfter = result.levelAfter;
      newRewards = result.newRewards;
      if (!dropRoll) return;
      // Pity: si ya fallo `PACK_PITY_AFTER` Jefes seguidos, este lo entrega si o
      // si y el contador vuelve a cero.
      p.packs.bossMisses = dropRoll.misses;
      if (!dropRoll.drop) return;
      packTotal =
        dropKind === 'expansion'
          ? grantExpansionPack(p.packs, 1)
          : grantPack(p.packs, 1);
    });

    runColony.spores += award.total;
    runColony.bonuses.push(...award.bonuses);
    pushColonyResult();

    if (newRewards.length > 0) {
      bus.emit('banner:show', {
        key: 'banner.colony.levelUp',
        params: { level: levelAfter },
        kind: 'success',
      });
    } else if (packTotal > 0) {
      // Sin subida de nivel, el aviso es el sobre: asi el jugador se entera de
      // que tiene algo para abrir sin tener que entrar a la Coleccion.
      bus.emit('banner:show', {
        key: dropKind === 'expansion' ? 'banner.pack.expansion' : 'banner.pack.earned',
        params: { count: packTotal },
        kind: 'success',
      });
    }
  });

  // Una mision cumplida tambien alimenta a la colonia (bonificacion chica).
  bus.on('mission:completed', () => {
    const bonus = bonusForMission();
    profileStore.patch((p) => grantSpores(p.colony, bonus.amount, Date.now()));
    runColony.spores += bonus.amount;
    runColony.bonuses.push(bonus);
    pushColonyResult();
  });

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
      // Colonia (v4): el resultado de la run queda ENCOLADO para el sync.
      // Anti-trampa: se encola el RESULTADO (modo, Ciegos superados, score y
      // version), nunca las Esporas calculadas en el cliente: el servidor las
      // recalcula. Sin cuenta vinculada el estado queda `offline` y la cola
      // espera (el juego es offline-first).
      const colonyResult: ColonyRunResult = makeRunResult({
        runId: runColony.runId || `${engine.run.seed}-${Date.now()}`,
        startedAt: runColony.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
        mode: engine.run.ascension > 0 ? 'ascension' : 'classic',
        highestBlind: ante,
        completedBlinds: engine.run.stats.blindsCleared,
        scoreSummary: engine.run.totalScore,
        clientVersion: APP_VERSION,
      });
      queueRunResult(p, colonyResult);
    });
    // El desglose de la run ya esta cerrado: el panel de resultados lo lee.
    pushColonyResult();
    // Ranking (V1.3): subir el resultado y refrescar los tableros. Es
    // best-effort y no bloquea el panel: sin cuenta o sin servidor no hace nada.
    if (leaderboardTransport.enabled && accountIdentity()) void syncLeaderboard();
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
     * Id del pack de una pieza. `base` cuando el registro no lo sabe: un pack
     * desconocido nunca debe dejar la entrada sin seccion en la grilla.
     */
    const packIdOf = (id: string): string => content.registry.packOf(id) ?? 'base';
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
        family: card.family,
        packId: packIdOf(card.id),
        descKey: card.descKey,
        substrate: card.baseSubstrate,
        spores: card.baseSpores,
        // Cara real: NO se compone aca (componer 101 caras al abrir la
        // Coleccion era lo que la hacia lenta). Se pasa un proveedor perezoso
        // que la compone solo cuando la celda entra en viewport; la composicion
        // esta memoizada en `cardArt.ts`, asi que reabrir no la recalcula.
        faceProvider: () => cardDefFaceUrl(card, t, scene.cardArt(card)),
        // Cuantas copias se obtuvieron de sobres: la Coleccion muestra "xN" en
        // vez de repetir la carta. Los jokers no llevan contador (los sobres
        // nunca dan jokers).
        count: profile.collection.ownedCounts[card.id] ?? 0,
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
        // Los Simbiontes no tienen familia micologica propia: la grilla los
        // separa con `kind === 'joker'`, no con la familia. Se guarda
        // `agaricaceae` (la misma que usa la cara de la tienda) para no dejar el
        // campo vacio.
        family: 'agaricaceae',
        packId: packIdOf(joker.id),
        descKey: joker.descKey,
        faceProvider: () => jokerDefFaceUrl(joker, t, scene.jokerArt(joker)),
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

  /**
   * Muestra la etiqueta de una carta. La comparten las DOS vias:
   *   - `onHoverChange`  -> raton (y tactil MIENTRAS el dedo se mueve).
   *   - `onLongPressChange` -> mantener el dedo quieto, que es la unica via
   *     tactil real: el hover necesita `pointermove` y no llega si no hay
   *     movimiento.
   * El texto es el mismo en las dos: si se separaran, la etiqueta de movil
   * diria otra cosa que la de escritorio.
   */
  const showCardTooltip = (card: CardInstance): void => {
    if (!hud) return;
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
  };

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
        showCardTooltip(card);
      },
      onLongPressChange: (card) => showCardTooltip(card),
      // Simbionte de la mesa: mantener pulsado abre SU etiqueta rica (habilidad,
      // rareza y descripcion). Es la via que reemplaza a la linea de habilidad
      // que la caja del HUD dejo de mostrar.
      onLongPressJoker: (joker) => hud?.showJokerTooltip(joker, lastPointer.x, lastPointer.y),
      onScorePopup: (x, y, text, color, combo) => hud?.popup(x, y, text, color, combo ?? 0),
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
          // Si la carta arrastrada es parte de una SELECCION multiple, se
          // descarta toda la seleccion: es lo que el gesto promete. Una carta
          // suelta (no seleccionada) se descarta sola.
          const uids = isSelected && round.selected.length > 1 ? [...round.selected] : [uid];
          if (!engine.discardCards(uids)) hud?.toast(t('action.noDiscards'), 'warn');
        }
      },
      /**
       * El jugador TOCA la pila de descarte, sin arrastrar. Es la alternativa al
       * drag (mas comoda en pantallas chicas): descarta la seleccion actual. Sin
       * cartas seleccionadas el gesto no hace nada.
       */
      onDiscardPileTap: () => {
        const round = engine.round;
        if (!round || round.selected.length === 0) return;
        if (!engine.discardCards([...round.selected])) hud?.toast(t('action.noDiscards'), 'warn');
      },
      /**
       * Posicion en pantalla de las pilas: el HUD cuelga sus etiquetas ("MAZO /
       * N ROBABLES", "DESCARTE / N CARTAS") de ahi. Se emite al reencuadrar.
       */
      onPileAnchors: (anchors) => hud?.setPileAnchors(anchors),
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

  /**
   * Cambia la Coleccion de la GRILLA al carrusel 3D ("Exhibicion"). Lo registra
   * `openCollection`; el boton `data-act="collection-view-carousel"` de la grilla
   * lo invoca. `null` fuera de la Coleccion.
   */
  let viewExhibition: (() => void) | null = null;

  // ==========================================================================
  // Tutorial guiado (Frente 1)
  // ==========================================================================
  //
  // El tutorial es una RUN NORMAL con `run.tutorial === true`: mismas reglas,
  // mismo balance. El GUION vive en `src/meta/Tutorial.ts` (puro) y aca solo se
  // lleva el historial que los pasos consultan y el disparo del paso correcto.
  //
  // El motor NUNCA sabe que hay un tutorial: no hay `if (tutorial)` en el engine.

  /** Ultimo paso ya visto, o `null` antes del primero. */
  let tutorialStep: TutorialStepId | null = null;
  /** Historial que los pasos consultan (`require`). Se resetea por ciego. */
  let tutorialCtx: {
    handsPlayed: number;
    lastComboKind: TutorialContext['lastComboKind'];
    visitedShop: boolean;
    sawPurge: boolean;
  } = { handsPlayed: 0, lastComboKind: null, visitedShop: false, sawPurge: false };

  /** El contexto completo del paso, leido del motor VIVO. */
  const tutorialContext = (): TutorialContext => ({
    status: engine.run?.status ?? 'menu',
    blindIndex: engine.run?.blindIndex ?? 0,
    ante: engine.run?.ante ?? 1,
    selectedCount: engine.round?.selected?.length ?? 0,
    handsPlayed: tutorialCtx.handsPlayed,
    lastComboKind: tutorialCtx.lastComboKind,
    visitedShop: tutorialCtx.visitedShop,
    sawPurge: tutorialCtx.sawPurge,
  });

  /** Apaga el tutorial: quita la capa y libera la run. */
  const endTutorial = (): void => {
    if (engine.run) engine.run.tutorial = false;
    hud?.hideTutorialStep();
    tutorialStep = null;
    profileStore.patch((p) => {
      p.seenTutorial = true;
    });
  };

  /**
   * Muestra el paso que corresponde AHORA. Se llama en cada cambio de estado y
   * cuando el jugador avanza o hace la accion que el paso pedia.
   *
   * REGLA CLAVE: si no hay un paso para el estado actual, la capa se OCULTA
   * pero el tutorial SIGUE VIVO. Esto es lo que permite que un paso de `tap`
   * ("elegi tu ciego y tocá Luchar") se cierre y el juego quede jugable hasta
   * que el siguiente `state:changed` traiga el estado en el que vive el paso
   * siguiente. Dejar la capa puesta mostrando el paso viejo congelaba el guion.
   */
  const advanceTutorial = (): void => {
    if (!engine.run?.tutorial) return;
    const ctx = tutorialContext();
    const step = currentStep(tutorialStep, ctx);
    if (!step) {
      // No hay mas pasos para este estado: se esconde la capa (sin cerrar el
      // tutorial) y se espera al proximo cambio de estado.
      hud?.hideTutorialStep();
      // Unico caso de cierre: ya se mostro el paso final y no queda nada mas.
      if (tutorialStep === 'ante_complete') endTutorial();
      return;
    }
    tutorialStep = step.id;
    hud?.showTutorialStep(
      {
        title: t(step.titleKey),
        body: t(step.bodyKey),
        stepOf: t('tutorial.stepOf', {
          n: allStepIds().indexOf(step.id) + 1,
          total: TUTORIAL_STEPS.length,
        }),
        anchor: step.anchor,
        waitsForAction: step.advanceOn === 'player_action',
        isLast: isFinalStep(step.id),
      },
      () => {
        if (isFinalStep(step.id)) endTutorial();
        else advanceTutorial();
      },
      // "Saltar paso": marca el paso como visto y busca el siguiente.
      () => advanceTutorial(),
      () => endTutorial(),
    );
  };

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
      // Tres motivos posibles, en orden de prioridad: cupo agotado > dinero >
      // estado. El aviso tiene que decir el motivo REAL, no siempre "no te
      // alcanza" (que era el unico mensaje cuando no habia tope).
      const reason =
        engine.purgesLeft <= 0
          ? t('deck.purgeNone')
          : engine.canEditDeck()
            ? t('deck.cannotAfford')
            : t('deck.onlyBetweenBlinds');
      hud?.toast(reason, 'warn');
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

  // --- Deck propio ---
  // El HUD no conoce ni el registro ni el perfil: se le empuja el CATALOGO ya
  // filtrado (solo cartas que el jugador puede poner) y el mazo guardado.
  //
  // El filtro es la union de dos puertas:
  //   - `gate.contentState(id) === 'allowed'`: la carta esta desbloqueada (pack
  //     comprado o ganada jugando).
  //   - es una CARTA (no un joker): un mazo se arma con cartas.
  // No se exige `ownedCounts`: el contador de sobres es PROGRESO, no un
  // requisito. Exigirlo dejaria el modo inutil para quien no abrio sobres
  // todavia, que es justo quien mas lo quiere.
  const MIN_COLONY_LEVEL_FOR_DECK = 3;

  const buildDeckCatalog = (): DeckCatalogCard[] => {
    const out: DeckCatalogCard[] = [];
    for (const def of content.registry.poolOf('card') as CardDefinition[]) {
      if (gate.contentState(def.id) !== 'allowed') continue;
      out.push({
        id: def.id,
        nameKey: def.nameKey,
        element: def.element,
        rarityColor: hexToCss(RARITY_COLOR[def.rarity] ?? ELEMENT_COLOR.neutral),
        faceUrl: cardDefFaceUrl(def, t, scene.cardArt(def)),
      });
    }
    // Orden estable por elemento y luego id: el jugador encuentra la carta por
    // su afinidad, no por el orden de carga del glob de packs.
    out.sort((a, b) => a.element.localeCompare(b.element) || a.id.localeCompare(b.id));
    return out;
  };

  const currentDeckEntries = (): Array<{ cardId: string; copies: number }> => {
    const decks = profileStore.current.decks;
    const preset = decks.presets.find((p) => p.id === decks.selectedId) ?? decks.presets[0];
    if (!preset) return [];
    // Se sanea contra el catalogo: un guardado apuntando a una carta retirada o
    // desbloqueada-perdida no debe mostrar una celda fantasma ni romper el panel.
    const known = new Set((content.registry.poolOf('card') as CardDefinition[]).map((d) => d.id));
    return sanitizeDeck(preset.entries, [...known]);
  };

  const syncDeck = (): void => {
    const level = profileStore.current.colony.level;
    hud?.setCustomDeck({
      catalog: buildDeckCatalog(),
      entries: currentDeckEntries(),
      // Puerta de progreso: se desbloquea con la Colonia (nivel 3 ~ 220 esporas).
      // El modo es potente: darlo desde el minuto uno le quita valor a los
      // arquetipos. El aviso dice exactamente que hace falta.
      locked: level < MIN_COLONY_LEVEL_FOR_DECK,
      unlockLevel: MIN_COLONY_LEVEL_FOR_DECK,
    });
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

  // El HUD se sincroniza con el barrido de pantalla: baja y se desvanece al
  // arrancar, y vuelve con rebote al terminar (ver `HUD.setTransitionProgress`).
  // Se registra ANTES de crear el HUD a proposito: el callback lee `hud` cuando
  // corre, no cuando se registra.
  scene.onTransitionProgress((p) => hud?.setTransitionProgress(p));

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
      onClear: () => engine.clearSelection(),
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
        syncContinueState();
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
       *
       * El `clear()` es ASINCRONO: el chip se apaga ya (punto 2), pero recien
       * cuando el borrado termina se vuelve a leer el disco. Leerlo antes
       * resucitaria el guardado viejo y el chip reapareceria solo.
       */
      onQuitToMenu: () => {
        savedRun = null;
        syncContinueState();
        void runStore.clear().then(() => {
          void runStore.load().then((restored) => {
            savedRun = restored;
            syncContinueState();
          });
        });
        // El estado meta se empuja ANTES de `enterMenu`: el panel del menu se
        // construye en ese cambio de estado y no se vuelve a dibujar.
        syncMenuMeta();
        engine.enterMenu();
        scene.setMode('menu', { reduceMotion: profileStore.current.settings.reduceMotion });
      },
      onContinueRun: () => {
        if (!savedRun) return;
        if (engine.restore(savedRun)) {
          savedRun = null;
          syncContinueState();
          scene.setMode('run');
        } else {
          hud?.toast(t('log.saveIncompatible'), 'warn');
        }
      },
      onToggleLanguage: () =>
        toggleLanguage().then(() => {
          document.documentElement.lang = currentLanguage();
        }),
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
      // --- Tutorial guiado (Frente 1) ---
      // Arranca una run NORMAL con semilla fija y arquetipo clasico, y marca
      // `tutorial`. El motor no cambia ninguna regla: el guion lo lleva la UI.
      onStartTutorial: () => {
        void runStore.clear();
        engine.setArchetypeLoadout(undefined, []);
        engine.startRun(TUTORIAL_SEED, 0, '');
        if (engine.run) engine.run.tutorial = true;
        scene.setMode('run');
        tutorialStep = null;
        // El primer paso se empuja cuando el panel de ciego ya esta montado.
        window.setTimeout(() => advanceTutorial(), 520);
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
      // --- Deck propio ---
      // El mazo se persiste en CADA cambio (no hay boton de guardar): cerrar el
      // panel con la X no puede perder el trabajo de armar 20 cartas a mano.
      onDeckChanged: (entries) => {
        profileStore.patch((p) => {
          const preset = p.decks.presets[0] ?? { id: DEFAULT_DECK_ID, name: '', entries: [] };
          preset.entries = entries.map((e) => ({ ...e }));
          // Se reemplaza el array para que el patch sea serializable (JSON plano).
          p.decks.presets = [preset, ...p.decks.presets.slice(1, MAX_DECK_PRESETS)];
        });
      },
      // Arrancar con el mazo propio: mismo camino que el arquetipo (el motor no
      // conoce `decks`, se le inyecta el mazo y el sesgo YA resueltos).
      onStartRunWithDeck: (entries) => {
        // Doble red: la UI ya deshabilita el boton, pero el perfil es la fuente
        // de verdad. Se valida contra el catalogo antes de arrancar.
        const catalogIds = buildDeckCatalog().map((c) => c.id);
        if (!validateDeck(entries, catalogIds, catalogIds).ok) {
          hud?.toast(t('customDeck.invalid'), 'warn');
          return;
        }
        void runStore.clear();
        // El id de arquetipo va VACIO: un mazo custom no es un arquetipo con
        // nombre. La run queda con `archetype: ''` (clasico) para que el
        // historial no la etiquete con algo que no eligio.
        const bias = biasFromDeck(entries, (cardId) => {
          const def = (content.registry.poolOf('card') as CardDefinition[]).find(
            (d) => d.id === cardId,
          );
          return def?.element;
        });
        engine.setArchetypeLoadout(entries, bias);
        // Se persiste lo que efectivamente se jugo, sanea por si el perfil venia
        // de un guardado viejo.
        const clean = sanitizeDeck(entries, catalogIds);
        profileStore.patch((p) => {
          const preset = p.decks.presets[0] ?? { id: DEFAULT_DECK_ID, name: '', entries: [] };
          preset.entries = clean.map((e) => ({ ...e }));
          p.decks.presets = [preset, ...p.decks.presets.slice(1, MAX_DECK_PRESETS)];
          p.decks.selectedId = preset.id;
        });
        engine.startRun(seed, profileStore.current.ascension.selected, '');
        scene.setMode('run');
        if (!profileStore.current.seenTutorial) {
          window.setTimeout(() => hud?.showTutorial(), 420);
        }
      },
      onPanelOpened: (isCarousel) => {
        // Un panel que NO monta sobre el carrusel apaga la escena 3D: si no, el
        // anillo quedaria vivo detras del panel nuevo (p. ej. el mazo DOM).
        if (!isCarousel) scene.setCarousel(null);
      },
      onOpenCollection: () => openCollection(),
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
        syncMenuMeta();
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
      // --- Colonia Fungi (meta-progresion) ---
      onOpenColonyRewards: () => hud?.showColonyRewards(),
      onRefreshLeaderboard: () => void syncLeaderboard(),
      onLinkAccount: () => void onLinkAccount(),
      onUnlinkAccount: () => onUnlinkAccount(),
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
  // El chip "Continuar" se re-deriva al CONSTRUIR el menu (no se cachea): asi
  // cualquier via que lleve al menu — boot, salir de la run, cerrar un panel —
  // lo dibuja con el estado REAL de `savedRun`, sin depender del orden en que
  // se llamaron `setContinueAvailable` y `enterMenu`.
  hud.bindContinueProvider(() => continueLabelFor(savedRun));

  // --- Fase 3: auto-orden de la mano ---
  // Si el ajuste `autoSortHand` esta activo (por defecto SI), la mano se ordena
  // SOLA: Familia -> Sustrato descendente -> orden original. Se reaplica en
  // `state:changed`, y la DECISION de reordenar se toma por SECUENCIA: se
  // compara el orden actual contra el que pide el criterio y solo se actua si
  // difieren.
  //
  // El guard real es `current === after`: si la mano ya esta como el criterio
  // pide, no se emite estado y el ciclo se corta solo. No hace falta ninguna
  // firma de uids, que ademas impediria corregir la mano cuando cambia el orden
  // SIN cambiar los miembros (un descarte que vuelve a entrar).
  bus.on('state:changed', () => {
    const round = engine.round;
    if (!round || engine.run.status !== 'playing') return;
    if (!profileStore.current.settings.autoSortHand) return;
    // NUNCA reordenar mientras el jugador arrastra: el reacomodo moveria las
    // cartas bajo el dedo y el gesto se sentiria roto.
    if (scene.isDragging()) return;
    const ordered = sortHand(round.hand, 'auto');
    const current = round.hand.map((c) => c.uid).join(',');
    const after = ordered.map((c) => c.uid).join(',');
    if (current === after) return;
    engine.reorderHand(ordered.map((c) => c.uid));
  });

  // ==========================================================================
  // Tutorial guiado (Frente 1) — disparo de pasos
  // ==========================================================================
  //
  // El motor no sabe que hay un tutorial: aca se ESCUCHA el mismo `bus` que
  // alimenta al HUD y se traduce el estado a "toca tal paso". Cada paso espera
  // que el contexto tenga un valor concreto, asi que se lleva el historial que
  // los pasos consultan.

  // Un ciego nuevo resetea el historial del ciego anterior: `select_cards` y
  // `play_hand` vuelven a aplicar en el ciego 2 y en el Jefe.
  bus.on('round:start', () => {
    if (!engine.run?.tutorial) return;
    tutorialCtx = { handsPlayed: 0, lastComboKind: null, visitedShop: false, sawPurge: false };
  });

  // `state:changed` es el unico punto de entrada: cubre blind_select, playing,
  // reward y shop sin depender de que cada transicion avise.
  bus.on('state:changed', () => {
    if (!engine.run?.tutorial) return;
    advanceTutorial();
  });

  bus.on('hand:dealt', () => {
    if (!engine.run?.tutorial) return;
    advanceTutorial();
  });

  // El combo de la mano que se cerro. Decide si `combo_hint` aparece.
  bus.on('score:hand', ({ breakdown }) => {
    if (!engine.run?.tutorial) return;
    const combos = (breakdown as { combos?: Array<{ id: string }> }).combos ?? [];
    const first = combos[0]?.id ?? '';
    tutorialCtx.lastComboKind = first.startsWith('family:')
      ? 'family'
      : first.startsWith('element:')
        ? 'element'
        : first.startsWith('diversity:')
          ? 'diversity'
          : null;
  });

  // Contar manos jugadas: es lo que hace que `play_hand` deje de aplicar.
  bus.on('round:win', () => {
    if (!engine.run?.tutorial) return;
    tutorialCtx.handsPlayed += 1;
  });
  bus.on('score:changed', () => {
    if (!engine.run?.tutorial) return;
    // Cada puntaje de mano es una mano jugada mas (el `round:win` es el cierre
    // del ciego, no de la mano).
    if (engine.run.status === 'playing') tutorialCtx.handsPlayed += 1;
  });

  // Purga y tienda: los pasos `shop_intro` / `purge_intro` dejan de aplicar una
  // vez que el jugador YA hizo la accion.
  bus.on('deck:purged', () => {
    tutorialCtx.sawPurge = true;
  });
  bus.on('shop:enter', () => {
    if (!engine.run?.tutorial) return;
    tutorialCtx.visitedShop = true;
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
      syncMenuMeta();
      hud?.showMenu();
    });
  };

  /**
   * P4: abre (o re-renderiza) el panel del Pase de Temporada.
   *
   * `returnTo` es a donde vuelve el cierre. Antes el cierre llamaba a
   * `hud.hideOverlay()`, que anima la salida y VACIA el overlay sin resetear el
   * estado ni re-renderizar: quedaba una pantalla vacia sobre la escena del
   * menu, sin cromo ni botones, y el juego parecia congelado. Ahora, como
   * Cosmeticos e Historial, el panel declara a donde vuelve; sin destino
   * explicito se cae a `closePanel()`, que reconstruye la pantalla del estado
   * actual (el menu, si se abrio desde ahi).
   */
  const showPass = (returnTo?: () => void): void => {
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
        // Conserva el destino: reclamar un tier no debe perder de donde vino.
        showPass(returnTo);
      },
      onClose: () => (returnTo ? returnTo() : hud?.closePanel()),
    });
    hud?.showPanel(panel);
  };

  /**
   * Abre la Coleccion sobre el CARRUSEL 3D: el marco DOM solo manda los filtros
   * y el detalle; el anillo esta en el canvas y recibe el input.
   *
   * Es una funcion con nombre (y no un callback anonimo) porque los Sobres
   * necesitan reabrirla: cerrar el overlay de apertura devuelve al jugador a la
   * Coleccion, que es de donde salio.
   */
  const openCollection = (): void => {
    const all = buildCollection();
    const toViews = (list: CollectionEntry[]): CarouselEntryView[] =>
      list.map((e) => ({
        uid: e.id,
        discovered: e.seen,
        ...(e.kind === 'joker' ? { jokerId: e.id } : { cardId: e.id }),
      }));

    // --- Vista GRILLA (por defecto) ---
    // Es la superficie de GESTION: agrupa por pack y familia y deja ver los
    // huecos de un vistazo. El carrusel 3D sigue disponible como "Exhibición".
    const gridFrame: CollectionGridFrame = buildCollectionGrid(all, {
      onClose: () => {
        carouselActivate = null;
        scene.setCarousel(null);
        hud?.closePanel();
      },
      onOpenStore: () => hud?.toast(t('store.comingSoon'), 'info'),
      // El Pase y los Cosmeticos vuelven a la COLECCION, que es de donde se
      // abren. Sin `returnTo` el default del cierre era `showMenu()` (y en el
      // Pase, un `hideOverlay()` que dejaba la pantalla vacia).
      onOpenPass: () => showPass(() => openCollection()),
      onOpenExhibition: () => viewExhibition?.(),
      onOpenCosmetics: () => {
        carouselActivate = null;
        scene.setCarousel(null);
        hud?.showCosmetics(() => openCollection());
      },
      onOpenPacks: () => {
        carouselActivate = null;
        scene.setCarousel(null);
        openPacks();
      },
      packsPending: profileStore.current.packs.pending,
      onOpenExpansionPacks: () => {
        carouselActivate = null;
        scene.setCarousel(null);
        openPacks('expansion');
      },
      expansionPacksPending: profileStore.current.packs.expansionPending,
    });

    // --- Vista EXHIBICION (carrusel 3D) ---
    // Se conserva porque es la unica forma de girar una carta en 3D, pero ya no
    // es la vista por defecto: obligar a recorrer 77 entradas para encontrar una
    // carta era el problema.
    const openExhibition = (): void => {
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
        // Igual que en la grilla: la Exhibicion devuelve a la Coleccion.
        onOpenPass: () => showPass(() => openCollection()),
        onOpenCosmetics: () => {
          carouselActivate = null;
          scene.setCarousel(null);
          hud?.showCosmetics(() => openCollection());
        },
        onOpenPacks: () => {
          carouselActivate = null;
          scene.setCarousel(null);
          openPacks();
        },
        packsPending: profileStore.current.packs.pending,
        onOpenExpansionPacks: () => {
          carouselActivate = null;
          scene.setCarousel(null);
          openPacks('expansion');
        },
        expansionPacksPending: profileStore.current.packs.expansionPending,
      });
      carouselActivate = (index) => frame.setFocus(index);
      hud?.showPanel(frame.panel, { carousel: true });
      scene.setCarousel(toViews(all), focusHandler);
    };

    viewExhibition = openExhibition;
    hud?.showPanel(gridFrame.panel, { collectionGrid: true });
  };

  /**
   * Abre un Sobre. El sorteo vive en `Packs.ts` (puro, con `RNG`); aca solo se
   * resuelve cada carta a su vista (nombre, rareza, cara con arte real) y se
   * monta el overlay.
   *
   * `kind` distingue el sobre BASE del de EXPANSION: el de expansion solo saca
   * cartas del pack `EXPANSION_PACK_ID`, asi que su pool se filtra por origen.
   *
   * El RNG se siembra con el reloj: un sobre NO necesita ser reproducible (a
   * diferencia de una run), y sembrarlo con la semilla de la partida filtraria
   * el estado del juego a la economia meta.
   */
  const openPacks = (kind: PackDropKind = 'base'): void => {
    const inventory = profileStore.current.packs;
    const pending = kind === 'expansion' ? inventory.expansionPending : inventory.pending;
    const emptyKey = kind === 'expansion' ? 'packs.expansion.none' : 'packs.none';
    if (pending <= 0) {
      hud?.toast(t(emptyKey), 'info');
      return;
    }

    // El pool son las cartas que el jugador PUEDE ver (el mismo `poolOf` que
    // alimenta la Coleccion). No se sortean jokers: un sobre entrega
    // especimenes, que es lo que se colecciona por cantidad.
    const allCards = content.registry.poolOf('card') as CardDefinition[];
    const pool = allCards
      .filter((def) =>
        kind === 'expansion' ? content.registry.packOf(def.id) === EXPANSION_PACK_ID : true,
      )
      .map((def) => def.id)
      .filter((id) => id.length > 0);
    if (pool.length === 0) {
      // Pack de expansion sin contenido cargado (o pool vacio): se avisa en vez
      // de abrir un sobre que no puede entregar nada.
      hud?.toast(t(emptyKey), 'info');
      return;
    }

    const rng = new RNG((Date.now() ^ 0x5f3759df) >>> 0);
    const drawn = drawPack(rng, pool, DEFAULT_CARDS_PER_PACK);

    // La rareza del SOBRE (3 escalones, economia meta) se traduce a la rareza
    // del CONTENIDO (5 escalones, catalogo) para el color y la etiqueta. Son
    // dos vocabularios distintos a proposito: separarlos deja recalibrar la
    // economia de sobres sin tocar las rarezas de las cartas.
    const CONTENT_RARITY: Record<PackRarity, Rarity> = {
      comun: 'common',
      rara: 'rare',
      epica: 'legendary',
    };
    const byId = new Map(allCards.map((d) => [d.id, d]));

    const views: PackCardView[] = drawn.map((card) => {
      const def = byId.get(card.cardId);
      const contentRarity = CONTENT_RARITY[card.rarity];
      return {
        cardId: card.cardId,
        rarity: card.rarity,
        name: def ? t(def.nameKey) : card.cardId,
        rarityLabel: t(`rarity.${contentRarity}`),
        color: hexToCss(RARITY_COLOR[contentRarity] ?? ELEMENT_COLOR.neutral),
        // Misma cara que la tienda y la coleccion: misma ilustracion real.
        faceUrl: def ? cardDefFaceUrl(def, t, scene.cardArt(def)) : null,
      };
    });

    // El sobre se consume ACA (no al cerrar): abrir el overlay ES usarlo. Si se
    // consumiera al cerrar, cerrar con la X lo dejaria disponible y se podria
    // abrir el mismo sobre infinitas veces.
    //
    // Ademas se anota CUANTAS copias de cada carta se obtuvieron: es lo que
    // alimenta el badge "xN" de la Coleccion. Solo cuenta cartas (los sobres
    // nunca dan jokers).
    profileStore.patch((p) => {
      if (kind === 'expansion') consumeExpansionPack(p.packs);
      else consumePack(p.packs);
      for (const card of drawn) {
        if (!card.cardId) continue;
        p.collection.ownedCounts[card.cardId] = (p.collection.ownedCounts[card.cardId] ?? 0) + 1;
      }
    });

    hud?.showPackOpening({
      cards: views,
      kind,
      // El sobre de expansión saca sus cartas con SU dorso (`cardback_mycelial`):
      // es lo que lo distingue de un sobre base ya ANTES de girar la primera
      // carta. `cardBackArt` lo resuelve el Render; si el arte no esta cargado
      // cae al dorso procedural (mismo camino que el dorso base).
      backArt: kind === 'expansion' ? scene.cardBackArt('mycelial') : undefined,
      pendingLeft: () =>
        kind === 'expansion'
          ? profileStore.current.packs.expansionPending
          : profileStore.current.packs.pending,
      onClose: () => {
        // Al cerrar se vuelve a la Coleccion: se abrieron sobres DESDE ahi.
        openCollection();
      },
    });
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
   * El contenedor soporta Google Play Games. Se sondea UNA vez al arrancar y
   * se cachea: en el navegador (dev, smoke, escritorio) siempre es `false`.
   */
  let googlePlayAvailable = false;

  /**
   * Empuja al HUD el estado meta del menu: progreso, Colonia (futura) y la
   * RECOMENDACION contextual — la que responde "que deberia hacer ahora?".
   *
   * Se llama antes de dibujar el menu y cada vez que el jugador vuelve a el.
   * El HUD no conoce el perfil, asi que el estado siempre viaja empujado.
   */
  const syncMenuMeta = (): void => {
    const p = profileStore.current;
    const views = achievementViews();
    const daily = evaluateDaily(p, Date.now(), dailyTable);
    // Prioridad de la recomendacion: primera vez > diaria > continuar > superar.
    const recommendation = !p.stats.runs
      ? { key: 'menu.recommend.first' }
      : !daily.alreadyClaimedToday
        ? { key: 'menu.recommend.daily' }
        : savedRun
          ? { key: 'menu.recommend.continue', params: { ante: savedRun.ante } }
          : { key: 'menu.recommend.beatBest', params: { ante: p.stats.bestAnte } };
    hud?.setAchievementsState(views);
    hud?.setLeaderboardState(buildLeaderboardView());
    // Colonia Fungi: la meta-progresion REAL (Esporas de Colonia + nivel).
    const colony = p.colony;
    const next = nextLevelInfo(colony);
    hud?.setMenuMeta({
      colonyLevel: colony.level,
      colony: {
        level: colony.level,
        levelNameKey: colonyLevelNameKey(colony.level),
        spores: colony.lifetimeSpores,
        current: next.current,
        next: next.next,
        remaining: next.remaining,
        progress: next.progress,
        nextRewardNameKey: next.rewardNameKey,
        seasonSpores: colony.seasonSpores,
        dailyRemaining: dailyRemaining(colony, Date.now()),
        dailyCap: DAILY_HARD_CAP,
        rewards: levelViews(colony),
      },
      account: {
        linked: p.account.provider !== 'none',
        provider: p.account.provider,
        displayName: p.account.displayName,
        syncState: p.account.syncState,
        available: googlePlayAvailable,
      },
      bestAnte: p.stats.bestAnte,
      wins: p.stats.wins,
      streak: p.daily.streak,
      achievements: { unlocked: views.filter((v) => v.unlocked).length, total: views.length },
      dailyPending: !daily.alreadyClaimedToday,
      recommendation,
    });
  };

  // --- Cuenta (Google Play Games) ---
  //
  // La cuenta es OPCIONAL: el juego se juega entero offline. El proveedor solo
  // se activa dentro del contenedor Tauri en Android; en el navegador
  // `isAvailable()` devuelve false y la UI ofrece el estado "no disponible" en
  // vez de un boton que va a fallar.
  const googlePlay = createGooglePlayProvider();

  const onLinkAccount = async (): Promise<void> => {
    if (!googlePlayAvailable) {
      hud?.toast(t('colony.account.unavailable'), 'warn');
      return;
    }
    try {
      const identity = await googlePlay.signIn();
      if (!identity) return; // El jugador cerro el flujo de Google.
      profileStore.patch((p) => linkAccount(p, identity));
      syncMenuMeta();
      hud?.showProfile();
      hud?.toast(t('colony.account.linked', { name: identity.displayName }), 'info');
    } catch {
      hud?.toast(t('colony.account.error'), 'warn');
    }
  };

  const onUnlinkAccount = (): void => {
    profileStore.patch((p) => unlinkAccount(p));
    syncMenuMeta();
    hud?.showProfile();
  };

  // --- Ranking global (V1.3) ---
  //
  // El servicio se configura por build (`VITE_LEADERBOARD_URL`). SIN variable el
  // transporte queda APAGADO y el panel muestra su estado offline: el juego se
  // puede jugar entero sin servidor, y la cuenta sigue siendo opcional.
  const leaderboardEndpoint = leaderboardEndpointFromEnv();
  const leaderboardTransport = leaderboardEndpoint
    ? createLeaderboardClient({ endpoint: leaderboardEndpoint, seasonId: seasonDef?.id ?? '' })
    : createOfflineTransport('El ranking todavía no está disponible en este build');

  /** Identidad para hablar con el servicio, o null si no hay cuenta vinculada. */
  const accountIdentity = (): AccountIdentity | null => {
    const account = profileStore.current.account;
    if (account.provider === 'none' || !account.accountId) return null;
    return {
      id: account.accountId,
      displayName: account.displayName ?? account.accountId,
      provider: account.provider === 'local' ? 'local' : 'google-play',
    };
  };

  /** Traduce el tablero cacheado a la vista que dibuja el panel. */
  const scopeView = (board: LeaderboardBoard | null): LeaderboardScopeView | null => {
    if (!board) return null;
    const self = profileStore.current.account.accountId;
    const rank = board.selfRank;
    return {
      rows: board.entries.map((entry) => ({
        playerId: entry.playerId,
        displayName: entry.displayName,
        spores: entry.spores,
        level: entry.level,
        isSelf: self !== null && entry.playerId === self,
      })),
      selfRank: rank,
      total: board.total,
      rankLabel: formatRank(rank, board.total),
      percentile: rank === null ? 100 : percentileOf(rank, board.total),
      tierNameKey: rank === null ? null : rankTierFor(rank, board.total).nameKey,
    };
  };

  const buildLeaderboardView = (): LeaderboardPanelState => {
    const p = profileStore.current;
    return {
      enabled: leaderboardTransport.enabled,
      disabledReason: leaderboardTransport.disabledReason,
      syncState: p.account.syncState,
      season: scopeView(p.account.leaderboard.season),
      lifetime: scopeView(p.account.leaderboard.lifetime),
      milestones: milestoneViews(p).map((m) => ({
        nameKey: m.nameKey,
        met: m.met,
        progress: m.progress,
        current: m.current,
        target: m.target,
      })),
      localSpores: p.colony.lifetimeSpores,
      verifiedSpores: p.account.verifiedSpores,
    };
  };

  /**
   * Sube lo pendiente y refresca los tableros.
   *
   * NO acredita Esporas locales: eso ya paso al superar cada Ciego. Volver a
   * acreditarlas aca duplicaria la recompensa en cada reintento (ver
   * `LeaderboardSync.ts`). Si el servidor rechaza un resultado, el perfil queda
   * en conflicto y se muestra.
   */
  const syncLeaderboard = async (): Promise<void> => {
    const identity = accountIdentity();
    const now = Date.now();
    const flush = await flushPendingResults(profileStore.current, leaderboardTransport, identity, now);
    if (flush.hadWork && !flush.error) {
      await refreshBoards(profileStore.current, leaderboardTransport, identity?.id ?? null, now);
    }
    await profileStore.saveNow();
    hud?.setLeaderboardState(buildLeaderboardView());
    syncMenuMeta();
  };

  // El sondeo es barato y no bloquea el arranque: si el contenedor no trae el
  // plugin, queda en "no disponible" para siempre.
  void googlePlay.isAvailable().then((available) => {
    googlePlayAvailable = available;
    syncMenuMeta();
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
        syncMenuMeta();
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
    // Volumen en vivo: mover el slider tiene que cambiar el sonido YA.
    if (patch.sfxVolume !== undefined || patch.musicVolume !== undefined) applyAudioVolumes();
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

  // El estado meta se empuja ANTES de dibujar el menu: la recomendacion y el
  // boton "Continuar" dependen de que exista (o no) una partida guardada, y el
  // panel se construye UNA sola vez al entrar al estado `menu`.
  savedRun = await runStore.load();
  syncContinueState();
  // Antes de dibujar el menu: el icono de Perfil lee este estado.
  syncAscension();
  // Cosméticos (R4b): aplica el dorso/tapete guardado y alimenta el panel.
  syncCosmetics();
  syncHistory();
  // Arquetipos: el panel de Desafios y el de "Nueva partida" leen esto.
  syncArchetypes();
  // Deck propio: el catalogo poseido y el mazo guardado.
  syncDeck();
  syncMenuMeta();

  engine.enterMenu();
  scene.setMode('menu', { reduceMotion: profile.settings.reduceMotion });

  loader.setProgress(1);
  loader.hide();

  // --- Recompensa diaria: NO se abre sola al arrancar ---
  // Antes el boot evaluaba la diaria y abria el modal encima del menu si no se
  // habia reclamado hoy. Quedaba mal: el jugador recien abre el juego y ya tiene
  // una pantalla que no pidio. Ahora la recompensa espera en el CHIP de regalo
  // de la esquina superior derecha del menu (con punto de notificacion) y solo
  // se abre cuando el jugador lo toca. `syncMenuMeta()` (mas arriba) ya calcula
  // `dailyPending` para ese punto, asi que no hay estado nuevo que mantener.

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
        // Bus de audio: permite verificar desde un probe que el contexto se
        // desbloqueo, que los buffers se decodificaron y que el volumen se aplica.
        audio,
        // Puertas de contenido (R2): el smoke necesita comprobar que una carta
        // bloqueada por jugar NO entra al pool y que se sabe explicar el motivo.
        unlocks,
        gate,
        collection: buildCollection,
        // Contadores de composicion de caras: permiten al probe medir que abrir
        // la Coleccion ya NO compone las ~101 caras de golpe (solo las que
        // entran en viewport), y que reabrir no las recalcula (cache).
        faceComposeCount,
        faceCacheSize,
        // F6: permite a los probes componer la cara propia de un simbionte y
        // comprobar que cada uno sale distinto (y distinto de una carta), sin
        // depender de la Coleccion ni de un perfil con simbiontes descubiertos.
        jokerDefFaceUrl: (def: Parameters<typeof jokerDefFaceUrl>[0], realArt?: HTMLImageElement) =>
          jokerDefFaceUrl(def, t, realArt),
        cardDefFaceUrl: (def: Parameters<typeof cardDefFaceUrl>[0], realArt?: HTMLImageElement) =>
          cardDefFaceUrl(def, t, realArt),
        // Paridad con el componente de pilas adjunto: `FungiPilas.set({mazo, descarte})`
        // actualiza las insignias con la animacion de "rueda" (solo inspeccion).
        FungiPilas: {
          set: (o: { mazo?: number; descarte?: number }) => {
            if (typeof o.mazo === 'number') hud.updatePileBadge('mazo', o.mazo);
            if (typeof o.descarte === 'number') hud.updatePileBadge('descarte', o.descarte);
          },
        },
        // Sobres: el plan pide exponer una API invocable desde el menu, y ademas
        // el smoke la necesita para abrir un sobre sin depender de la UI.
        openPack: openPacks,
        openCollection,
        // Deck propio: re-empuja el estado al HUD (catalogo, mazo guardado y la
        // puerta de progreso). Lo necesitan los probes: subir `colony.level` en
        // caliente no dispara la sincronizacion sola.
        syncDeck,
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
