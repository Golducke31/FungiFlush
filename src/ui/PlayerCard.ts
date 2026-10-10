/**
 * PlayerCard.ts — La Tarjeta de Jugador: la identidad visual de la Colonia.
 *
 * Composicion (de abajo hacia arriba): fondo -> avatar -> marco -> nombre +
 * titulo + nivel de Colonia. Es lo que las recompensas nombradas "visten".
 *
 * DOM puro: no conoce el perfil ni los assets. Recibe las URLs ya resueltas y
 * las muestra; una imagen que no carga se OCULTA sola, asi que un cosmetico sin
 * arte todavia NO rompe la tarjeta (se ve el fondo por defecto).
 */

import { t } from '@i18n/index';

export interface PlayerCardState {
  /** Nombre a mostrar (cuenta vinculada, o un generico). */
  name: string;
  /** Clave i18n del titulo equipado, o null si no hay ninguno. */
  titleKey: string | null;
  /** Clave i18n de la banda del nivel ("Brote Micelial"). */
  levelNameKey: string;
  /** Nivel de la Colonia. */
  level: number;
  /** URLs de arte ya resueltas (o null). */
  avatarUrl: string | null;
  frameUrl: string | null;
  backgroundUrl: string | null;
}

/** `<img>` que se elimina solo si el archivo no existe. `null` si no hay URL. */
function image(className: string, url: string | null, alt = ''): HTMLImageElement | null {
  if (!url) return null;
  const img = document.createElement('img');
  img.className = className;
  img.src = url;
  img.alt = alt;
  img.decoding = 'async';
  img.addEventListener('error', () => img.remove());
  return img;
}

export function buildPlayerCard(state: PlayerCardState): HTMLElement {
  const card = document.createElement('div');
  card.className = 'player-card';

  const bg = image('player-card-bg', state.backgroundUrl);
  if (bg) card.appendChild(bg);

  const inner = document.createElement('div');
  inner.className = 'player-card-inner';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'player-card-avatar';
  const avatar = image('player-card-avatar-img', state.avatarUrl);
  if (avatar) avatarWrap.appendChild(avatar);
  const frame = image('player-card-frame', state.frameUrl);
  if (frame) avatarWrap.appendChild(frame);

  const meta = document.createElement('div');
  meta.className = 'player-card-meta';

  const name = document.createElement('span');
  name.className = 'player-card-name';
  name.textContent = state.name;

  const title = document.createElement('span');
  title.className = 'player-card-title';
  if (state.titleKey) {
    title.textContent = t(state.titleKey);
  } else {
    title.classList.add('is-empty');
    title.textContent = t('cosmetics.name.title.default');
  }

  const level = document.createElement('span');
  level.className = 'player-card-level';
  level.textContent = `${t(state.levelNameKey)} · ${t('colony.levelLabel', { level: state.level })}`;

  meta.append(name, title, level);
  inner.append(avatarWrap, meta);
  card.appendChild(inner);
  return card;
}

/**
 * MINI Tarjeta de Jugador para el MENU: la misma identidad (avatar + marco +
 * titulo) pero COMPACTA, para vivir en la esquina superior como un boton mas.
 *
 * Diferencia clave con `buildPlayerCard`: aca el nombre NO va (ya se ve el
 * titulo y el nivel), y el fondo decorativo se omite para no recargar un chip de
 * ~40px. Si no hay avatar, el slot queda con un placeholder (una seta muda) para
 * que el boton SIEMPRE tenga cara, incluso en un perfil recien creado.
 *
 * El elemento devuelto NO es un `<button>`: el llamador lo envuelve (o le pone
 * el handler), asi esta funcion se queda en "dibujar la tarjeta".
 */
export function buildMiniPlayerCard(state: PlayerCardState): HTMLElement {
  const card = document.createElement('div');
  card.className = 'player-card player-card--mini';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'player-card-avatar';
  const avatar = image('player-card-avatar-img', state.avatarUrl);
  if (avatar) avatarWrap.appendChild(avatar);
  // Placeholder: sin avatar, una seta para que el chip no quede vacio.
  else avatarWrap.classList.add('is-placeholder');
  const frame = image('player-card-frame', state.frameUrl);
  if (frame) avatarWrap.appendChild(frame);

  const meta = document.createElement('div');
  meta.className = 'player-card-meta';
  const title = document.createElement('span');
  title.className = 'player-card-title';
  if (state.titleKey) {
    title.textContent = t(state.titleKey);
  } else {
    title.classList.add('is-empty');
    title.textContent = t('cosmetics.name.title.default');
  }
  const level = document.createElement('span');
  level.className = 'player-card-level';
  level.textContent = t('colony.levelLabel', { level: state.level });
  meta.append(title, level);

  card.append(avatarWrap, meta);
  return card;
}
