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
import type { CardTextureCache } from './CardTexture';
import { createHaloMaterial, tickShader } from './Shaders';
import { ELEMENT_COLOR, RARITY_COLOR } from './palette';
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
}

export type CardKind = 'card' | 'joker';

export class Card3D {
  readonly group = new THREE.Group();
  readonly kind: CardKind;
  readonly uid: string;

  card: CardInstance | null = null;
  joker: JokerInstance | null = null;

  /** Objeto de tweening: la posicion "en reposo" de la carta. */
  readonly home: CardHome = { x: 0, y: 0, z: 0, rx: -Math.PI / 2, ry: 0, rz: 0, flip: 0 };

  hovering = false;
  selected = false;
  /** 0..1, controla la elevacion y el brillo del halo. */
  private lift = 0;
  private selectGlow = 0;
  private disposed = false;
  /** Mientras se arrastra, el hover y la elevacion los maneja el arrastre. */
  private dragging = false;
  /** Tween del giro. Va aparte para poder cancelarlo sin tocar el vuelo. */
  private flipHandle: TweenHandle | null = null;

  private readonly face: THREE.Mesh;
  private readonly faceMaterial: THREE.MeshStandardMaterial;
  private readonly back: THREE.Mesh;
  private readonly backMaterial: THREE.MeshStandardMaterial;
  private readonly halo: THREE.Mesh;
  private readonly haloMaterial: THREE.ShaderMaterial;
  /** Cuanto foil le corresponde por rareza. 0 = no lleva. */
  private readonly foilAmount: number;

  private rarity: Rarity = 'common';

  constructor(uid: string, kind: CardKind, element: number, rarity: Rarity) {
    this.uid = uid;
    this.kind = kind;
    this.rarity = rarity;

    this.faceMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.58,
      metalness: 0.12,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.32,
    });
    this.face = new THREE.Mesh(CARD_GEO, this.faceMaterial);
    this.face.userData['card3d'] = this;
    this.face.position.y = 0.001;

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
    this.back.position.y = 0.001;

    // --- Halo: halo + anillo + foil en UN solo mesh ---
    //
    // Los tres son funciones de distancia sobre el mismo rectangulo, asi que
    // sumarlos en un fragment shader cuesta una fraccion de lo que costaban
    // tres quads aditivos (el anillo volvia a dibujar la misma geometria).
    this.foilAmount = rarity === 'mythic' ? 1.0 : rarity === 'legendary' ? 0.7 : 0;
    this.haloMaterial = createHaloMaterial({
      color: element,
      ringColor: element,
      intensity: 0.55,
      falloff: 9,
      foil: this.foilAmount,
    });
    this.halo = new THREE.Mesh(HALO_GEO, this.haloMaterial);
    this.halo.position.y = -0.004;

    this.group.add(this.halo);
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
    this.rarity = card.def.rarity;

    const statuses = card.statuses.map((s) => s.type);
    const key = [
      'card',
      card.def.id,
      lang,
      card.level,
      statuses.join(','),
      card.bonusSubstrate,
      card.bonusSpores,
    ].join('|');

    // El nombre y la descripcion van HORNEADOS en la textura (el canvas 2D
    // dibuja el texto con `fillText`). Si se manda la clave i18n cruda
    // (`card.mycelium_webcap.name`) en vez del texto traducido, eso es lo que
    // aparece en la carta. La cache indexa por idioma, asi que un cambio de
    // idioma fuerza una textura nueva con el texto nuevo.
    const texture = cache.get(
      key,
      {
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
      },
      art,
    );

    this.applyTexture(texture, card.def.element);
  }

  setJoker(
    joker: JokerInstance,
    cache: CardTextureCache,
    lang: string,
    art?: HTMLImageElement,
  ): void {
    this.joker = joker;
    this.rarity = joker.def.rarity;

    const key = ['joker', joker.def.id, lang].join('|');
    const isMutation = (joker.def.tags ?? []).includes('mutation');
    // Mismo razonamiento que en `setCard`: hornear el texto exige traducir
    // primero, no la clave cruda.
    const texture = cache.get(
      key,
      {
        kind: isMutation ? 'mutation' : 'joker',
        name: t(joker.def.nameKey),
        desc: t(joker.def.descKey),
        element: 'neutral',
        family: 'agaricaceae',
        rarity: joker.def.rarity,
        art: joker.def.art,
        cost: joker.def.cost,
      },
      art,
    );

    this.applyTexture(texture, 'neutral');
  }

  /**
   * Reemplaza solo el color del halo/anillo cuando cambia el elemento.
   * Evita recrear materiales en cada frame.
   */
  private applyTexture(texture: THREE.Texture, element: string): void {
    this.faceMaterial.map = texture;
    this.faceMaterial.emissiveMap = texture;
    this.faceMaterial.needsUpdate = true;

    const elementColor = ELEMENT_COLOR[element as keyof typeof ELEMENT_COLOR] ?? 0x9aa5b1;
    const rarityColor = RARITY_COLOR[this.rarity];
    (this.haloMaterial.uniforms['uColor'] as { value: THREE.Color }).value.setHex(
      rarityColor ?? elementColor,
    );
    (this.haloMaterial.uniforms['uRingColor'] as { value: THREE.Color }).value.setHex(elementColor);
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

    // Interpolacion exponencial independiente del framerate.
    const k = 1 - Math.exp(-dt * 14);
    this.lift += (targetLift - this.lift) * k;
    this.selectGlow += (targetGlow - this.selectGlow) * k;

    tickShader(this.haloMaterial, time);

    // Intensidad del halo: base + hover/seleccion + foil.
    const base = this.kind === 'joker' ? 0.42 : 0.3;
    const pulse = 0.55 + this.selectGlow * 1.5 + this.lift * 0.7;
    (this.haloMaterial.uniforms['uIntensity'] as { value: number }).value = base + pulse * 0.55;
    (this.haloMaterial.uniforms['uRingIntensity'] as { value: number }).value =
      this.selectGlow * 0.85;
    // El foil es un holograma sobre la CARA: boca abajo no tiene sentido. Ahora
    // que vive en el mismo shader que el halo, se apaga por uniform en vez de
    // por `.visible`.
    (this.haloMaterial.uniforms['uFoilAmount'] as { value: number }).value =
      this.home.flip < 0.5 ? this.foilAmount : 0;

    this.applyTransform();
  }

  private applyTransform(): void {
    const liftY = this.dragging ? 0 : this.lift * (this.hovering ? HOVER_LIFT : SELECT_LIFT);
    this.group.position.set(this.home.x, this.home.y + liftY, this.home.z);
    // El giro entra por `rotation.y`: como la carta ya esta acostada sobre la
    // mesa, girar sobre su eje largo la da vuelta de verdad (no la hace girar
    // como una calesita).
    this.group.rotation.set(
      this.home.rx,
      this.home.ry + Math.PI * this.home.flip,
      this.home.rz,
    );
    const scale = (this.dragging ? DRAG_SCALE : 1) + this.lift * 0.05;
    this.group.scale.setScalar(scale);
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

  dispose(): void {
    this.disposed = true;
    this.flipHandle?.cancel();
    this.flipHandle = null;
    this.faceMaterial.dispose();
    this.backMaterial.dispose();
    this.haloMaterial.dispose();
    this.group.clear();
  }
}

/** Libera la geometria compartida (solo al cerrar el juego). */
export function disposeSharedGeometry(): void {
  CARD_GEO.dispose();
  HALO_GEO.dispose();
}
