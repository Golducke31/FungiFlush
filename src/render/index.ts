/** API publica de la capa de render. */
export { SceneManager } from './SceneManager';
export type { SceneCallbacks, SceneOptions } from './SceneManager';
export { ArtAssets, artKeyFor, artKeyForJoker } from './ArtAssets';
export type { ArtKey } from './ArtAssets';
export { Card3D, CARD_WIDTH, CARD_HEIGHT } from './Card3D';
export { CardTextureCache, createCardCanvas, createCardBackCanvas, createTableCanvas } from './CardTexture';
export type { CardTextureSpec } from './CardTexture';
export { CameraRig } from './CameraRig';
export { Interaction } from './Interaction';
export { SporeField } from './Particles';
export { TweenManager, Easing } from './Tween';
export type { TweenHandle, TweenOptions, EaseName } from './Tween';
export { ELEMENT_COLOR, RARITY_COLOR, UI_COLORS, hexToCss, hexToRgba, mixHex } from './palette';
