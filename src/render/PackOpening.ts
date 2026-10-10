/**
 * PackOpening.ts — El overlay 3D de apertura de Sobres.
 *
 * Vive APARTE de la escena del juego a proposito: tiene su propio
 * `WebGLRenderer` y su propio canvas, que se monta y se desmonta con el
 * overlay. Motivos:
 *
 *   1. La escena del juego es cara (postFX, tapete, esporas ambientales) y
 *      tocarla para esconderla/mostrarla cada vez que se abre un sobre es
 *      fragil.
 *   2. El sobre se abre desde el MENU, donde la escena del juego ni siquiera
 *      esta en pantalla con la misma camara.
 *
 * Maquina de estados, igual que el prototipo:
 *
 *   idle ──(abrir)──▶ opening ──▶ reveal ──(todas reveladas)──▶ done ──▶ idle
 *
 * DOS REGLAS QUE NO SE ROMPEN:
 *
 *   - **Cero azar propio.** Las cartas NO las sortea este archivo: entran ya
 *     resueltas como `PackCardView[]`. El sorteo vive en `src/meta/Packs.ts`
 *     (con `RNG` sembrado), asi que la economia se testea sin WebGL.
 *   - **`prefers-reduced-motion` respeta el easing.** Todo el timing pasa por
 *     `fxTween`/`sleep` de `anim.ts`, que ya escalan por `reduceMotion`. Aca no
 *     se escribe un `setTimeout` ni una duracion cruda.
 */

import * as THREE from 'three';
import { fxTween, sleep, startExternal, stopExternal, updateAnim } from '@render/anim';
import { audio } from '@audio/AudioBus';
import { createCardBackCanvas } from '@render/CardTexture';
import { t } from '@i18n/index';
import type { PackCard, PackDropKind } from '@meta/Packs';

/** Una carta ya resuelta para dibujar (el sorteo ocurrio en `Packs.ts`). */
export interface PackCardView {
  cardId: string;
  rarity: PackCard['rarity'];
  /** Nombre ya traducido. */
  name: string;
  /** Texto de la rareza ya traducido ("Común" / "Rara" / "Épica"). */
  rarityLabel: string;
  /** Color de la rareza (css) para el aura y el HUD. */
  color: string;
  /** Cara ya compuesta como data URL (mismo camino que la tienda), o null. */
  faceUrl: string | null;
}

export interface PackOpeningCallbacks {
  /** El jugador cerro el overlay (o se agotaron los sobres). */
  onClose: () => void;
  /** Se revelo una carta. `index` es su posicion en el sobre. */
  onReveal?: (index: number) => void;
  /** Sobres pendientes que quedan. El HUD decide si mostrar "Otro sobre". */
  pendingLeft: () => number;
}

export interface PackOpeningOptions {
  cards: PackCardView[];
  /**
   * Dorso con el que se dibujan las cartas ANTES de girarse.
   *
   * Lo pasa el llamador (el Render resolvio el arte): asi el sobre de EXPANSION
   * saca sus cartas con SU dorso (`cardback_mycelial`) en vez del dorso base, y
   * el jugador ve de que familia viene lo que esta a punto de revelar. `undefined`
   * cae al dorso procedural de `createCardBackCanvas`.
   */
  backArt?: HTMLImageElement;
  /**
   * Familia del sobre: cambia la PALETA del envoltorio (y su leyenda) para que un
   * sobre de expansión no se vea igual que uno base. `base` (por defecto) es el
   * verde del prototipo; `expansion` es cian/violeta con "MICELIO PROFUNDO".
   */
  kind?: PackDropKind;
  callbacks: PackOpeningCallbacks;
}

/** Radios de la rareza: cuanto mas rara, mas grande el aura. */
const RARITY_GLOW: Record<PackCard['rarity'], number> = {
  comun: 0,
  rara: 0.9,
  epica: 1.8,
};

type PackState = 'idle' | 'opening' | 'reveal' | 'done';

/**
 * Controlador del overlay. `open()` lo arranca, `dispose()` lo desmonta.
 *
 * Se instancia UNA vez por apertura (el HUD lo crea y lo tira): mantenerlo vivo
 * entre sobres obligaria a resetear la maquina de estados a mano, que es
 * exactamente el tipo de estado sucio que produce bugs de "la segunda vez que
 * abro un sobre no anda".
 */
export class PackOpening {
  readonly element: HTMLElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private readonly cards: THREE.Group[] = [];
  private readonly auras: THREE.Mesh[] = [];
  private pack: THREE.Group | null = null;
  private bodyMesh: THREE.Mesh | null = null;
  private lidMesh: THREE.Mesh | null = null;

  private readonly packGroup = new THREE.Group();
  private readonly particles: ParticleBurst;

  private state: PackState = 'idle';
  private shake = 0;
  private revealed = 0;
  private raf = 0;
  private last = 0;
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];

  private readonly infoEl: HTMLElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly allBtn: HTMLButtonElement;
  private readonly flashEl: HTMLElement;

  constructor(private readonly options: PackOpeningOptions) {
    this.element = document.createElement('div');
    this.element.className = 'pack-overlay';
    this.element.dataset['act'] = 'pack-overlay';

    const info = document.createElement('div');
    info.className = 'pack-info';
    info.textContent = t('packs.tapToOpen');
    this.infoEl = info;

    const flash = document.createElement('div');
    flash.className = 'pack-flash';
    this.flashEl = flash;

    const bar = document.createElement('div');
    bar.className = 'pack-bar';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn is-play pack-open';
    openBtn.dataset['act'] = 'pack-open';
    openBtn.textContent = t('packs.open');
    this.openBtn = openBtn;

    const allBtn = document.createElement('button');
    allBtn.className = 'btn is-ghost pack-all';
    allBtn.dataset['act'] = 'pack-all';
    allBtn.textContent = t('packs.revealAll');
    allBtn.hidden = true;
    this.allBtn = allBtn;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn is-ghost pack-close';
    closeBtn.dataset['act'] = 'pack-close';
    closeBtn.textContent = t('ui.close');

    bar.append(openBtn, allBtn, closeBtn);
    this.element.append(flash, info, bar);

    // --- WebGL propio -------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor(0x17110d, 1);
    this.renderer.domElement.className = 'pack-canvas';
    this.element.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#17110d');
    this.scene.add(new THREE.AmbientLight('#b8c9bd', 0.75));
    const dir = new THREE.DirectionalLight('#fff3d6', 0.9);
    dir.position.set(2, 4, 5);
    this.scene.add(dir);
    this.particles = new ParticleBurst(this.scene);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    this.camera.position.z = 7;

    // --- Enlaces ------------------------------------------------------------
    openBtn.addEventListener('click', () => {
      if (this.state === 'idle') void this.open();
      else if (this.state === 'done') this.options.callbacks.onClose();
    });
    allBtn.addEventListener('click', () => void this.revealAll());
    closeBtn.addEventListener('click', () => this.options.callbacks.onClose());

    const onPointerDown = (e: PointerEvent): void => this.onPointerDown(e);
    this.renderer.domElement.addEventListener('pointerdown', onPointerDown);
    this.cleanups.push(() =>
      this.renderer.domElement.removeEventListener('pointerdown', onPointerDown),
    );

    const onResize = (): void => this.resize();
    window.addEventListener('resize', onResize);
    this.cleanups.push(() => window.removeEventListener('resize', onResize));

    this.buildPack();
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Construccion
  // -------------------------------------------------------------------------

  /** El sobre: cuerpo + tapa, con la textura del prototipo pero sin emoji. */
  private buildPack(): void {
    const kind: PackDropKind = this.options.kind ?? 'base';
    const tex = makePackTexture(kind);
    const texBody = tex.clone();
    const texLid = tex.clone();
    texBody.repeat.set(1, 0.85);
    texBody.offset.set(0, 0);
    texLid.repeat.set(1, 0.15);
    texLid.offset.set(0, 0.85);
    texBody.needsUpdate = true;
    texLid.needsUpdate = true;

    // El color de los LATERALES tambien cambia con la familia: es lo que se ve
    // cuando el sobre gira, y sin esto los dos sobres se verian iguales de canto.
    const sideColor = kind === 'expansion' ? '#2a6a9e' : '#2a8f78';
    const side = (): THREE.MeshPhongMaterial =>
      new THREE.MeshPhongMaterial({
        color: sideColor,
        shininess: 90,
        specular: '#ffffff',
        transparent: true,
      });
    const face = (map: THREE.Texture): THREE.MeshPhongMaterial =>
      new THREE.MeshPhongMaterial({ map, shininess: 90, specular: '#aaaaaa', transparent: true });

    const make = (h: number, map: THREE.Texture): THREE.Mesh =>
      new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 0.14), [
        side(),
        side(),
        side(),
        side(),
        face(map),
        face(map),
      ]);

    this.pack = new THREE.Group();
    this.bodyMesh = make(2.04, texBody);
    this.bodyMesh.position.y = -0.18;
    this.lidMesh = make(0.36, texLid);
    this.lidMesh.position.y = 1.02;
    this.pack.add(this.bodyMesh, this.lidMesh);
    this.packGroup.add(this.pack);
    this.scene.add(this.packGroup);
    this.pack.scale.setScalar(0);
  }

  /**
   * Arranca el loop y la animacion de entrada del sobre.
   *
   * TOMA EL RELOJ DE GSAP (`startExternal`). Motivo: `fxTween`/`sleep` avanzan
   * con `updateAnim(dt)`, que normalmente bombea el loop de `SceneManager`. El
   * sobre se abre desde el MENU, donde ese loop no esta corriendo con el reloj
   * de la animacion, asi que sin esto los tweens se quedarian en el frame 0
   * (el boton "Abrir" respondia pero nada se movia).
   *
   * Se devuelve el reloj en `dispose()`, para no dejar dos tickers activos.
   */
  start(): void {
    if (this.disposed) return;
    startExternal();
    this.last = performance.now();
    const tick = (now: number): void => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Apertura
  // -------------------------------------------------------------------------

  private async open(): Promise<void> {
    if (this.state !== 'idle' || !this.pack || !this.lidMesh || !this.bodyMesh) return;
    this.state = 'opening';
    this.openBtn.disabled = true;
    this.infoEl.textContent = '';
    audio.unlock();

    // Carga: tiembla cada vez mas y suelta esporas por el sello.
    await fxTween(750, (p) => {
      if (!this.pack || !this.lidMesh) return;
      const k = p * p;
      this.pack.rotation.z = Math.sin(p * 70) * 0.07 * k;
      this.pack.position.x = (Math.random() - 0.5) * 0.06 * k;
      this.pack.scale.setScalar(this.fit * (1 + 0.1 * p));
      if (Math.random() < p * 0.7) {
        this.particles.emit(this.worldPos(this.lidMesh), 2, '#4fd1b0', 1.3);
      }
    });

    // Rasgado + destello. `discard_many` es el SFX mas "fisico" del catalogo:
    // suena a cosas saliendo de un envase, que es exactamente esto.
    audio.play('discard_many', { volume: 0.7 });
    this.shake = 2;
    flash(this.flashEl);

    const lidPos = this.worldPos(this.lidMesh);
    // El sobre de expansión revienta en cian/violeta; el base, en su verde/ámbar.
    const sparkA = this.options.kind === 'expansion' ? '#b6f0ff' : '#ffe9a8';
    const sparkB = this.options.kind === 'expansion' ? '#6ad0ff' : '#4fd1b0';
    this.particles.emit(lidPos, 130, sparkA, 5);
    this.particles.emit(lidPos, 70, sparkB, 3.5);
    this.pack.rotation.z = 0;
    this.pack.position.x = 0;

    // La tapa se desprende y vuela. Se re-emparenta a la escena para que su
    // movimiento no lo herede el cuerpo que cae.
    this.scene.attach(this.lidMesh);
    const lidStart = this.lidMesh.position.clone();
    const lidOut = fxTween(750, (p) => {
      if (!this.lidMesh) return;
      this.lidMesh.position.set(
        lidStart.x + p * 2.4,
        lidStart.y + Math.sin(p * 3.1) * 1.1,
        lidStart.z + p,
      );
      this.lidMesh.rotation.z = p * 2.6;
      setOpacity(this.lidMesh, 1 - p);
    });

    const bodyDrop = fxTween(650, (p) => {
      if (!this.bodyMesh) return;
      this.bodyMesh.position.y = -0.18 - p * p * 5;
      this.bodyMesh.rotation.z = p * 0.4;
      setOpacity(this.bodyMesh, 1 - p);
    });

    // Las cartas salen del sobre en fila. `sleep(150)` da el respiro del
    // prototipo antes de que empiecen a saltar.
    await sleep(150);
    const start = this.worldPos(this.bodyMesh);
    start.y += 0.2;
    const count = this.options.cards.length;
    const ups = this.options.cards.map((card, i) => {
      const group = this.buildCard(card);
      this.cards.push(group);
      const x = (i - (count - 1) / 2) * 1.65;
      return sleep(i * 90).then(() =>
        fxTween(750, (p) => {
          const e = outBack(p);
          group.position.set(x * e, start.y + (0 - start.y) * e + Math.sin(Math.min(1, p * 1.6) * Math.PI) * 0.5, -0.3 + p * 0.3);
          group.scale.setScalar(this.fitRow * (0.8 + 0.2 * e));
        }),
      );
    });

    await Promise.all([lidOut, bodyDrop, ...ups]);
    if (this.lidMesh) this.scene.remove(this.lidMesh);
    if (this.pack) this.scene.remove(this.pack);

    this.state = 'reveal';
    this.allBtn.hidden = false;
    this.openBtn.hidden = true;
    this.infoEl.textContent = t('packs.tapToReveal');
  }

  /** `true` si ya se abrio la ultima carta. */
  get allRevealed(): boolean {
    return this.cards.length > 0 && this.cards.every((c) => c.userData['flipped'] === true);
  }

  private async revealAll(): Promise<void> {
    if (this.state !== 'reveal') return;
    this.allBtn.disabled = true;
    for (const card of this.cards) {
      void this.flip(card);
      await sleep(260);
    }
    this.allBtn.disabled = false;
  }

  private async flip(group: THREE.Group): Promise<void> {
    if (this.state !== 'reveal' || group.userData['flipped'] === true) return;
    group.userData['flipped'] = true;
    const view = group.userData['view'] as PackCardView;
    const glow = RARITY_GLOW[view.rarity];
    const big = glow > 0;

    // Un tono mas alto por carta revelada: la secuencia "sube".
    audio.play(`select_${Math.min(5, 1 + this.revealed)}`, { volume: 0.5 });
    this.revealed += 1;

    const z0 = group.position.z;
    await fxTween(480, (p) => {
      group.rotation.y = Math.PI * (1 - inOut(p));
      group.position.z = z0 + Math.sin(p * Math.PI) * 0.8;
      group.scale.setScalar(this.fitRow * (1 + 0.12 * Math.sin(p * Math.PI)));
    });

    const world = this.worldPos(group);
    this.particles.emit(world, big ? 70 : 24, view.color, big ? 4.5 : 2.5);

    if (big) {
      this.shake = Math.max(this.shake, view.rarity === 'epica' ? 1.8 : 0.9);
      audio.play('select_5', { volume: 0.4 });
      if (view.rarity === 'epica') {
        this.particles.emit(world, 90, '#ffffff', 6);
      }
      const aura = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 3.6),
        new THREE.MeshBasicMaterial({
          map: radialTexture(view.color),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.8,
        }),
      );
      aura.position.z = -0.05;
      group.add(aura);
      this.auras.push(aura);
    }

    this.options.callbacks.onReveal?.(this.cards.indexOf(group));

    if (this.allRevealed) {
      this.state = 'done';
      this.allBtn.hidden = true;
      this.openBtn.hidden = false;
      this.openBtn.disabled = false;
      // "Otro sobre" solo si de verdad queda alguno: si no, el boton cierra.
      this.openBtn.textContent =
        this.options.callbacks.pendingLeft() > 0 ? t('packs.another') : t('ui.close');
      const epics = (this.options.cards ?? []).filter((c) => c.rarity === 'epica').length;
      const rares = (this.options.cards ?? []).filter((c) => c.rarity === 'rara').length;
      this.infoEl.textContent = epics
        ? t('packs.resultEpic')
        : rares
          ? t('packs.resultRare', { n: rares })
          : t('packs.resultDone');
    }
  }

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.state === 'idle' && this.pack) {
      if (this.raycaster.intersectObject(this.pack, true).length > 0) void this.open();
      return;
    }
    if (this.state !== 'reveal') return;
    const hit = this.raycaster.intersectObjects(this.cards, true)[0];
    if (!hit) return;
    // El rayo pega en la cara o en el dorso; hay que subir hasta el grupo que
    // lleva el `userData`.
    let node: THREE.Object3D | null = hit.object;
    while (node && node.userData['view'] === undefined && node.parent) node = node.parent;
    if (node && node.userData['view'] !== undefined) void this.flip(node as THREE.Group);
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  private frame(dt: number, now: number): void {
    // GSAP lo manda este loop mientras el overlay vive (ver `start`).
    updateAnim(dt);
    this.particles.step(dt);
    this.shake *= Math.exp(-dt * 7);
    this.camera.position.set(
      (Math.random() - 0.5) * this.shake * 0.08,
      (Math.random() - 0.5) * this.shake * 0.08,
      7,
    );
    const time = now / 1000;
    if (this.state === 'idle' && this.pack) {
      this.pack.position.y = Math.sin(time * 1.6) * 0.08;
      this.pack.rotation.y = Math.sin(time * 0.9) * 0.28;
    }
    if (this.state === 'reveal' || this.state === 'done') {
      this.cards.forEach((group, i) => {
        if (group.userData['flipped'] !== true || !group.userData['aura']) {
          group.position.y = Math.sin(time * 1.4 + i) * 0.04;
        }
      });
    }
    this.auras.forEach((aura, i) => {
      aura.scale.setScalar(1 + 0.08 * Math.sin(time * 3 + i));
      const material = aura.material as THREE.MeshBasicMaterial;
      material.opacity = 0.65 + 0.2 * Math.sin(time * 3 + i);
    });
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------
  // Geometria
  // -------------------------------------------------------------------------

  private fit = 1;
  private fitRow = 1;

  private resize(): void {
    const w = this.element.clientWidth || window.innerWidth;
    const h = this.element.clientHeight || window.innerHeight;
    const vis = 2 * 7 * Math.tan(THREE.MathUtils.degToRad(22.5));
    const visW = vis * (w / h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit = Math.min(1, visW / 2.6, (vis * 0.78) / 2.4);
    this.fitRow = Math.min(1, visW / 8.6, (vis * 0.7) / 2.2);
    this.packGroup.scale.setScalar(this.fitRow);
    this.packGroup.position.y = 0.1;
    if (this.pack && this.state === 'idle') this.pack.scale.setScalar(this.fit);
  }

  private buildCard(view: PackCardView): THREE.Group {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(1.4, 1.96);
    // La cara entra ya compuesta (data URL) por el llamador: este modulo no
    // conoce `CardTextureSpec` ni el registro, solo pinta lo que le dan.
    const faceCanvas = view.faceUrl ? canvasFromUrl(view.faceUrl) : fallbackFaceCanvas(view);
    const faceMap = new THREE.CanvasTexture(faceCanvas);
    faceMap.colorSpace = THREE.SRGBColorSpace;
    // `canvasFromUrl` devuelve un canvas VACIO y lo pinta cuando la `Image`
    // termina de decodificar (el data URL es grande). Sin este aviso, la textura
    // se sube a la GPU en blanco y la carta queda NEGRA para siempre: el canvas
    // ya cambio, pero three no lo sabe. `fallbackFaceCanvas` pinta sincrono, asi
    // que ahi el aviso es inofensivo.
    if (view.faceUrl) markTextureDirtyWhenLoaded(view.faceUrl, faceMap);
    else faceMap.needsUpdate = true;

    const front = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: faceMap }));
    front.position.z = 0.003;

    const backMap = new THREE.CanvasTexture(createCardBackCanvas(this.options.backArt));
    backMap.colorSpace = THREE.SRGBColorSpace;
    backMap.needsUpdate = true;
    const back = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: backMap }));
    back.rotation.y = Math.PI;
    back.position.z = -0.003;

    group.add(front, back);
    group.rotation.y = Math.PI;
    group.userData['view'] = view;
    group.userData['flipped'] = false;
    group.userData['aura'] = false;
    group.position.set(0, 0, -0.3);
    group.scale.setScalar(this.fitRow * 0.8);
    this.scene.add(group);
    return group;
  }

  private worldPos(object: THREE.Object3D): THREE.Vector3 {
    return object.getWorldPosition(new THREE.Vector3());
  }

  /**
   * Instantanea para el probe/smoke: que familia de sobre se abrio, si trae
   * dorso propio y cuantas cartas salieron. Sin esto, la unica forma de saber
   * que el sobre de expansion salio con SU dorso seria leer pixeles.
   */
  debugState(): {
    kind: PackDropKind;
    hasBackArt: boolean;
    state: PackState;
    cardIds: string[];
  } {
    return {
      kind: this.options.kind ?? 'base',
      hasBackArt: this.options.backArt !== undefined,
      state: this.state,
      cardIds: this.options.cards.map((c) => c.cardId),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    // Devolver el reloj de GSAP: si el SceneManager sigue corriendo, vuelve a
    // bombear `updateAnim` el solo. Dejarlo aca dejaria dos tickers sumando dt.
    stopExternal();
    for (const fn of this.cleanups) fn();
    this.particles.dispose();
    // ⚠️ `dispose()` NO libera el contexto WebGL (ver `FungiFlushFx.dispose`):
    // sin `forceContextLoss()` cada sobre abierto deja un contexto vivo y, en
    // movil, el navegador acaba descartando el del juego (pantalla en blanco).
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    for (const card of this.cards) {
      card.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(material) ? material : [material]) {
          const withMap = m as THREE.Material & { map?: THREE.Texture };
          withMap.map?.dispose();
          m.dispose();
        }
        mesh.geometry?.dispose();
      });
    }
    this.element.remove();
  }
}

// ---------------------------------------------------------------------------
// Helpers de bajo nivel (fuera de la clase: no dependen de su estado)
// ---------------------------------------------------------------------------

/** Tween de rebote con sobrepaso. Es el `outBack` del prototipo. */
function outBack(p: number): number {
  return 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
}
/** Ease in-out cubico. Es el `inOut` del prototipo. */
function inOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function setOpacity(mesh: THREE.Mesh, value: number): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of materials) m.opacity = value;
}

/**
 * Destello blanco. Reintroduce la animacion reiniciando la clase (el
 * `remove` + `void offsetWidth` es el idioma para forzar un reflow).
 * Si el navegador pide menos movimiento, el CSS ya la acorta.
 */
function flash(el: HTMLElement): void {
  el.classList.remove('is-go');
  void el.offsetWidth;
  el.classList.add('is-go');
}

/** Textura radial blanca->transparente, para auras y particulas. */
function radialTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Textura del sobre, dibujada a mano (nada de emoji: el render por software no
 * tiene la fuente de emoji garantizada y saldria un cuadrado).
 *
 * `kind` cambia la PALETA y la LEYENDA: el sobre base es verde con "SOBRE DE
 * ESPORAS"; el de expansión es marino/cian con "MICELIO PROFUNDO". Es la señal
 * mas barata de que lo que se va a abrir NO es el catalogo base.
 */
function makePackTexture(kind: PackDropKind = 'base'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const expansion = kind === 'expansion';
  const top = expansion ? '#1b4f7a' : '#1f6f5c';
  const mid = expansion ? '#2a6a9e' : '#2a8f78';
  const bottom = expansion ? '#12324d' : '#14493e';
  const motif = expansion ? '#7fe6ff' : '#e9dcc0';
  const label = expansion ? '#9fe8ff' : '#ffd36b';
  const labelText = expansion ? 'MICELIO PROFUNDO' : 'SOBRE DE ESPORAS';

  const bg = ctx.createLinearGradient(0, 0, 0, 384);
  bg.addColorStop(0, top);
  bg.addColorStop(0.5, mid);
  bg.addColorStop(1, bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 384);

  ctx.strokeStyle = expansion ? 'rgba(127,230,255,.16)' : 'rgba(233,220,192,.14)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    ctx.moveTo(128, 200);
    ctx.bezierCurveTo(
      128 + i * 30 - 200,
      80,
      128 - i * 30 + 200,
      300,
      128 + (i - 7) * 40,
      i % 2 ? 0 : 384,
    );
    ctx.stroke();
  }

  // Setas de linea (mismo lenguaje que el icono de Colonia).
  ctx.strokeStyle = motif;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(128, 196, 38, Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(128, 196);
  ctx.lineTo(128, 246);
  ctx.stroke();

  // El de expansión lleva ademas un aro micelial: la silueta del dorso propio.
  if (expansion) {
    ctx.strokeStyle = 'rgba(127,230,255,.5)';
    ctx.lineWidth = 2;
    for (let r = 46; r <= 74; r += 14) {
      ctx.beginPath();
      ctx.arc(128, 214, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.fillStyle = label;
  ctx.textAlign = 'center';
  ctx.font = '700 20px Georgia, serif';
  ctx.fillText(labelText, 128, 316);

  // Franja de sellado arriba y abajo.
  for (let x = 0; x < 256; x += 8) {
    ctx.fillStyle = x % 16 ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.22)';
    ctx.fillRect(x, 0, 8, 22);
    ctx.fillRect(x, 362, 8, 22);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Canvas desde data URL.
 *
 * OJO: la `Image` decodifica ASINCRONO. Este canvas se devuelve vacio y se pinta
 * mas tarde, cuando el data URL termina de cargar. Quien construya la textura
 * TIENE que re-subirla (`markTextureDirtyWhenPainted`): si no, la carta queda en
 * negro, porque la `CanvasTexture` se creo con el canvas todavia en blanco.
 */
function canvasFromUrl(url: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 744;
  const ctx = canvas.getContext('2d');
  const image = new Image();
  image.onload = () => {
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    ctx?.drawImage(image, 0, 0, canvas.width, canvas.height);
  };
  image.src = url;
  return canvas;
}

/**
 * Sube la textura a la GPU otra vez cuando la imagen termina de cargar.
 *
 * `CanvasTexture` no observa el canvas: captura su contenido en el momento de
 * crearla. Con una imagen asincrona hay que esperar y forzar `needsUpdate`, o el
 * primer (y unico) upload sube un canvas vacio y la carta se ve negra.
 *
 * Se crea una `Image` gemela del mismo `src` y se espera su `onload`: es la
 * unica senal fiable de que el bitmap ya se puede dibujar. `decode()` servia
 * igual, pero `onload` funciona tambien cuando el navegador no expone `decode`.
 */
function markTextureDirtyWhenLoaded(url: string, texture: THREE.Texture): void {
  const probe = new Image();
  probe.onload = () => {
    texture.needsUpdate = true;
  };
  probe.onerror = () => {
    texture.needsUpdate = true;
  };
  probe.src = url;
}

/** Cara de respaldo si no hay arte: la carta igual se lee. */
function fallbackFaceCanvas(view: PackCardView): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#e9dcc0';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 352, 22);
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = view.color;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1b1410';
  ctx.font = '700 28px Georgia, serif';
  ctx.fillText(view.name.slice(0, 16), 128, 56);
  ctx.fillStyle = view.color;
  ctx.font = '700 20px Georgia, serif';
  ctx.fillText(view.rarityLabel.toUpperCase(), 128, 332);
  return canvas;
}

/**
 * Pool de particulas circular. Se instancia por overlay y se descarta al
 * cerrarlo: no compite con el `Particles.ts` del juego (son escenas distintas).
 */
class ParticleBurst {
  private readonly count = 900;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly velocities: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly life: Float32Array;
  private head = 0;
  private readonly geometry: THREE.BufferGeometry;
  private readonly points: THREE.Points;
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.baseColors = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const sprite = radialTexture('#ffffff');
    this.points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({
        size: 0.2,
        map: sprite,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(pos: THREE.Vector3, n: number, color: string, speed: number): void {
    this.color.set(color);
    for (let i = 0; i < n; i++) {
      const k = this.head++ % this.count;
      const angle = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random());
      const j = k * 3;
      this.positions[j] = pos.x;
      this.positions[j + 1] = pos.y;
      this.positions[j + 2] = pos.z + 0.2;
      this.velocities[j] = Math.cos(angle) * s;
      this.velocities[j + 1] = Math.sin(angle) * s + speed * 0.3;
      this.velocities[j + 2] = (Math.random() - 0.5) * s * 0.3;
      this.baseColors[j] = this.color.r;
      this.baseColors[j + 1] = this.color.g;
      this.baseColors[j + 2] = this.color.b;
      this.life[k] = 1;
    }
  }

  step(dt: number): void {
    // Los buffers son `Float32Array` de tamano FIJO y el indice siempre esta en
    // rango, pero `noUncheckedIndexedAccess` no lo sabe: los `!` documentan esa
    // invariante (mismo criterio que `Particles.ts`).
    const pos = this.positions;
    const vel = this.velocities;
    const life = this.life;
    const col = this.colors;
    const base = this.baseColors;

    for (let k = 0; k < this.count; k++) {
      const j = k * 3;
      const l = life[k]!;
      if (l > 0) {
        life[k] = l - dt * 1.1;
        vel[j + 1] = vel[j + 1]! - dt * 2.2;
        pos[j] = pos[j]! + vel[j]! * dt;
        pos[j + 1] = pos[j + 1]! + vel[j + 1]! * dt;
        pos[j + 2] = pos[j + 2]! + vel[j + 2]! * dt;
        vel[j] = vel[j]! * 0.985;
        vel[j + 1] = vel[j + 1]! * 0.985;
        const f = Math.max(life[k]!, 0);
        col[j] = base[j]! * f;
        col[j + 1] = base[j + 1]! * f;
        col[j + 2] = base[j + 2]! * f;
      } else {
        col[j] = 0;
        col[j + 1] = 0;
        col[j + 2] = 0;
      }
    }
    this.geometry.attributes['position']!.needsUpdate = true;
    this.geometry.attributes['color']!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.points.material as THREE.PointsMaterial;
    material.map?.dispose();
    material.dispose();
  }
}
