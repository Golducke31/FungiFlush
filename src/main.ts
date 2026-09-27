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

import { GameEngine, bus, detectCombos, type RunSaveData } from '@engine/index';
import { bootstrapContent } from '@content/bootstrap';
import { currentLanguage, initI18n, setLanguage, t, toggleLanguage, validateDictionaryCoverage } from '@i18n/index';
import { ProfileStore } from '@persistence/ProfileStore';
import { RunStore } from '@persistence/RunStore';
import { Storage } from '@persistence/Storage';
import { EntitlementStore } from '@meta/EntitlementStore';
import { PackGate } from '@meta/PackGate';
import { ArtAssets, SceneManager } from '@render/index';
import { HUD } from '@ui/HUD';
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
    },
  });

  // --- HUD ---
  hud = new HUD({
    engine,
    root: uiRoot,
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
      onOpenCollection: () => hud?.toast(t('collection.comingSoon'), 'info'),
      onOpenExpansions: () => hud?.toast(t('store.comingSoon'), 'info'),
      onOpenPass: () => hud?.toast(t('pass.comingSoon'), 'info'),
      onOpenSettings: () => hud?.showSettings(profileStore.current.settings),
      onOpenAbout: () => hud?.showAbout(),
    },
  });

  hud.bindSettingsPatch((patch) => {
    profileStore.patch((p) => {
      Object.assign(p.settings, patch);
    });
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
      debug.textContent = Object.entries(stats)
        .map(([key, value]) => `${key.padEnd(11)} ${value}`)
        .join('\n');
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
      __fungiflush: { engine, scene, hud, bus, content, profileStore, runStore },
    });
  }
}

boot().catch((error) => {
  console.error('[FungiFlush] Fallo el arranque:', error);
  document.body.innerHTML = `<pre style="color:#e05c8a;font:13px monospace;padding:24px">Fallo el arranque:\n${String(error)}</pre>`;
});
