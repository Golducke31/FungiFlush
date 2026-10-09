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
 * Cache de caras compuestas.
 *
 * POR QUE. Abrir la Coleccion arma la cara de TODAS las piezas del registro
 * (77 cartas + 24 simbiontes + 6 mutaciones). Cada cara es un canvas de 512x744
 * mas su encode WebP: ~1-2 s de trabajo SINCRONO en el hilo principal, dentro
 * del click. Y se rehacia entero en cada apertura, porque la cara de una pieza
 * del catalogo no cambia nunca dentro de una sesion.
 *
 * La clave incluye el TEXTO YA TRADUCIDO (nombre + descripcion) porque el idioma
 * va horneado en la cara. Asi un cambio de idioma produce claves nuevas y el
 * cache se invalida solo, sin tener que avisarle a nadie.
 */
const faceCache = new Map<string, string | null>();

/** Cuantas caras se COMPUSIERON de verdad (misses del cache). Lo lee el probe. */
let composed = 0;

/** Tamanio actual del cache. Lo lee el probe. */
export function faceCacheSize(): number {
  return faceCache.size;
}

/** Cuantas composiciones reales (canvas + encode) se hicieron en esta sesion. */
export function faceComposeCount(): number {
  return composed;
}

/** Vacia el cache. Solo para tests: en runtime la clave se auto-invalida. */
export function clearFaceCache(): void {
  faceCache.clear();
  composed = 0;
}

function memoFace(key: string, build: () => string | null): string | null {
  const hit = faceCache.get(key);
  if (hit !== undefined) return hit;
  composed++;
  const value = build();
  faceCache.set(key, value);
  return value;
}

/**
 * Compone la cara de una carta y la devuelve como data-URL lista para un `<img>`.
 * Devuelve `null` si no hay nada que dibujar: el llamador decide el respaldo.
 *
 * `createCardCanvas` usa la ilustracion real como fondo a sangre y dibuja encima
 * el nombre y los chips; sin ella cae a la silueta procedural, que no es la cara
 * que el jugador tiene en la mano.
 *
 * NO cachea: la usan tambien las ofertas de tienda, que son efimeras. Quien
 * quiere cache usa `cardDefFaceUrl` / `jokerDefFaceUrl`.
 */
export function cardFaceUrl(
  spec: CardTextureSpec,
  realArt?: HTMLImageElement,
): string | null {
  try {
    const canvas = createCardCanvas(spec, realArt, 'full');
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
 *
 * MEMOIZADA por (id, nombre, descripcion): la cara de una pieza del catalogo es
 * estable dentro de una sesion y se pide muchas veces (Coleccion, mazo, sobres).
 */
export function cardDefFaceUrl(
  def: CardDefinition,
  translate: (key: string) => string,
  realArt?: HTMLImageElement,
): string | null {
  const name = translate(def.nameKey);
  const desc = translate(def.descKey);
  return memoFace(`card:${def.id}:${name}:${desc}`, () => {
    const spec: CardTextureSpec = {
      kind: 'card',
      name,
      desc,
      element: def.element,
      family: def.family,
      rarity: def.rarity,
      art: def.art,
      substrate: def.baseSubstrate,
      spores: def.baseSpores,
      // Taxonomia traducida para la cabecera: Elemento · Familia se leen en la
      // CARA, no solo en el tooltip. La spec no traduce, asi que las etiquetas
      // viajan ya resueltas.
      elementLabel: translate(`element.${def.element}`),
      familyLabel: translate(`family.${def.family}`),
      // P1.1/P1.2 — Misma jerarquia que en la mesa: si la carta tiene habilidad,
      // la cara de la tienda/recompensa/coleccion dibuja la etiqueta y el panel
      // lila. El plan exige el mismo tratamiento en la carta ampliada.
      hasAbility: (def.effects?.length ?? 0) > 0,
    };
    return cardFaceUrl(spec, realArt);
  });
}

/**
 * Cara de un SIMBIONTE del catalogo (no de una oferta). La usa la Coleccion en
 * grilla: un simbionte se muestra con la misma cara que tendria en la tienda
 * (marco lila + nombre + chips), no con la ilustracion suelta.
 *
 * Los jokers NO tienen ilustracion propia: reusan el arte por elemento x rareza
 * (`artKeysForJoker`), asi que `realArt` es opcional y suele venir del render.
 * MEMOIZADA igual que las cartas.
 */
export function jokerDefFaceUrl(
  def: JokerDefinition,
  translate: (key: string) => string,
  realArt?: HTMLImageElement,
): string | null {
  const name = translate(def.nameKey);
  const desc = translate(def.descKey);
  return memoFace(`joker:${def.id}:${name}:${desc}`, () => {
    const spec: CardTextureSpec = {
      kind: 'joker',
      name,
      desc,
      element: 'neutral',
      family: 'agaricaceae',
      rarity: def.rarity,
      art: def.art,
      cost: def.cost,
    };
    return cardFaceUrl(spec, realArt);
  });
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
        elementLabel: translate(`element.${def.element}`),
        familyLabel: translate(`family.${def.family}`),
        hasAbility: (def.effects?.length ?? 0) > 0,
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
