/** API publica de la capa de render. */
export { SceneManager } from './SceneManager';
export type { SceneCallbacks, SceneOptions, HandCardState } from './SceneManager';
export { ArtAssets, CARD_BACK_KEY, TABLE_KEY, artKeysFor, artKeysForJoker } from './ArtAssets';
export type { ArtKey, CardArtKey, LegacyArtKey } from './ArtAssets';
export { Card3D, CARD_WIDTH, CARD_HEIGHT } from './Card3D';
export type { CardHome, CardKind } from './Card3D';
export {
  CARD_DISPLAY_FONT,
  CARD_TEXT_FONT,
  CardTextureCache,
  createCardBackCanvas,
  createCardCanvas,
  createShadowCanvas,
  createTableCanvas,
} from './CardTexture';
export type { CardTextureSpec } from './CardTexture';
export { CameraRig } from './CameraRig';
export { DropZone, rectContains, resolveDropZone } from './DropZone';
export type { DropZoneHandle, DropZoneId, DropZoneOptions, ZoneRect } from './DropZone';
export { Interaction, DRAG_PLANE_Y } from './Interaction';
export type { InteractionCallbacks } from './Interaction';
export { SporeField } from './Particles';
export {
  FRAME_BUDGET_MS,
  FrameMonitor,
  TIER_CONFIG,
  detectTier,
  nextTierDown,
  readDeviceInfo,
  resolveQuality,
} from './Quality';
export type {
  DeviceInfo,
  QualitySetting,
  QualityTier,
  TierConfig,
  TierDetection,
  TierReason,
} from './Quality';
export { TweenManager, Easing } from './Tween';
export type { TweenHandle, TweenOptions, EaseName } from './Tween';
export { ELEMENT_COLOR, RARITY_COLOR, UI_COLORS, hexToCss, hexToRgba, mixHex } from './palette';
