/**
 * Cosmetics.ts — Tipos y resolutores de los cosmeticos del jugador.
 *
 * PURO: no toca el DOM ni el motor. La pantalla (`ui/CosmeticsScreen.ts`), la
 * Tarjeta de Jugador (`ui/PlayerCard.ts`) y el controlador (`main.ts`) comparten
 * de aca el tipo `CosmeticKind`, el orden de las secciones y el resolvedor de
 * arte, para no tener tres listas de tipos que se desincronicen.
 *
 * Los cosmeticos de la Colonia (avatar / marco / titulo / fondo / efecto) salen
 * de `meta/ColonyRewards.ts`: reclamar mete su `cosmeticId` en
 * `ProfileSave.cosmetics.owned`.
 */

export type CosmeticKind =
  | 'avatar'
  | 'frame'
  | 'title'
  | 'background'
  | 'victoryFx'
  | 'cardback'
  | 'felt';

/**
 * Orden de las secciones en Personalizar.
 *
 * La Tarjeta de Jugador va primero (avatar -> marco -> titulo -> fondo) y el
 * efecto de victoria despues; el dorso y el tapete (los clasicos de la run)
 * cierran, porque son los que el jugador ya conoce.
 */
export const COSMETIC_KINDS: readonly CosmeticKind[] = [
  'avatar',
  'frame',
  'title',
  'background',
  'victoryFx',
  'cardback',
  'felt',
];

/** Clave i18n del titulo de la seccion de cada tipo. */
export const COSMETIC_SECTION_KEY: Record<CosmeticKind, string> = {
  avatar: 'cosmetics.avatar',
  frame: 'cosmetics.frame',
  title: 'cosmetics.titles',
  background: 'cosmetics.background',
  victoryFx: 'cosmetics.victoryFx',
  cardback: 'cosmetics.cardback',
  felt: 'cosmetics.felt',
};

/**
 * URL del arte de un cosmetico de la Tarjeta de Jugador, o `null` si ese tipo no
 * tiene arte propio (el titulo es texto; el dorso y el tapete tienen su propio
 * pipeline de texturas en el render).
 *
 * La convencion de archivo es la misma que el resto del arte:
 * `public/art/art_<clave>_<id>.webp`. Si el archivo no existe, la UI lo oculta
 * (el `onerror` del `<img>`), asi que un cosmetico sin arte NO rompe el panel.
 */
export function cosmeticArtUrl(kind: CosmeticKind, id: string): string | null {
  if (id === 'default') return null;
  switch (kind) {
    case 'avatar':
      return `/art/art_avatar_${id}.webp`;
    case 'frame':
      return `/art/art_frame_${id}.webp`;
    case 'background':
      return `/art/art_bgcard_${id}.webp`;
    default:
      return null;
  }
}
