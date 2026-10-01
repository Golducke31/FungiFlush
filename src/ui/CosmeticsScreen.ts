/**
 * CosmeticsScreen.ts — Cosméticos del jugador (R4b).
 *
 * Pantalla donde se elige el dorso de carta y el tapete. Es DOM puro: no conoce
 * ni el motor ni los assets. Recibe el estado ya resuelto (qué tiene el jugador
 * y qué lleva puesto) y emite `onEquip(kind, id)` cuando elige uno. Quien
 * escribe en el perfil y le dice al render qué textura poner es el controlador
 * (`main.ts`), no esta pantalla.
 *
 * Hoy solo existe la opción `default` de cada tipo: el panel ya funciona de
 * punta a punta (listar, marcar el equipado, equipar, persistir) y está listo
 * para que un fieltro/dorso nuevo —con su arte generado— caiga sin tocar esto.
 */

import { t } from '@i18n/index';

export type CosmeticKind = 'cardback' | 'felt';

export interface CosmeticsState {
  /** Ids de cosméticos que el jugador posee, por tipo. */
  owned: string[];
  /** Lo que lleva puesto actualmente. */
  equipped: { cardback: string; felt: string };
}

export interface CosmeticsCallbacks {
  /** El jugador eligió equipar `id` de tipo `kind`. */
  onEquip: (kind: CosmeticKind, id: string) => void;
  onClose: () => void;
}

/** Clave i18n del nombre de un cosmético. `default` es literal; el resto cae a un nombre legible del id. */
function cosmeticName(kind: CosmeticKind, id: string): string {
  if (id === 'default') return t(`cosmetics.${kind}.default`);
  // Futuros cosméticos traen su propia clave; si no está, un nombre legible.
  return id
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Tarjeta de un cosmético: nombre + estado (Equipado / Equipar).
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
  titleKey: string,
  kind: CosmeticKind,
  state: CosmeticsState,
  onEquip: (kind: CosmeticKind, id: string) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cosmetics-section';

  const title = document.createElement('h3');
  title.className = 'cosmetics-section-title';
  title.textContent = t(titleKey);
  wrap.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'cosmetics-grid';
  for (const id of state.owned) {
    grid.appendChild(cosmeticCard(kind, id, state.equipped[kind] === id, onEquip));
  }
  if (state.owned.length === 0) {
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
  body.appendChild(section('cosmetics.cardback', 'cardback', state, callbacks.onEquip));
  body.appendChild(section('cosmetics.felt', 'felt', state, callbacks.onEquip));

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
