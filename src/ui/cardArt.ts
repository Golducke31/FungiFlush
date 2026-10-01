/**
 * cardArt.ts — Cara de carta como data-URL, compartida por los paneles en DOM.
 *
 * POR QUE EXISTE. La tienda sabia dibujar la cara REAL de una carta (canvas con
 * la ilustracion a sangre + nombre + chips) y el panel de recompensa no: mostraba
 * solo texto. Dos caminos para la misma pieza es garantia de que uno quede viejo.
 * Aca vive la unica implementacion, y quien la necesite la importa.
 *
 * NO conoce las reglas del juego mas alla de leer definiciones del registro: es
 * una funcion de PRESENTACION. El llamador decide que imagen real le pasa (el
 * render es quien tiene los `HTMLImageElement` ya decodificados).
 */

import type {
  CardDefinition,
  GameEngine,
  JokerDefinition,
  ShopOffer,
} from '@engine/index';
import { createCardCanvas, type CardTextureSpec } from '@render/index';

/** Imagenes reales disponibles para componer una cara. */
export interface CardArtSources {
  /** Ilustracion de una carta del registro, si el render ya la decodifico. */
  card?: (def: CardDefinition) => HTMLImageElement | undefined;
  /** Ilustracion de un joker del registro. */
  joker?: (def: JokerDefinition) => HTMLImageElement | undefined;
}

/**
 * Compone la cara de una carta y la devuelve como data-URL lista para un `<img>`.
 * Devuelve `null` si no hay nada que dibujar: el llamador decide el respaldo.
 *
 * `createCardCanvas` usa la ilustracion real como fondo a sangre y dibuja encima
 * el nombre y los chips; sin ella cae a la silueta procedural, que no es la cara
 * que el jugador tiene en la mano.
 */
export function cardFaceUrl(spec: CardTextureSpec, realArt?: HTMLImageElement): string | null {
  try {
    const canvas = createCardCanvas(spec, realArt);
    try {
      return canvas.toDataURL('image/webp', 0.85);
    } catch {
      // Algun entorno no codifica webp en canvas: caer a png para no perder
      // la miniatura.
      return canvas.toDataURL('image/png');
    }
  } catch {
    return null;
  }
}

/**
 * Cara de una carta del catalogo (no de una oferta). La usan la recompensa y
 * cualquier panel que quiera mostrar una carta real con su arte. La definicion
 * ya trae todo lo que la cara necesita, asi que no hace falta el motor.
 */
export function cardDefFaceUrl(
  def: CardDefinition,
  translate: (key: string) => string,
  realArt?: HTMLImageElement,
): string | null {
  const spec: CardTextureSpec = {
    kind: 'card',
    name: translate(def.nameKey),
    desc: translate(def.descKey),
    element: def.element,
    family: def.family,
    rarity: def.rarity,
    art: def.art,
    substrate: def.baseSubstrate,
    spores: def.baseSpores,
  };
  return cardFaceUrl(spec, realArt);
}

/**
 * Cara de una oferta de tienda (carta, joker, mutacion o voucher). El dinero no
 * tiene carta: devuelve `null` y el llamador cae a su propio icono.
 *
 * El voucher SI tiene cara: no es una pieza de mazo, pero necesita verse al lado
 * de las cartas sin parecer una. Su `art` es procedural (hue/patron/silueta), asi
 * que se compone igual que un joker — sin ilustracion real.
 */
export function offerFaceUrl(
  offer: ShopOffer,
  engine: GameEngine,
  translate: (key: string) => string,
  sources: CardArtSources = {},
): string | null {
  let spec: CardTextureSpec | null = null;
  let realArt: HTMLImageElement | undefined;
  try {
    if (offer.kind === 'card') {
      const def = engine.registry.tryGetCard(offer.refId);
      if (!def) return null;
      realArt = sources.card?.(def);
      spec = {
        kind: 'card',
        name: translate(offer.nameKey),
        desc: translate(offer.descKey),
        element: def.element,
        family: def.family,
        rarity: def.rarity,
        art: def.art,
        substrate: def.baseSubstrate,
        spores: def.baseSpores,
      };
    } else if (offer.kind === 'joker' || offer.kind === 'mutation') {
      const def = engine.registry.tryGetJoker(offer.refId);
      if (!def) return null;
      realArt = sources.joker?.(def);
      spec = {
        kind: offer.kind === 'mutation' ? 'mutation' : 'joker',
        name: translate(offer.nameKey),
        desc: translate(offer.descKey),
        element: 'neutral',
        family: 'agaricaceae',
        rarity: def.rarity,
        art: def.art,
        cost: def.cost,
      };
    } else if (offer.kind === 'voucher') {
      const def = engine.registry.tryGetVoucher(offer.refId);
      if (!def) return null;
      spec = {
        // `rarity` es obligatorio en el spec pero un voucher no tiene: se usa
        // 'rare' como material de base y el dorado del `kind` manda encima.
        kind: 'voucher',
        name: translate(offer.nameKey),
        desc: translate(offer.descKey),
        element: 'neutral',
        family: 'agaricaceae',
        rarity: 'rare',
        art: def.art,
        cost: def.cost,
      };
    }
  } catch {
    return null;
  }
  if (!spec) return null;
  return cardFaceUrl(spec, realArt);
}
