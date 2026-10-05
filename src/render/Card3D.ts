/**
 * Card3D.ts — La carta en el mundo 3D.
 *
 * Una carta es un PlaneGeometry con textura procedural, mas dos quads
 * adicionales: un halo aditivo (shader) y un anillo de seleccion. Detras va el
 * DORSO, para que la carta se pueda girar.
 *
 * CLAVE DE ARQUITECTURA: el tween NO anima `group.position` directamente,
 * porque el hover tambien mueve la carta y se pisarian. En su lugar se anima
 * `home` (un objeto plano) y `update()` compone la transformacion final:
 *
 *     group.position = home + elevacion_por_hover
 *     group.rotation = home + PI * flip
 *
 * Asi el vuelo de la carta, el efecto de hover y el giro conviven sin
 * conflictos.
 */

import * as THREE from 'three';
import type { CardInstance, JokerInstance, Rarity, StatusType } from '@engine/index';
import { t } from '@i18n/index';
import {
  heightMapFor,
  normalMapFor,
  type CardTextureCache,
  type CardTextureSpec,
} from './CardTexture';
import { createHaloMaterial, tickShader } from './Shaders';
import { ELEMENT_COLOR, RARITY_COLOR, SELECT_COLOR, hexToCss } from './palette';
import * as anim from './anim';
import type { TweenHandle, TweenManager } from './Tween';

export const CARD_WIDTH = 2.2;
export const CARD_HEIGHT = 3.2;

/** Cuanto se eleva la carta en hover (unidades de mundo). */
const HOVER_LIFT = 0.9;
/** Cuanto se eleva una carta seleccionada. */
const SELECT_LIFT = 0.42;
/** Cuanto crece la carta mientras se la arrastra. */
const DRAG_SCALE = 1.08;
/** Duracion del giro, en segundos. */
const FLIP_DURATION = 0.34;

const CARD_GEO = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);

/**
 * ESPESOR de la carta, en unidades del mundo.
 *
 * Antes la carta era un plano de espesor cero: cara y dorso eran COPLANARES y
 * los unicos offsets estaban DENTRO del plano (que es lo unico que evitaba el
 * z-fighting). Al inclinarla no se veia nada, porque no habia nada que ver.
 * Con el canto, la carta pasa a ser un objeto: al girarla se ve el borde.
 */
const CARD_THICKNESS = 0.07;

/**
 * Canto de la carta: cuatro quads que unen la cara con el dorso. La geometria
 * es la misma para todas (el tamano es constante), asi que se comparte y se
 * libera junto con las otras dos en `disposeSharedGeometry`.
 */
function createCardEdgeGeometry(): THREE.BufferGeometry {
  const w = CARD_WIDTH / 2;
  const h = CARD_HEIGHT / 2;
  const t = CARD_THICKNESS / 2;
  const positions: number[] = [];
  const normals: number[] = [];

  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
  ): void => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i += 1) normals.push(...n);
  };

  // Los cuatro costados. El material es `DoubleSide`, asi que el orden de los
  // vertices no importa: lo que importa es que la normal mire hacia afuera,
  // porque de eso depende como lo ilumina la luz de la escena.
  quad([w, -h, t], [w, h, t], [w, h, -t], [w, -h, -t], [1, 0, 0]);
  quad([-w, h, t], [-w, -h, t], [-w, -h, -t], [-w, h, -t], [-1, 0, 0]);
  quad([-w, h, t], [w, h, t], [w, h, -t], [-w, h, -t], [0, 1, 0]);
  quad([w, -h, t], [-w, -h, t], [-w, -h, -t], [w, -h, -t], [0, -1, 0]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

const CARD_EDGE_GEO = createCardEdgeGeometry();

/**
 * Cara SUBDIVIDIDA: es lo que permite el relieve geometrico.
 *
 * El dorso sigue con el plano de 1 segmento (no se desplaza), pero la cara
 * necesita vertices de sobra para que el mapa de altura la levante. 24x36 =
 * ~1700 triangulos por cara: con ~20 cartas vivas son ~35k, nada para la GPU.
 */
const CARD_FACE_GEO = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT, 24, 36);

/** Cuanto sobresale el relieve. Menos que el espesor, para que no se lea como un bulto. */
const CARD_RELIEF = 0.03;

/**
 * Altura de la capa de TEXTO. Tiene que quedar por delante de los PICOS del
 * relieve, o el arte atravesaria el texto al levantarse.
 */
const CARD_TOP_OFFSET = CARD_THICKNESS / 2 + CARD_RELIEF + 0.02;

/**
 * Escala del quad del halo respecto de la carta.
 *
 * El quad tiene que contener el contorno MAS GRANDE de los tres (el anillo, que
 * antes vivia en un mesh propio escalado 1.14), asi que el halo se compensa
 * dividiendo su `uInner` por esta misma escala. Ver `HALO_INNER_HALO`.
 */
const HALO_SPREAD = 1.14;
const HALO_GEO = new THREE.PlaneGeometry(
  CARD_WIDTH * 1.3 * HALO_SPREAD,
  CARD_HEIGHT * 1.24 * HALO_SPREAD,
);

/**
 * Ancho del halo: el contorno MAS GRANDE que dibuja una carta.
 *
 * Lo necesita quien tenga que poner cartas una al lado de otra. Separarlas por
 * `CARD_WIDTH` no alcanza: el halo es ~48% mas ancho, asi que dos cartas
 * separadas por el ancho "de la carta" igual tienen los halos pisados y la fila
 * se lee como una mancha continua. Es el error que tenia la fila de jokers.
 */
export const CARD_HALO_WIDTH = CARD_WIDTH * 1.3 * HALO_SPREAD;

/**
 * Badge con el NUMERO DE ORDEN de la seleccion (1-5).
 *
 * Va en la esquina superior derecha de la cara. Se dibuja en un canvas (una
 * textura por digito, COMPARTIDA entre cartas) y se muestra solo cuando la
 * carta esta seleccionada, boca arriba y no se la esta arrastrando: es la
 * respuesta visual a "cuantas cartas llevo elegidas y en que orden".
 */
const BADGE_SIZE = CARD_WIDTH * 0.32;
const BADGE_GEO = new THREE.PlaneGeometry(BADGE_SIZE, BADGE_SIZE);
const BADGE_TEXTURES = new Map<number, THREE.CanvasTexture>();

function badgeTexture(index: number): THREE.CanvasTexture {
  const cached = BADGE_TEXTURES.get(index);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    // Disco verde con borde oscuro: legible sobre cualquier arte de carta.
    ctx.beginPath();
    ctx.arc(c, c, size * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = hexToCss(SELECT_COLOR);
    ctx.fill();
    ctx.lineWidth = size * 0.08;
    ctx.strokeStyle = 'rgba(6, 20, 14, 0.92)';
    ctx.stroke();
    ctx.fillStyle = '#07140e';
    ctx.font = `bold ${Math.round(size * 0.64)}px "Fredoka", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index), c, c + size * 0.035);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  BADGE_TEXTURES.set(index, texture);
  return texture;
}

/** Posicion/rotacion "en reposo": es lo unico que animan los tweens. */
export interface CardHome {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** 0 = boca arriba, 1 = boca abajo. */
  flip: number;
  /**
   * Escala multiplicativa para squash/stretch (1 = normal). Va en `home` para
   * que un tween la anime y `applyTransform()` la componga: escribir
   * `group.scale` directamente NO sirve, porque `update()` lo pisa cada frame.
   */
  sx: number;
  sy: number;
  sz: number;
  /**
   * Altura EXTRA para volar en arco, sumada a `y` (que sigue siendo del
   * layout). Va aparte para que el arco y el reacomodo no se peleen por `y`.
   */
  arc: number;
}

export type CardKind = 'card' | 'joker';

export class Card3D {
  readonly group = new THREE.Group();
  readonly kind: CardKind;
  readonly uid: string;

  card: CardInstance | null = null;
  joker: JokerInstance | null = null;

  /** Objeto de tweening: la posicion "en reposo" de la carta. */
  readonly home: CardHome = {
    x: 0,
    y: 0,
    z: 0,
    rx: -Math.PI / 2,
    ry: 0,
    rz: 0,
    flip: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    arc: 0,
  };

  /**
   * Escala ESTRUCTURAL de la carta (joker 0.5, carta jugada 0.86). Vive aparte
   * de `home.s*` (squash) y de `update()`: es lo unico que `applyTransform()`
   * no recalcula, asi que sobrevive al frame.
   */
  private baseScale = 1;
  /**
   * Cara COMPACTA: nombre + numeros grandes, sin descripcion (solo tactil).
   * Ver `CardTextureSpec.compact`. Se fija al construir y entra en la clave de
   * cache, asi que una carta compacta y una completa nunca comparten textura.
   */
  private readonly compactFace: boolean;

  hovering = false;
  selected = false;
  /** P1.2 — Brillo sutil para cartas compatibles con la selección actual. */
  compatible = false;
  /** 0..1, controla la elevacion y el brillo del halo. */
  private lift = 0;
  private selectGlow = 0;
  private compatibleGlow = 0;
  private disposed = false;
  /** Mientras se arrastra, el hover y la elevacion los maneja el arrastre. */
  private dragging = false;
  /** Tween del giro. Va aparte para poder cancelarlo sin tocar el vuelo. */
  private flipHandle: TweenHandle | null = null;

  private readonly face: THREE.Mesh;
  private readonly faceMaterial: THREE.MeshStandardMaterial;
  private readonly back: THREE.Mesh;
  private readonly backMaterial: THREE.MeshStandardMaterial;
  /** Canto: le da ESPESOR a la carta. Sin esto es una calcomania. */
  private readonly edge: THREE.Mesh;
  private readonly edgeMaterial: THREE.MeshStandardMaterial;
  /** Capa de TEXTO que flota sobre el arte: es la que produce el parallax. */
  private readonly top: THREE.Mesh;
  private readonly topMaterial: THREE.MeshStandardMaterial;
  private readonly halo: THREE.Mesh;
  private readonly haloMaterial: THREE.ShaderMaterial;
  /** Badge con el numero de orden de la seleccion (1-5). */
  private readonly badge: THREE.Mesh;
  private readonly badgeMaterial: THREE.MeshBasicMaterial;
  /** Indice de seleccion (1-5), o null si la carta no esta elegida. */
  private selectIndex: number | null = null;
  /** Cuanto foil le corresponde por rareza. 0 = no lleva. */
  private readonly foilAmount: number;

  constructor(uid: string, kind: CardKind, element: number, rarity: Rarity, compactFace = false) {
    this.uid = uid;
    this.kind = kind;
    this.compactFace = compactFace;

    this.faceMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.58,
      metalness: 0.12,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.32,
    });
    this.face = new THREE.Mesh(CARD_FACE_GEO, this.faceMaterial);
    this.face.userData['card3d'] = this;
    // Media carta hacia ADELANTE (local +Z es la normal del plano, o sea "la
    // cara de arriba" una vez que el grupo se apoya sobre la mesa).
    this.face.position.z = CARD_THICKNESS / 2;

    // --- Dorso ---
    // Las dos caras son coplanares y miran para lados opuestos: la cara usa
    // FrontSide y el dorso BackSide, asi que el culling del GPU decide cual se
    // ve en cada momento y no hace falta tocar `.visible` por frame.
    // El raycaster respeta `material.side`, asi que tambien acierta la misma.
    this.backMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.24,
      emissive: new THREE.Color(0x123040),
      emissiveIntensity: 0.5,
      side: THREE.BackSide,
    });
    this.back = new THREE.Mesh(CARD_GEO, this.backMaterial);
    this.back.userData['card3d'] = this;
    // Media carta hacia ATRAS: entre las dos caras queda el espesor.
    this.back.position.z = -CARD_THICKNESS / 2;

    // --- Canto ---
    // Un gris muy oscuro con un resto de emision del elemento: el borde de una
    // carta real es el nucleo de papel, y el tinte lo ata a su paleta.
    this.edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c1218,
      roughness: 0.74,
      metalness: 0.18,
      emissive: new THREE.Color(element),
      emissiveIntensity: 0.22,
      side: THREE.DoubleSide,
    });
    this.edge = new THREE.Mesh(CARD_EDGE_GEO, this.edgeMaterial);

    // --- Halo: halo + anillo + foil en UN solo mesh ---
    //
    // Los tres son funciones de distancia sobre el mismo rectangulo, asi que
    // sumarlos en un fragment shader cuesta una fraccion de lo que costaban
    // tres quads aditivos (el anillo volvia a dibujar la misma geometria).
    this.foilAmount = rarity === 'mythic' ? 1.0 : rarity === 'legendary' ? 0.7 : 0;
    this.haloMaterial = createHaloMaterial({
      color: element,
      // El anillo es SIEMPRE el borde verde de seleccion: se quito el tinte por
      // elemento/rareza. El halo (uColor) queda en 0 de intensidad: la carta ya
      // no brilla, solo se le dibuja el borde.
      ringColor: SELECT_COLOR,
      intensity: 0,
      falloff: 9,
      foil: this.foilAmount,
    });
    this.halo = new THREE.Mesh(HALO_GEO, this.haloMaterial);
    // El halo FLOTA delante de la cara, y lo bastante lejos como para que los
    // picos del relieve (CARD_RELIEF) no lo atraviesen.
    this.halo.position.z = CARD_TOP_OFFSET + 0.025;

    // --- Badge del numero de seleccion ---
    // Por delante del halo, en la esquina superior derecha de la cara. El
    // material es `Basic` (sin luz) y `toneMapped:false`: el numero tiene que
    // leerse siempre, sin depender del encuadre ni del tone mapping de la escena.
    this.badgeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.badge = new THREE.Mesh(BADGE_GEO, this.badgeMaterial);
    const badgeInset = BADGE_SIZE * 0.62;
    this.badge.position.set(
      CARD_WIDTH / 2 - badgeInset,
      CARD_HEIGHT / 2 - badgeInset,
      CARD_TOP_OFFSET + 0.05,
    );
    this.badge.visible = false;
    // El badge se dibuja SIEMPRE por encima del halo (que es aditivo y lo
    // lavaria): `renderOrder` alto gana el orden de transparencias.
    this.badge.renderOrder = 20;

    // --- Capa de TEXTO (parallax) ---
    // Va por DELANTE de la cara: al inclinar la carta, el texto se corre
    // respecto al arte de atras. `FrontSide` la oculta sola cuando la carta
    // esta boca abajo (el dorso queda delante), sin tocar `.visible` por frame.
    this.topMaterial = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0.1,
    });
    this.top = new THREE.Mesh(CARD_GEO, this.topMaterial);
    this.top.position.z = CARD_TOP_OFFSET;

    this.group.add(this.halo);
    this.group.add(this.badge);
    this.group.add(this.top);
    this.group.add(this.edge);
    this.group.add(this.face);
    this.group.add(this.back);

    // Las cartas se apoyan planas sobre la mesa.
    this.group.rotation.set(-Math.PI / 2, 0, 0);
  }

  // -------------------------------------------------------------------------
  // Contenido
  // -------------------------------------------------------------------------

  setCard(card: CardInstance, cache: CardTextureCache, lang: string, art?: HTMLImageElement): void {
    this.card = card;

    const statuses = card.statuses.map((s) => s.type);
    const key = [
      'card',
      card.def.id,
      lang,
      card.level,
      statuses.join(','),
      card.bonusSubstrate,
      card.bonusSpores,
      this.compactFace ? 'c' : 'f',
    ].join('|');

    // P1.1/P1.2 — Una carta "tiene habilidad" si declara efectos propios. Es el
    // dato que distingue la descripcion de sabor de la descripcion de una
    // habilidad, y lo que hace que la carta dibuje la etiqueta "✦ HABILIDAD" y
    // el panel lila en vez del panel neutro.
    const hasAbility = (card.def.effects?.length ?? 0) > 0;

    // El nombre y la descripcion van HORNEADOS en la textura (el canvas 2D
    // dibuja el texto con `fillText`). Si se manda la clave i18n cruda
    // (`card.mycelium_webcap.name`) en vez del texto traducido, eso es lo que
    // aparece en la carta. La cache indexa por idioma, asi que un cambio de
    // idioma fuerza una textura nueva con el texto nuevo.
    const spec: CardTextureSpec = {
      kind: 'card',
      name: t(card.def.nameKey),
      desc: t(card.def.descKey),
      element: card.def.element,
      family: card.def.family,
      rarity: card.def.rarity,
      art: card.def.art,
      substrate: card.def.baseSubstrate + card.bonusSubstrate,
      spores: card.def.baseSpores + card.bonusSpores,
      statuses,
      level: card.level,
      hasAbility,
      compact: this.compactFace,
    };

    // Dos capas: el ARTE (compartido por archivo) y el TEXTO (por estado). El
    // parallax sale de que la capa de texto flota por delante de la de arte.
    const artKey = art?.src ?? `proc|${spec.kind}|${spec.element}|${spec.rarity}`;
    this.applyTexture(cache.getArt(artKey, spec, art), cache.getTop(key, spec), card.def.element, art);
  }

  setJoker(
    joker: JokerInstance,
    cache: CardTextureCache,
    lang: string,
    art?: HTMLImageElement,
  ): void {
    this.joker = joker;

    const key = ['joker', joker.def.id, lang, this.compactFace ? 'c' : 'f'].join('|');
    const isMutation = (joker.def.tags ?? []).includes('mutation');
    // Mismo razonamiento que en `setCard`: hornear el texto exige traducir
    // primero, no la clave cruda.
    const spec: CardTextureSpec = {
      kind: isMutation ? 'mutation' : 'joker',
      name: t(joker.def.nameKey),
      desc: t(joker.def.descKey),
      element: 'neutral',
      family: 'agaricaceae',
      rarity: joker.def.rarity,
      art: joker.def.art,
      cost: joker.def.cost,
      compact: this.compactFace,
    };

    const artKey = art?.src ?? `proc|${spec.kind}|neutral|${spec.rarity}`;
    this.applyTexture(cache.getArt(artKey, spec, art), cache.getTop(key, spec), 'neutral', art);
  }

  /**
   * Reemplaza solo el color del halo/anillo cuando cambia el elemento.
   * Evita recrear materiales en cada frame.
   */
  private applyTexture(
    texture: THREE.Texture,
    topTexture: THREE.Texture,
    element: string,
    art?: HTMLImageElement,
  ): void {
    this.faceMaterial.map = texture;
    this.faceMaterial.emissiveMap = texture;

    // Capa de TEXTO: transparente salvo el texto y el marco. Va por delante del
    // arte, asi que al inclinar la carta se corre respecto a el: el parallax.
    this.topMaterial.map = topTexture;
    this.topMaterial.emissiveMap = topTexture;
    this.topMaterial.needsUpdate = true;

    // Relieve de la ILUSTRACION (paso 1): un normal map sacado del propio arte
    // hace que la cara responda a la luz como si estuviera esculpida. No suma
    // geometria ni assets, y se comparte por archivo de arte.
    this.faceMaterial.normalMap = normalMapFor(art);
    // Por encima de ~1 el arte empieza a leerse como plastico.
    this.faceMaterial.normalScale.set(0.85, 0.85);

    // RELIEVE (paso 2): la cara subdividida se levanta con la luminancia del
    // arte, asi que el hongo sale de la carta. Cuesta 0 draw calls: es la misma
    // cara, con mas vertices y un mapa de altura compartido.
    this.faceMaterial.displacementMap = heightMapFor(art);
    this.faceMaterial.displacementScale = CARD_RELIEF;
    this.faceMaterial.displacementBias = 0;

    this.faceMaterial.needsUpdate = true;

    const elementColor = ELEMENT_COLOR[element as keyof typeof ELEMENT_COLOR] ?? 0x9aa5b1;
    // Color del halo: el de RAREZA cuando lo hay (es lo que distingue a un
    // joker legendario), con el del elemento como respaldo. OJO: en las cartas
    // de la MANO el halo esta apagado (`uIntensity = 0`), asi que este color
    // solo se ve en los jokers.
    const rarity = this.joker?.def.rarity ?? this.card?.def.rarity ?? 'common';
    (this.haloMaterial.uniforms['uColor'] as { value: THREE.Color }).value.setHex(
      RARITY_COLOR[rarity] ?? elementColor,
    );
  }

  /**
   * Textura del dorso. La provee el SceneManager, que la genera una sola vez
   * con `createCardBackCanvas()` y la comparte con el mazo y el descarte.
   */
  setBackTexture(texture: THREE.Texture): void {
    this.backMaterial.map = texture;
    this.backMaterial.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Estado visual
  // -------------------------------------------------------------------------

  setHover(value: boolean): void {
    this.hovering = value;
  }

  setSelected(value: boolean): void {
    this.selected = value;
  }

  /**
   * Numero de orden dentro de la seleccion (1-5). `null` lo oculta.
   *
   * Lo empuja el SceneManager desde `round.selected`, que es la fuente de
   * verdad del orden: la carta que el jugador eligio primero lleva el 1.
   */
  setSelectIndex(index: number | null): void {
    this.selectIndex = index;
    if (index !== null && index >= 1) {
      this.badgeMaterial.map = badgeTexture(index);
      this.badgeMaterial.needsUpdate = true;
    }
  }

  /** P1.2 — Resaltar compatibles: cartas que comparten familia/elemento con
      la selección actual. Brillo sutil, sin elevación (no compite con la
      selección). */
  setCompatible(value: boolean): void {
    this.compatible = value;
  }

  /**
   * Marca la carta como "en la mano del jugador" mientras se la arrastra.
   *
   * Mientras dura, el hover y la elevacion por seleccion se apagan: la carta
   * ya esta levantada por el arrastre, y sumarle la elevacion de hover la
   * haria saltar. La posicion y la inclinacion las pone el SceneManager en
   * `home` (sin tween: perseguir el dedo con un tween se siente con lag).
   */
  setDragging(value: boolean): void {
    this.dragging = value;
    if (!value) return;
    this.hovering = false;
    this.lift = 0;
  }

  /** `true` = boca arriba. */
  get faceUp(): boolean {
    return this.home.flip < 0.5;
  }

  /** 0 = boca arriba, 1 = boca abajo (valor en vuelo, no el objetivo). */
  get flip(): number {
    return this.home.flip;
  }

  /** `true` si el dorso tiene textura. Sin esto la carta girada sale vacia. */
  get hasBack(): boolean {
    return this.backMaterial.map !== null;
  }

  /**
   * Cuanto esta levantada la carta, 0..1 (hover, seleccion o arrastre).
   *
   * Lo lee la sombra de contacto para encogerse cuando la carta se despega de
   * la mesa: es la unica pista de profundidad que tiene una carta acostada.
   */
  get liftAmount(): number {
    return this.dragging ? 1 : this.lift;
  }

  /**
   * Gira la carta.
   *
   * Sin `tweens` el cambio es instantaneo, que es lo correcto al repartir una
   * carta que ya nace boca abajo. El handle del giro se guarda aparte para
   * cancelar SOLO el giro: `tweens.cancelFor(home)` tambien mataria el vuelo
   * de la carta a mitad de camino.
   */
  setFaceUp(
    value: boolean,
    options?: { animated?: boolean; tweens?: TweenManager; duration?: number },
  ): void {
    const target = value ? 0 : 1;
    this.flipHandle?.cancel();
    this.flipHandle = null;
    // El reparto de apertura gira la carta con GSAP: si no se mata SOLO esa
    // animacion, el giro explicito pelea con la cascada y la carta no llega.
    anim.killOfProp(this.home, 'flip');

    const tweens = options?.tweens;
    if (!(options?.animated ?? true) || !tweens) {
      this.home.flip = target;
      this.applyTransform();
      return;
    }

    this.flipHandle = tweens.to(this.home, { flip: target }, {
      duration: options?.duration ?? FLIP_DURATION,
      ease: 'cubicInOut',
    });
  }

  /**
   * Brillo puntual (0..1) para celebrar una mejora o una evolucion.
   * Lo maneja el SceneManager con un tween; `update()` no lo pisa.
   */
  setFlash(amount: number): void {
    this.faceMaterial.emissiveIntensity = 0.32 + Math.max(0, amount) * 1.6;
  }

  /** Fuerza el estado visual al instante (al repartir, para evitar saltos). */
  snapToHome(): void {
    this.lift = this.selected ? 1 : 0;
    this.selectGlow = this.selected ? 1 : 0;
    this.applyTransform();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt: number, time: number): void {
    if (this.disposed) return;

    const targetLift = this.dragging ? 0 : this.hovering ? 1 : this.selected ? 0.55 : 0;
    const targetGlow = this.dragging ? 1 : this.selected || this.hovering ? 1 : 0;
    const targetCompatible = this.compatible ? 0.35 : 0;

    // Interpolacion exponencial independiente del framerate.
    const k = 1 - Math.exp(-dt * 14);
    const kc = 1 - Math.exp(-dt * 10); // compatible mas lento, menos llamativo
    this.lift += (targetLift - this.lift) * k;
    this.selectGlow += (targetGlow - this.selectGlow) * k;
    this.compatibleGlow += (targetCompatible - this.compatibleGlow) * kc;

    tickShader(this.haloMaterial, time);

    // Intensidad del halo: base + hover/seleccion + compatible + foil.
    //
    // La SELECCION aporta poco al halo (0.5 en vez de 1.5): su señal es el
    // BORDE VERDE (el anillo), no un resplandor que lava la ilustracion. Con el
    // aporte viejo, una carta elegida quedaba irreconocible bajo la luz.
    // HALO: apagado en las CARTAS de la mano (la unica señal de estado es el
    // BORDE VERDE del anillo y el badge del numero). Los JOKERS conservan su
    // halo por rareza: viven en una fila y es lo que los hace destacar.
    const base = this.kind === 'joker' ? 0.42 : 0.3;
    const pulse = 0.5 + this.compatibleGlow * 0.45 + this.lift * 0.4;
    (this.haloMaterial.uniforms['uIntensity'] as { value: number }).value =
      this.kind === 'joker' ? base + pulse * 0.55 : 0;
    // Borde verde: fuerte con la seleccion, tenue con el "compatible" (pista de
    // combo, P1.2). El color del anillo es SELECT_COLOR desde el material.
    (this.haloMaterial.uniforms['uRingIntensity'] as { value: number }).value =
      this.selectGlow * 0.9 + this.compatibleGlow * 0.3;

    // Badge del numero: solo con la carta elegida, boca arriba y quieta.
    this.badge.visible =
      this.selected && this.selectIndex !== null && this.selectIndex >= 1 && !this.dragging && this.home.flip < 0.5;
    // El foil es un holograma sobre la CARA: boca abajo no tiene sentido. Ahora
    // que vive en el mismo shader que el halo, se apaga por uniform en vez de
    // por `.visible`.
    (this.haloMaterial.uniforms['uFoilAmount'] as { value: number }).value =
      this.home.flip < 0.5 ? this.foilAmount : 0;

    this.applyTransform();
  }

  private applyTransform(): void {
    const liftY = this.dragging ? 0 : this.lift * (this.hovering ? HOVER_LIFT : SELECT_LIFT);
    this.group.position.set(this.home.x, this.home.y + this.home.arc + liftY, this.home.z);
    // El giro entra por `rotation.y`: como la carta ya esta acostada sobre la
    // mesa, girar sobre su eje largo la da vuelta de verdad (no la hace girar
    // como una calesita).
    this.group.rotation.set(
      this.home.rx,
      this.home.ry + Math.PI * this.home.flip,
      this.home.rz,
    );
    // La escala BASE (joker / carta jugada) y el SQUASH (`home.s*`) se
    // multiplican; el lift/drag se suma encima. Antes esto era un `setScalar`
    // que pisaba cualquier escala escrita por fuera: los jokers quedaban al
    // doble de lo disenado y el pulso de joker era invisible.
    const liftBoost = (this.dragging ? DRAG_SCALE : 1) + this.lift * 0.05;
    this.group.scale.set(
      this.baseScale * this.home.sx * liftBoost,
      this.baseScale * this.home.sy * liftBoost,
      this.baseScale * this.home.sz * liftBoost,
    );
  }

  /** Escala estructural (joker 0.5 / carta jugada 0.86). La aplica al toque. */
  setBaseScale(value: number): void {
    this.baseScale = value;
    this.applyTransform();
  }

  /** Escala estructural vigente. La leen el layout y los tests. */
  get scale(): number {
    return this.baseScale;
  }

  /** Posicion mundial del centro de la carta (para particulas y flechas). */
  worldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.face.getWorldPosition(target);
  }

  /**
   * Meshes contra los que se hace raycasting.
   *
   * Solo las dos caras: el halo y el anillo son mas grandes que la carta, y si
   * entraran al raycaster el hover parpadearia al pasar por el borde. Como la
   * cara es FrontSide y el dorso BackSide, el raycaster solo acierta el que se
   * esta viendo (respeta `material.side`), asi que boca abajo la carta sigue
   * siendo clickeable.
   */
  get pickTargets(): THREE.Object3D[] {
    return [this.face, this.back];
  }

  get pickTarget(): THREE.Mesh {
    return this.face;
  }

  get elementColor(): number {
    return ELEMENT_COLOR[(this.card?.def.element ?? 'neutral') as keyof typeof ELEMENT_COLOR];
  }

  get statuses(): StatusType[] {
    return (this.card?.statuses ?? []).map((s) => s.type);
  }

  /** La carta trae efectos propios (lo que la UI marca como "✦ HABILIDAD"). */
  get hasAbility(): boolean {
    return (this.card?.def.effects?.length ?? 0) > 0;
  }

  dispose(): void {
    this.disposed = true;
    this.flipHandle?.cancel();
    this.flipHandle = null;
    // Cortar tambien lo de GSAP: si no, una secuencia pendiente escribiria
    // sobre un material ya liberado.
    anim.killOf(this.home);
    this.faceMaterial.dispose();
    this.backMaterial.dispose();
    this.edgeMaterial.dispose();
    this.topMaterial.dispose();
    this.haloMaterial.dispose();
    this.badgeMaterial.dispose();
    this.group.clear();
  }
}

/** Libera la geometria compartida (solo al cerrar el juego). */
export function disposeSharedGeometry(): void {
  CARD_GEO.dispose();
  CARD_FACE_GEO.dispose();
  HALO_GEO.dispose();
  CARD_EDGE_GEO.dispose();
  BADGE_GEO.dispose();
  for (const texture of BADGE_TEXTURES.values()) texture.dispose();
  BADGE_TEXTURES.clear();
}
