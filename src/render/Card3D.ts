/**
 * Card3D.ts — La carta en el mundo 3D.
 *
 * Una carta es un PlaneGeometry con textura procedural, mas dos quads
 * adicionales: un halo aditivo (shader) y un anillo de seleccion.
 *
 * CLAVE DE ARQUITECTURA: el tween NO anima `group.position` directamente,
 * porque el hover tambien mueve la carta y se pisarian. En su lugar se anima
 * `home` (un objeto plano) y `update()` compone la transformacion final:
 *
 *     group.position = home + elevacion_por_hover
 *
 * Asi el vuelo de la carta y el efecto de hover conviven sin conflictos.
 */

import * as THREE from 'three';
import type { CardInstance, JokerInstance, Rarity, StatusType } from '@engine/index';
import type { CardTextureCache } from './CardTexture';
import { createFoilMaterial, createGlowMaterial, tickShader } from './Shaders';
import { ELEMENT_COLOR, RARITY_COLOR } from './palette';

export const CARD_WIDTH = 2.2;
export const CARD_HEIGHT = 3.2;

/** Cuanto se eleva la carta en hover (unidades de mundo). */
const HOVER_LIFT = 0.9;
/** Cuanto se eleva una carta seleccionada. */
const SELECT_LIFT = 0.42;

const CARD_GEO = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
const GLOW_GEO = new THREE.PlaneGeometry(CARD_WIDTH * 1.3, CARD_HEIGHT * 1.24);

/** Posicion/rotacion "en reposo": es lo unico que animan los tweens. */
export interface CardHome {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export type CardKind = 'card' | 'joker';

export class Card3D {
  readonly group = new THREE.Group();
  readonly kind: CardKind;
  readonly uid: string;

  card: CardInstance | null = null;
  joker: JokerInstance | null = null;

  /** Objeto de tweening: la posicion "en reposo" de la carta. */
  readonly home: CardHome = { x: 0, y: 0, z: 0, rx: -Math.PI / 2, ry: 0, rz: 0 };

  hovering = false;
  selected = false;
  /** 0..1, controla la elevacion y el brillo del halo. */
  private lift = 0;
  private selectGlow = 0;
  private disposed = false;

  private readonly face: THREE.Mesh;
  private readonly faceMaterial: THREE.MeshStandardMaterial;
  private readonly glow: THREE.Mesh;
  private readonly glowMaterial: THREE.ShaderMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.ShaderMaterial;
  private readonly foil: THREE.Mesh | null = null;
  private readonly foilMaterial: THREE.ShaderMaterial | null = null;

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

    this.glowMaterial = createGlowMaterial(element, 0.55, 9);
    this.glow = new THREE.Mesh(GLOW_GEO, this.glowMaterial);
    this.glow.position.y = -0.004;

    this.ringMaterial = createGlowMaterial(0xffffff, 0, 6.5);
    this.ringMaterial.uniforms['uInner'] = { value: new THREE.Vector2(0.62, 0.62) };
    this.ring = new THREE.Mesh(GLOW_GEO, this.ringMaterial);
    this.ring.position.y = -0.008;
    this.ring.scale.setScalar(1.14);

    // Legendarias y miticas llevan foil holografico.
    if (rarity === 'legendary' || rarity === 'mythic') {
      this.foilMaterial = createFoilMaterial(rarity === 'mythic' ? 1.0 : 0.7);
      this.foil = new THREE.Mesh(GLOW_GEO, this.foilMaterial);
      this.foil.position.y = -0.006;
      this.foil.scale.setScalar(1.06);
      this.group.add(this.foil);
    }

    this.group.add(this.glow);
    this.group.add(this.ring);
    this.group.add(this.face);

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

    const texture = cache.get(
      key,
      {
        kind: 'card',
        name: card.def.nameKey,
        desc: card.def.descKey,
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
    const texture = cache.get(
      key,
      {
        kind: isMutation ? 'mutation' : 'joker',
        name: joker.def.nameKey,
        desc: joker.def.descKey,
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
    (this.glowMaterial.uniforms['uColor'] as { value: THREE.Color }).value.setHex(
      rarityColor ?? elementColor,
    );
    (this.ringMaterial.uniforms['uColor'] as { value: THREE.Color }).value.setHex(elementColor);
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

    const targetLift = this.hovering ? 1 : this.selected ? 0.55 : 0;
    const targetGlow = this.selected || this.hovering ? 1 : 0;

    // Interpolacion exponencial independiente del framerate.
    const k = 1 - Math.exp(-dt * 14);
    this.lift += (targetLift - this.lift) * k;
    this.selectGlow += (targetGlow - this.selectGlow) * k;

    tickShader(this.glowMaterial, time);
    tickShader(this.ringMaterial, time);
    if (this.foilMaterial) tickShader(this.foilMaterial, time);

    // Intensidad del halo: base + hover/seleccion + foil.
    const base = this.kind === 'joker' ? 0.42 : 0.3;
    const pulse = 0.55 + this.selectGlow * 1.5 + this.lift * 0.7;
    (this.glowMaterial.uniforms['uIntensity'] as { value: number }).value = base + pulse * 0.55;
    (this.ringMaterial.uniforms['uIntensity'] as { value: number }).value = this.selectGlow * 0.85;

    this.applyTransform();
  }

  private applyTransform(): void {
    const liftY = this.lift * (this.hovering ? HOVER_LIFT : SELECT_LIFT);
    this.group.position.set(this.home.x, this.home.y + liftY, this.home.z);
    this.group.rotation.set(this.home.rx, this.home.ry, this.home.rz);
    const scale = 1 + this.lift * 0.05;
    this.group.scale.setScalar(scale);
  }

  /** Posicion mundial del centro de la carta (para particulas y flechas). */
  worldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.face.getWorldPosition(target);
  }

  /**
   * Mesh contra el que se hace raycasting.
   * Solo la cara: el halo y el anillo son mas grandes que la carta, y si
   * entraran al raycaster el hover parpadearia al pasar por el borde.
   */
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
    this.faceMaterial.dispose();
    this.glowMaterial.dispose();
    this.ringMaterial.dispose();
    this.foilMaterial?.dispose();
    this.group.clear();
  }
}

/** Libera la geometria compartida (solo al cerrar el juego). */
export function disposeSharedGeometry(): void {
  CARD_GEO.dispose();
  GLOW_GEO.dispose();
}
