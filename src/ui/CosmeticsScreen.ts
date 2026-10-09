/**
 * CosmeticsScreen.ts — Cosméticos del jugador.
 *
 * Pantalla donde se elige lo que "viste" el jugador: la Tarjeta de Jugador
 * (avatar, marco, título, fondo), el efecto de victoria, el dorso de carta y el
 * tapete. Es DOM puro: no conoce ni el motor ni los assets. Recibe el estado ya
 * resuelto (qué tiene el jugador, qué lleva puesto y las URLs de arte) y emite
 * `onEquip(kind, id)` cuando elige uno. Quien escribe en el perfil y le dice al
 * render qué textura poner es el controlador (`main.ts`), no esta pantalla.
 *
 * Las secciones salen de `COSMETIC_KINDS`: agregar un tipo nuevo no obliga a
 * tocar esta pantalla.
 */

import { t } from '@i18n/index';
import {
  COSMETIC_KINDS,
  COSMETIC_SECTION_KEY,
  cosmeticArtUrl,
  type CosmeticKind,
} from '../meta/Cosmetics';
import { buildPlayerCard, type PlayerCardState } from './PlayerCard';

export type { CosmeticKind };

export interface CosmeticsState {
  /** Ids poseídos POR TIPO (siempre incluye `'default'`). */
  owned: Record<CosmeticKind, string[]>;
  /** Lo que lleva puesto, por tipo. */
  equipped: Record<CosmeticKind, string>;
  /** Identidad para la Tarjeta de Jugador (preview en vivo). */
  player: PlayerCardState;
}

export interface CosmeticsCallbacks {
  /** El jugador eligió equipar `id` de tipo `kind`. */
  onEquip: (kind: CosmeticKind, id: string) => void;
  onClose: () => void;
}

/** Clave i18n del nombre de un cosmético. Sin clave propia, cae a un nombre legible del id. */
function cosmeticName(kind: CosmeticKind, id: string): string {
  const value = t(`cosmetics.name.${kind}.${id}`);
  // `t()` devuelve `[clave]` cuando la clave no existe: ahi va el nombre legible.
  if (!value.startsWith('[')) return value;
  return id
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Tarjeta de un cosmético: miniatura (si tiene arte) + nombre + estado.
 *
 * `data-act="cosmetic-equip"` + `data-kind` + `data-id` son los ganchos del
 * smoke. La tarjeta del equipado lleva `is-selected` y el botón queda
 * deshabilitado (no se equipa dos veces lo mismo).
 */
function cosmeticCard(
  kind: CosmeticKind,
  id: string,
  equipped: boolean,
  onEquip: (kind: CosmeticKind, id: string) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `cosmetics-card${equipped ? ' is-selected' : ''}`;
  card.dataset['kind'] = kind;
  card.dataset['id'] = id;

  const thumbUrl = cosmeticArtUrl(kind, id);
  if (thumbUrl) {
    const thumb = document.createElement('img');
    thumb.className = 'cosmetics-thumb';
    thumb.src = thumbUrl;
    thumb.alt = '';
    thumb.decoding = 'async';
    // Un cosmético sin arte todavía no rompe la tarjeta: la miniatura se va.
    thumb.addEventListener('error', () => thumb.remove());
    card.appendChild(thumb);
  }

  const body = document.createElement('span');
  body.className = 'cosmetics-body';
  const name = document.createElement('span');
  name.className = 'cosmetics-name';
  name.textContent = cosmeticName(kind, id);
  body.appendChild(name);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cosmetics-equip';
  button.dataset['act'] = 'cosmetic-equip';
  button.dataset['kind'] = kind;
  button.dataset['id'] = id;
  if (equipped) {
    button.textContent = t('cosmetics.equipped');
    button.classList.add('is-selected');
    button.disabled = true;
  } else {
    button.textContent = t('cosmetics.equip');
    button.addEventListener('click', () => onEquip(kind, id));
  }

  card.append(body, button);
  return card;
}

function section(
  kind: CosmeticKind,
  state: CosmeticsState,
  onEquip: (kind: CosmeticKind, id: string) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cosmetics-section';
  wrap.dataset['kind'] = kind;

  const title = document.createElement('h3');
  title.className = 'cosmetics-section-title';
  title.textContent = t(COSMETIC_SECTION_KEY[kind]);
  wrap.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'cosmetics-grid';
  const ids = state.owned[kind] ?? [];
  for (const id of ids) {
    grid.appendChild(cosmeticCard(kind, id, state.equipped[kind] === id, onEquip));
  }
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'cosmetics-empty';
    empty.textContent = t('cosmetics.none');
    grid.appendChild(empty);
  }
  wrap.appendChild(grid);
  return wrap;
}

export function buildCosmeticsPanel(state: CosmeticsState, callbacks: CosmeticsCallbacks): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-cosmetics';

  const shell = document.createElement('div');
  shell.className = 'cosmetics-shell';

  const head = document.createElement('div');
  head.className = 'cosmetics-head';
  const title = document.createElement('h2');
  title.className = 'cosmetics-title';
  title.textContent = t('cosmetics.title');
  const sub = document.createElement('p');
  sub.className = 'cosmetics-subtitle';
  sub.textContent = t('cosmetics.subtitle');
  head.append(title, sub);

  const body = document.createElement('div');
  body.className = 'cosmetics-body-scroll';

  // Preview en vivo de la Tarjeta de Jugador: cambiar de avatar/marco/título/
  // fondo se ve ACÁ, sin abrir el perfil.
  const preview = document.createElement('div');
  preview.className = 'cosmetics-player';
  const previewTitle = document.createElement('h3');
  previewTitle.className = 'cosmetics-section-title';
  previewTitle.textContent = t('cosmetics.playerCard');
  preview.append(previewTitle, buildPlayerCard(state.player));
  body.appendChild(preview);

  for (const kind of COSMETIC_KINDS) {
    body.appendChild(section(kind, state, callbacks.onEquip));
  }

  const footer = document.createElement('div');
  footer.className = 'cosmetics-footer';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cosmetics-close';
  close.dataset['act'] = 'cosmetics-close';
  close.textContent = t('ui.close');
  close.addEventListener('click', callbacks.onClose);
  footer.appendChild(close);

  shell.append(head, body, footer);
  panel.appendChild(shell);
  return panel;
}
