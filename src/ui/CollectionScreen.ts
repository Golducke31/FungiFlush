/**
 * CollectionScreen.ts — La coleccion permanente del jugador.
 *
 * Dos cosas que la hacen valiosa mas alla de "una lista de cartas":
 *
 *  1. **Muestra lo que falta.** Una carta no descubierta aparece como silueta:
 *     da un objetivo concreto ("me faltan 3 amanitas").
 *  2. **Muestra lo bloqueado con el nombre del pack.** El contenido de un DLC
 *     que no se compro se ve grisado y con su origen. Es la superficie de venta
 *     dentro del juego: un DLC que no se ve no se vende.
 *
 * El panel no conoce ni el registro ni los entitlements: recibe entradas ya
 * resueltas. Eso lo mantiene testeable y desacoplado.
 */

import type { ElementType, FamilyType, Rarity } from '@engine/index';
import { t } from '@i18n/index';
import { ELEMENT_COLOR, RARITY_COLOR, hexToCss } from '@render/palette';

export type CollectionState = 'owned' | 'locked' | 'hidden' | 'unlocked';

export interface CollectionEntry {
  id: string;
  nameKey: string;
  element: ElementType;
  rarity: Rarity;
  kind: 'card' | 'joker';
  state: CollectionState;
  /** Clave i18n del pack que aporta el contenido (para el rotulo de bloqueo). */
  packTitleKey?: string;
  /**
   * Clave i18n que EXPLICA el candado cuando el motivo es ganarselo jugando
   * (R2). Gana sobre `packTitleKey`: decirle "Pack base" a una carta que se
   * abre ganando en el ante 6 es una mentira, aunque el pack sea correcto.
   */
  lockReasonKey?: string;
  /** Origen del desbloqueo de retencion ('daily' | 'achievement' | 'season'). */
  unlockSource?: string;
  /** El jugador ya la vio en una partida. */
  seen: boolean;
  /**
   * Cuantas copias de esta carta posee el jugador (solo CARTAS; los jokers no
   * llevan contador porque los sobres nunca los entregan).
   *
   * Es lo que permite mostrar "xN" en vez de repetir la misma carta tantas
   * veces como copias haya. `0`/`undefined` = no mostrar badge.
   */
  count?: number;
  /**
   * Familia taxonomica. Los Simbiontes van a `neutral` (no pertenecen a una
   * familia micologica): la GRILLA los agrupa aparte, en su propia seccion.
   */
  family: FamilyType;
  /**
   * Id del pack que aporta la pieza (`base`, `deep_mycelium`, ...). La grilla
   * agrupa por pack ANTES que por familia: es la unidad de compra, asi que el
   * jugador ve de un golpe que agrego el sobre que abrio.
   */
  packId: string;
  /**
   * Cara ya compuesta (data-URL) para la vista de GRILLA. La arma `main.ts`, que
   * es quien tiene las imagenes reales decodificadas; el panel no conoce el
   * registro ni el render. `null` = sin arte disponible.
   *
   * Opcional: en modo perezoso `main.ts` NO la compone de entrada (componer 101
   * caras por apertura es lo que hacia lenta la Coleccion) y en su lugar pasa
   * `faceProvider`, que solo se evalua cuando la celda entra en viewport.
   * `resolveFace()` usa el proveedor si existe y sino cae a `faceUrl`.
   */
  faceUrl?: string | null;
  /**
   * Proveedor perezoso de la cara. Se evalua UNA vez, cuando la celda (o el
   * detalle) entra en pantalla; la composicion en si esta memoizada en
   * `cardArt.ts`, asi que volver a abrir la Coleccion no la recalcula.
   */
  faceProvider?: () => string | null;
  /** Clave i18n de la descripcion de la carta, para el detalle. */
  descKey?: string;
  /** Sustrato base / Esporas base, solo para las cartas (detalle de la grilla). */
  substrate?: number;
  spores?: number;
}

/**
 * Resuelve la cara de una entrada: prefiere el proveedor perezoso (que solo
 * compone la cara al entrar en viewport) y cae a `faceUrl` precompuesto si
 * existe. La composicion esta memoizada en `cardArt.ts`, asi que repetir la
 * llamada (celda + detalle) no la recalcula.
 */
function resolveFace(entry: CollectionEntry): string | null {
  if (entry.faceProvider) return entry.faceProvider();
  return entry.faceUrl ?? null;
}

export interface CollectionCallbacks {
  onClose: () => void;
  /** Opcional: abrir la tienda de expansiones desde una carta bloqueada. */
  onOpenStore?: () => void;
  /** Opcional: abrir el pase de temporada. */
  onOpenPass?: () => void;
  /** Opcional: los Cosméticos viven dentro de la Coleccion. */
  onOpenCosmetics?: () => void;
  /** Opcional: los Sobres viven dentro de la Coleccion. */
  onOpenPacks?: () => void;
  /**
   * Opcional: cambiar a la vista de EXHIBICION (carrusel 3D). Solo lo ofrece la
   * grilla: es la unica superficie desde la que se puede pedir el cambio.
   */
  onOpenExhibition?: () => void;
  /** Sobres sin abrir, para el contador del boton. */
  packsPending?: number;
  /**
   * Opcional: abrir los Sobres de EXPANSION. Son un boton APARTE del base a
   * proposito: abren un pool distinto (`deep_mycelium`), asi que mezclarlos en un
   * solo boton obligaria al jugador a saber cual se va a gastar.
   */
  onOpenExpansionPacks?: () => void;
  /** Sobres de expansion sin abrir, para su propio contador. */
  expansionPacksPending?: number;
}

type Filter = 'all' | 'cards' | 'jokers' | 'locked' | 'unlocked';

/**
 * Rotulo de un candado. El ORDEN importa: una puerta por jugar se explica con
 * su condicion ("ganá un ciego en el ante 6") y no con el pack, porque el pack
 * SI esta comprado. Mostrar "Pack base" ahi seria una mentira y ademas no le
 * dice al jugador que hacer.
 */
function lockLabel(entry: CollectionEntry): string {
  if (entry.lockReasonKey) return t(entry.lockReasonKey);
  return t('collection.locked', {
    pack: entry.packTitleKey ? t(entry.packTitleKey) : entry.id,
  });
}

/**
 * Pildora "xN" con las copias poseidas de una carta.
 *
 * Devuelve `null` cuando no corresponde mostrarla (joker, cero copias, carta no
 * descubierta o bloqueada): asi el llamador no tiene que repetir la condicion.
 */
function countBadge(entry: CollectionEntry): HTMLElement | null {
  const count = entry.count ?? 0;
  if (entry.kind !== 'card' || count <= 0) return null;
  if (entry.state === 'locked') return null;
  if (!entry.seen && entry.state !== 'unlocked') return null;
  const badge = document.createElement('span');
  badge.className = 'collection-count';
  badge.textContent = `x${count}`;
  badge.title = t('collection.copies', { count });
  badge.setAttribute('aria-label', t('collection.copies', { count }));
  return badge;
}

/**
 * Boton de Sobres, con el contador de pendientes.
 *
 * Vive en las DOS versiones del panel (carrusel y grilla) para que el acceso
 * sea identico: la Coleccion es la pantalla de contenido y los Sobres son
 * contenido. El contador va en una pildora aparte (`.pack-count`) para que el
 * numero se lea sin depender del texto.
 */
function buildPacksButton(
  onOpen: () => void,
  pending: number,
  kind: 'base' | 'expansion' = 'base',
): HTMLButtonElement {
  const expansion = kind === 'expansion';
  const button = document.createElement('button');
  button.className = expansion ? 'btn is-ghost is-packs is-packs-expansion' : 'btn is-ghost is-packs';
  button.dataset['act'] = expansion ? 'sobres-expansion' : 'sobres';
  button.textContent = expansion ? t('packs.expansion.title') : t('packs.title');
  if (pending > 0) {
    button.classList.add('has-pending');
    const count = document.createElement('span');
    count.className = 'pack-count';
    count.textContent = String(pending);
    button.appendChild(count);
  }
  button.addEventListener('click', onOpen);
  return button;
}

/** Marco DOM de la coleccion cuando el protagonista es el carrusel 3D. */
export interface CollectionCarouselFrame {
  panel: HTMLElement;
  /** Actualiza el recuadro de detalle con la entrada enfocada. */
  setFocus: (index: number) => void;
}

/**
 * Marco DOM de la coleccion en modo GRILLA.
 *
 * Igual que el carrusel, expone `panel` para que el controlador lo monte, pero
 * no necesita `setFocus`: la grilla es autonoma y abre su propio detalle.
 */
export interface CollectionGridFrame {
  panel: HTMLElement;
}

/** Modos de filtro de la grilla. `state` reemplaza a los viejos chips locked/unlocked. */
export type GridState = 'all' | 'seen' | 'unseen' | 'locked';

/**
 * Coleccion sobre el CARRUSEL 3D.
 *
 * El panel es un MARCO: titulo, chips de filtro, detalle de la carta enfocada y
 * cerrar. El centro queda libre y sin capturar punteros, porque ahi vive el
 * anillo (canvas): rueda, arrastre y tap llegan a la escena, no al DOM.
 *
 * No dibuja cartas: cuando cambia el filtro avisa por `onFiltered` para que el
 * controlador vuelva a alimentar el carrusel.
 */
export function buildCollectionCarousel(
  entries: CollectionEntry[],
  callbacks: {
    onClose: () => void;
    onFiltered: (filtered: CollectionEntry[]) => void;
    onOpenStore?: () => void;
    onOpenPass?: () => void;
    onOpenCosmetics?: () => void;
    onOpenPacks?: () => void;
    packsPending?: number;
    onOpenExpansionPacks?: () => void;
    expansionPacksPending?: number;
  },
): CollectionCarouselFrame {
  const panel = document.createElement('div');
  panel.className = 'panel is-collection is-carousel-frame';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('collection.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';

  const toolbar = document.createElement('div');
  toolbar.className = 'deck-toolbar is-floating';

  // Detalle de la carta enfocada: va abajo, para no tapar el anillo.
  const detail = document.createElement('div');
  detail.className = 'carousel-detail';
  const detailName = document.createElement('div');
  detailName.className = 'carousel-detail-name';
  const detailMeta = document.createElement('div');
  detailMeta.className = 'carousel-detail-meta';
  const detailCopies = document.createElement('div');
  detailCopies.className = 'carousel-detail-copies';
  detail.append(detailName, detailMeta, detailCopies);

  const actions = document.createElement('div');
  actions.className = 'panel-actions is-floating';

  let filter: Filter = 'all';
  let filtered: CollectionEntry[] = [];

  const applyFilter = (): CollectionEntry[] => {
    const visible = entries.filter((e) => e.state !== 'hidden');
    filtered = visible.filter((entry) => {
      if (filter === 'cards') return entry.kind === 'card';
      if (filter === 'jokers') return entry.kind === 'joker';
      if (filter === 'locked') return entry.state === 'locked';
      if (filter === 'unlocked') return entry.state === 'unlocked';
      return true;
    });
    const seenCount = filtered.filter((e) => e.seen).length;
    subtitle.textContent = t('collection.seen', { seen: seenCount, total: filtered.length });
    return filtered;
  };

  const setFocus = (index: number): void => {
    const entry = filtered[index];
    if (!entry) {
      detailName.textContent = '';
      detailMeta.textContent = '';
      detailCopies.textContent = '';
      return;
    }
    detailName.textContent = entry.seen ? t(entry.nameKey) : t('collection.unknown');
    detailName.style.color = entry.seen
      ? hexToCss(RARITY_COLOR[entry.rarity] ?? ELEMENT_COLOR.neutral)
      : 'var(--frame-dim)';
    const kind = entry.kind === 'joker' ? t('collection.jokers') : t('collection.cards');
    const state =
      entry.state === 'locked'
        ? lockLabel(entry)
        : entry.state === 'unlocked' && entry.unlockSource
          ? `${t('collection.unlocked')} · ${t(`collection.unlockSource.${entry.unlockSource}`)}`
          : '';
    detailMeta.textContent = state ? `${kind} · ${state}` : kind;
    // Copias poseidas: el detalle del carrusel las muestra como el badge "xN".
    const copies = countBadge(entry);
    detailCopies.textContent = copies ? (copies.textContent ?? '') : '';
    detailCopies.title = copies ? (copies.title ?? '') : '';
    detailCopies.classList.toggle('is-hidden', copies === null);
  };

  const filters: Array<[Filter, string]> = [
    ['all', 'collection.all'],
    ['cards', 'collection.cards'],
    ['jokers', 'collection.jokers'],
    ['locked', 'collection.locked'],
    ['unlocked', 'collection.unlocked'],
  ];
  for (const [mode, key] of filters) {
    const button = document.createElement('button');
    button.className = `btn is-ghost is-small${mode === filter ? ' is-current' : ''}`;
    button.textContent = mode === 'locked' ? t('store.locked') : t(key);
    button.dataset['act'] = `filter-${mode}`;
    button.addEventListener('click', () => {
      filter = mode;
      for (const sibling of toolbar.querySelectorAll('button')) {
        sibling.classList.toggle('is-current', sibling === button);
      }
      const list = applyFilter();
      callbacks.onFiltered(list);
      setFocus(0);
    });
    toolbar.appendChild(button);
  }

  // Sobres primero: es contenido propio del jugador, no una superficie de
  // venta. El contador de pendientes es lo que invita a entrar.
  if (callbacks.onOpenPacks) {
    actions.appendChild(buildPacksButton(callbacks.onOpenPacks, callbacks.packsPending ?? 0));
  }
  if (callbacks.onOpenExpansionPacks) {
    actions.appendChild(
      buildPacksButton(
        callbacks.onOpenExpansionPacks,
        callbacks.expansionPacksPending ?? 0,
        'expansion',
      ),
    );
  }
  if (callbacks.onOpenStore) {
    const store = document.createElement('button');
    store.className = 'btn is-ghost';
    store.textContent = t('menu.expansions');
    store.dataset['act'] = 'expansions';
    store.addEventListener('click', () => callbacks.onOpenStore?.());
    actions.appendChild(store);
  }
  if (callbacks.onOpenPass) {
    const pass = document.createElement('button');
    pass.className = 'btn is-ghost';
    pass.textContent = t('menu.pass');
    pass.dataset['act'] = 'pass';
    pass.addEventListener('click', () => callbacks.onOpenPass?.());
    actions.appendChild(pass);
  }
  if (callbacks.onOpenCosmetics) {
    const cos = document.createElement('button');
    cos.className = 'btn is-ghost';
    cos.textContent = t('menu.cosmetics');
    cos.dataset['act'] = 'cosmetics';
    cos.addEventListener('click', () => callbacks.onOpenCosmetics?.());
    actions.appendChild(cos);
  }

  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  // El CENTRO del panel queda VACIO a proposito: ahi vive el anillo y tiene que
  // recibir rueda/arrastre/tap. Todo lo interactivo se agrupa arriba o abajo.
  const top = document.createElement('div');
  top.className = 'carousel-top';
  top.append(title, subtitle, toolbar);
  const bottom = document.createElement('div');
  bottom.className = 'carousel-bottom';
  bottom.append(detail, actions);
  panel.append(top, bottom);

  applyFilter();
  setFocus(0);

  return { panel, setFocus };
}
/**
 * Coleccion en modo GRILLA, agrupada por pack -> familia.
 *
 * POR QUE UNA GRILLA. El carrusel 3D obliga a recorrer las entradas una por
 * una: sirve para MIRAR una carta, es malo para GESTIONAR una coleccion. Con 77
 * entradas, el jugador no puede ver sus huecos ("me faltan 3 amatoxinas") sin
 * girar el anillo entero. La grilla con cabeceras por pack y familia pone los
 * faltantes a la vista, que es de lo que se trata coleccionar.
 *
 * La grilla NO dibuja nada del juego: recibe `CollectionEntry[]` ya resueltas,
 * cada una con su `faceUrl` armada por el controlador. Es una funcion de
 * presentacion pura.
 */
export function buildCollectionGrid(
  entries: CollectionEntry[],
  callbacks: CollectionCallbacks,
): CollectionGridFrame {
  const panel = document.createElement('div');
  panel.className = 'panel is-collection is-grid-frame';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('collection.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';

  // --- Barra de filtros (dos grupos: TIPO y ESTADO) ---
  const toolbar = document.createElement('div');
  toolbar.className = 'deck-toolbar collection-toolbar';

  const typeGroup = document.createElement('div');
  typeGroup.className = 'collection-filter-group';
  const stateGroup = document.createElement('div');
  stateGroup.className = 'collection-filter-group';
  toolbar.append(typeGroup, stateGroup);

  // --- Grilla con secciones colapsables ---
  const scroll = document.createElement('div');
  scroll.className = 'collection-scroll';
  const grid = document.createElement('div');
  grid.className = 'collection-grid is-grouped';
  scroll.appendChild(grid);

  const visible = entries.filter((e) => e.state !== 'hidden');

  type GridType = 'all' | 'cards' | 'jokers';
  let typeFilter: GridType = 'all';
  let stateFilter: GridState = 'all';

  /**
   * Cabeceras que el jugador colapso. Vive en memoria (no se persiste): es una
   * preferencia de sesion, no una decision que merezca guardarse en el perfil.
   */
  const collapsed = new Set<string>();

  const matches = (entry: CollectionEntry): boolean => {
    if (typeFilter === 'cards' && entry.kind !== 'card') return false;
    if (typeFilter === 'jokers' && entry.kind !== 'joker') return false;
    if (stateFilter === 'seen' && !entry.seen) return false;
    if (stateFilter === 'unseen' && entry.seen) return false;
    if (stateFilter === 'locked' && entry.state !== 'locked') return false;
    return true;
  };

  // El detalle se declara antes de `buildCell` porque la celda lo abre; la
  // asignacion real ocurre mas tarde (los listeners corren al hacer click).
  let detail: HTMLElement | null = null;
  const closeDetail = (): void => {
    detail?.remove();
    detail = null;
  };
  let openDetail: (entry: CollectionEntry) => void = () => {};

  /**
   * Carga perezosa de caras. `buildCell` marca las imagenes con `.is-lazy` y
   * guarda la entrada en este mapa; el observer compone la cara (via
   * `faceProvider`, memoizada en `cardArt.ts`) y la asigna como `src` solo
   * cuando la celda asoma al viewport. Asi abrir la Coleccion no compone ni
   * decodifica las ~101 caras de golpe: solo las que se ven (y las cercanas,
   * por el `rootMargin`).
   */
  const lazyFaces = new WeakMap<HTMLImageElement, CollectionEntry>();
  const faceObserver = new IntersectionObserver(
    (records) => {
      for (const rec of records) {
        if (!rec.isIntersecting) continue;
        const img = rec.target as HTMLImageElement;
        const entry = lazyFaces.get(img);
        if (entry) {
          const url = resolveFace(entry);
          if (url) img.src = url;
        }
        img.classList.remove('is-lazy');
        faceObserver.unobserve(img);
      }
    },
    { root: null, rootMargin: '200px', threshold: 0 },
  );
  /** (Re)observa las caras perezosas tras cada `render()` (filtros/colapsos). */
  const observeLazyFaces = (): void => {
    grid
      .querySelectorAll<HTMLImageElement>('.collection-tile-img.is-lazy')
      .forEach((el) => faceObserver.observe(el));
  };

  /** Celda con la CARA real de la pieza (o silueta si no se descubrio). */
  const buildCell = (entry: CollectionEntry): HTMLElement => {
    const locked = entry.state === 'locked';
    const unlocked = entry.state === 'unlocked';
    const undiscovered = !entry.seen && !locked && !unlocked;

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `collection-card is-tile${locked ? ' is-locked' : ''}${unlocked ? ' is-unlocked' : ''}${undiscovered ? ' is-unknown' : ''}`;
    cell.dataset['id'] = entry.id;
    cell.dataset['kind'] = entry.kind;
    cell.dataset['state'] = entry.state;
    cell.setAttribute('aria-label', locked ? lockLabel(entry) : t(entry.nameKey));

    // Marco de la cara: la imagen real, o una silueta con el color del elemento.
    const frame = document.createElement('span');
    frame.className = 'collection-tile-art';
    frame.style.setProperty(
      '--tile-accent',
      hexToCss(locked ? 0x2a3440 : (ELEMENT_COLOR[entry.element] ?? ELEMENT_COLOR.neutral)),
    );
    const showFace = !undiscovered && !locked;
    if (showFace && (entry.faceUrl || entry.faceProvider)) {
      // Cara perezosa: se compone y asigna como `src` cuando la celda entra en
      // viewport (ver `faceObserver`), no aqui. Abrir la Coleccion no debe
      // componer ni decodificar las 101 caras de golpe.
      const img = document.createElement('img');
      img.className = 'collection-tile-img is-lazy';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      lazyFaces.set(img, entry);
      frame.appendChild(img);
    } else {
      // Sin cara: silueta. La carta desconocida NO revela su arte (es el punto
      // de coleccionar), y una bloqueada muestra su candado encima.
      const sil = document.createElement('span');
      sil.className = 'collection-tile-silhouette';
      frame.appendChild(sil);
      if (undiscovered) {
        const q = document.createElement('span');
        q.className = 'collection-tile-question';
        q.textContent = '?';
        frame.appendChild(q);
      }
    }
    cell.appendChild(frame);

    // Pie: nombre + copias. En una carta bloqueada el nombre es el candado.
    const name = document.createElement('span');
    name.className = 'collection-name';
    if (locked) {
      name.textContent = lockLabel(entry);
    } else {
      name.textContent = undiscovered ? t('collection.unknown') : t(entry.nameKey);
    }
    name.style.color =
      locked || undiscovered
        ? 'var(--dim)'
        : hexToCss(RARITY_COLOR[entry.rarity] ?? ELEMENT_COLOR.neutral);
    cell.appendChild(name);

    const copies = countBadge(entry);
    if (copies) cell.appendChild(copies);

    if (unlocked && entry.unlockSource) {
      const badge = document.createElement('span');
      badge.className = 'collection-unlock';
      badge.textContent = `${t('collection.unlocked')} · ${t('collection.unlockSource.' + entry.unlockSource)}`;
      cell.appendChild(badge);
    }

    cell.addEventListener('click', () => {
      if (locked && callbacks.onOpenStore) {
        callbacks.onOpenStore();
        return;
      }
      openDetail(entry);
    });
    return cell;
  };

  /** Cabecera de seccion colapsable ("Base — Amatoxinas"). */
  const buildSectionHeader = (key: string, label: string, count: number): HTMLElement => {
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'collection-section';
    header.dataset['act'] = 'section';
    header.dataset['section'] = key;
    const isCollapsed = collapsed.has(key);
    header.classList.toggle('is-collapsed', isCollapsed);
    header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

    const caret = document.createElement('span');
    caret.className = 'collection-section-caret';
    caret.textContent = isCollapsed ? '\u25b8' : '\u25be';
    const text = document.createElement('span');
    text.className = 'collection-section-label';
    text.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'collection-section-count';
    badge.textContent = String(count);
    header.append(caret, text, badge);

    header.addEventListener('click', () => {
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      render();
    });
    return header;
  };

  /** Panel de detalle: reusa la etiqueta rica, con la cara grande. */
  openDetail = (entry: CollectionEntry): void => {
    closeDetail();
    const box = document.createElement('div');
    box.className = 'collection-detail';
    box.dataset['act'] = 'collection-detail';
    box.setAttribute('role', 'dialog');

    const card = document.createElement('div');
    card.className = 'collection-detail-card';

    if (entry.state !== 'locked') {
      const detailFace = resolveFace(entry);
      if (detailFace) {
        const img = document.createElement('img');
        img.className = 'collection-detail-art';
        img.src = detailFace;
        img.alt = t(entry.nameKey);
        card.appendChild(img);
      }
    }

    const body = document.createElement('div');
    body.className = 'collection-detail-body';

    const name = document.createElement('h3');
    name.className = 'collection-detail-name';
    name.textContent = entry.seen ? t(entry.nameKey) : t('collection.unknown');
    name.style.color = hexToCss(RARITY_COLOR[entry.rarity] ?? ELEMENT_COLOR.neutral);

    const meta = document.createElement('p');
    meta.className = 'collection-detail-meta';
    const kindLabel = entry.kind === 'joker' ? t('collection.jokers') : t('collection.cards');
    const bits = [kindLabel];
    if (entry.kind === 'card') {
      bits.push(t(`element.${entry.element}`), t(`family.${entry.family}`));
    }
    bits.push(t(`rarity.${entry.rarity}`));
    meta.textContent = bits.join(' · ');

    body.append(name, meta);

    if (entry.kind === 'card' && entry.seen) {
      const stats = document.createElement('div');
      stats.className = 'collection-detail-stats';
      const sub = document.createElement('span');
      sub.textContent = `${t('deck.substrate')} ${entry.substrate ?? 0}`;
      const spo = document.createElement('span');
      spo.textContent = `${t('deck.spores')} ${entry.spores ?? 0}`;
      stats.append(sub, spo);
      if ((entry.count ?? 0) > 0) {
        const cp = document.createElement('span');
        cp.textContent = t('collection.copies', { count: entry.count ?? 0 });
        stats.appendChild(cp);
      }
      body.appendChild(stats);
    }

    if (entry.descKey && entry.seen) {
      const desc = document.createElement('p');
      desc.className = 'collection-detail-desc';
      desc.textContent = t(entry.descKey);
      body.appendChild(desc);
    }

    if (entry.state === 'locked') {
      const lock = document.createElement('p');
      lock.className = 'collection-detail-lock';
      lock.textContent = lockLabel(entry);
      body.appendChild(lock);
    } else if (entry.state === 'unlocked' && entry.unlockSource) {
      const unl = document.createElement('p');
      unl.className = 'collection-detail-lock';
      unl.textContent = `${t('collection.unlocked')} · ${t('collection.unlockSource.' + entry.unlockSource)}`;
      body.appendChild(unl);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn is-ghost is-small';
    closeBtn.dataset['act'] = 'detail-close';
    closeBtn.textContent = t('ui.close');
    closeBtn.addEventListener('click', closeDetail);

    card.append(body, closeBtn);
    box.appendChild(card);
    box.addEventListener('click', (e) => {
      if (e.target === box) closeDetail();
    });
    panel.appendChild(box);
    detail = box;
  };

  /** Agrupa por pack -> familia y dibuja secciones. */
  const render = (): void => {
    grid.innerHTML = '';
    const list = visible.filter(matches);
    const seenCount = list.filter((e) => e.seen).length;
    subtitle.textContent = t('collection.seen', { seen: seenCount, total: list.length });

    // pack -> familia -> entradas
    const byPack = new Map<string, Map<string, CollectionEntry[]>>();
    for (const entry of list) {
      const famKey = entry.kind === 'joker' ? '__jokers' : entry.family;
      let fam = byPack.get(entry.packId);
      if (!fam) {
        fam = new Map();
        byPack.set(entry.packId, fam);
      }
      let arr = fam.get(famKey);
      if (!arr) {
        arr = [];
        fam.set(famKey, arr);
      }
      arr.push(entry);
    }

    const rank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3, mythic: 4 };
    // Orden estable de packs y familias: el orden de carga del glob no es
    // determinista entre builds, y un grid que baila confunde.
    const packKeys = [...byPack.keys()].sort((a, b) => a.localeCompare(b));

    for (const packId of packKeys) {
      const fams = byPack.get(packId)!;
      const packTitle = list.find((e) => e.packId === packId)?.packTitleKey;
      const packLabel = packTitle ? t(packTitle) : packId;
      const headerKey = `pack:${packId}`;
      let totalInPack = 0;
      for (const arr of fams.values()) totalInPack += arr.length;
      grid.appendChild(buildSectionHeader(headerKey, packLabel, totalInPack));
      const packBox = document.createElement('div');
      packBox.className = 'collection-pack';
      packBox.classList.toggle('is-collapsed', collapsed.has(headerKey));
      grid.appendChild(packBox);

      const famKeys = [...fams.keys()].sort((a, b) => {
        if (a === '__jokers') return 1;
        if (b === '__jokers') return -1;
        return a.localeCompare(b);
      });
      for (const famKey of famKeys) {
        const items = fams.get(famKey)!.sort(
          (a, b) =>
            Number(b.seen) - Number(a.seen) ||
            (rank[b.rarity] ?? 0) - (rank[a.rarity] ?? 0) ||
            a.id.localeCompare(b.id),
        );
        const famHeaderKey = `fam:${packId}:${famKey}`;
        const famLabel =
          famKey === '__jokers' ? t('collection.jokers') : `${packLabel} — ${t(`family.${famKey}`)}`;
        packBox.appendChild(buildSectionHeader(famHeaderKey, famLabel, items.length));
        const famBox = document.createElement('div');
        famBox.className = 'collection-family';
        famBox.dataset['family'] = famKey;
        famBox.classList.toggle('is-collapsed', collapsed.has(famHeaderKey));
        for (const entry of items) famBox.appendChild(buildCell(entry));
        packBox.appendChild(famBox);
      }
    }

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'collection-empty';
      empty.textContent = t('collection.empty');
      grid.appendChild(empty);
    }

    // Las caras se cargan solo al entrar en viewport: observa las recien creadas.
    observeLazyFaces();
  };

  // --- Construccion de los chips de filtro ---
  // `prefix` separa los `data-act` de los DOS grupos. Sin el, TIPO y ESTADO
  // comparten `filter-all` y un `querySelector('[data-act="filter-all"]')`
  // —el que usan las tools— tocaria siempre el primero y dejaria el otro
  // filtro puesto en silencio.
  const buildChips = <T extends string>(
    group: HTMLElement,
    prefix: string,
    options: Array<[T, string]>,
    get: () => T,
    set: (v: T) => void,
  ): void => {
    for (const [value, label] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn is-ghost is-small${get() === value ? ' is-current' : ''}`;
      button.textContent = label;
      button.dataset['act'] = `${prefix}-${value}`;
      button.dataset['filter'] = value;
      button.dataset['group'] = prefix;
      button.addEventListener('click', () => {
        set(value);
        for (const sibling of group.querySelectorAll('button')) {
          sibling.classList.toggle('is-current', sibling === button);
        }
        render();
      });
      group.appendChild(button);
    }
  };

  const typeOptions: Array<[GridType, string]> = [
    ['all', t('collection.all')],
    ['cards', t('collection.cards')],
    ['jokers', t('collection.jokers')],
  ];
  buildChips<GridType>(
    typeGroup,
    'filter',
    typeOptions,
    () => typeFilter,
    (v) => {
      typeFilter = v;
    },
  );
  const stateOptions: Array<[GridState, string]> = [
    ['all', t('collection.filterAllStates')],
    ['seen', t('collection.filterSeen')],
    ['unseen', t('collection.filterUnseen')],
    ['locked', t('store.locked')],
  ];
  buildChips<GridState>(
    stateGroup,
    'filter-state',
    stateOptions,
    () => stateFilter,
    (v) => {
      stateFilter = v;
    },
  );

  render();

  /**
   * FRENTE 3 — Ayuda de Sobres.
   *
   * Explica la dos cosas que el jugador no podia deducir: que un sobre NO toca
   * el mazo de la run (llena la Coleccion) y que esas copias sirven para el
   * MAZO PROPIO. Es la respuesta visible a "¿y estas cartas para que sirven?".
   */
  const openPacksHelp = (): void => {
    closeDetail();
    const box = document.createElement('div');
    box.className = 'collection-detail';
    box.dataset['act'] = 'packs-help-modal';
    box.setAttribute('role', 'dialog');

    const card = document.createElement('div');
    card.className = 'collection-detail-card is-help';

    const body = document.createElement('div');
    body.className = 'collection-detail-body';

    const name = document.createElement('h3');
    name.className = 'collection-detail-name';
    name.textContent = t('packs.helpTitle');

    const text = document.createElement('p');
    text.className = 'collection-detail-desc';
    text.textContent = t('packs.helpBody');

    const hint = document.createElement('p');
    hint.className = 'collection-detail-meta';
    hint.textContent = t('packs.helpHint');

    body.append(name, text, hint);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn is-ghost is-small';
    closeBtn.dataset['act'] = 'detail-close';
    closeBtn.textContent = t('packs.helpClose');
    closeBtn.addEventListener('click', closeDetail);

    card.append(body, closeBtn);
    box.appendChild(card);
    box.addEventListener('click', (e) => {
      if (e.target === box) closeDetail();
    });
    panel.appendChild(box);
    detail = box;
  };

  const actions = document.createElement('div');
  actions.className = 'panel-actions';

  // FRENTE 3 — La ayuda de Sobres. El jugador no tenia forma de saber a donde
  // iban las cartas de un sobre: parecia que se perdian. Este boton abre el
  // texto que lo explica, al lado del boton que las entrega.
  if (callbacks.onOpenPacks) {
    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'btn is-ghost';
    help.textContent = t('packs.helpButton');
    help.dataset['act'] = 'packs-help';
    help.addEventListener('click', () => openPacksHelp());
    actions.appendChild(help);
  }

  // "Exhibicion": la unica forma de girar una carta en 3D. Va PRIMERO porque es
  // la accion propia de esta pantalla; los Sobres y la tienda son contenido.
  if (callbacks.onOpenExhibition) {
    const ex = document.createElement('button');
    ex.className = 'btn is-ghost';
    ex.textContent = t('collection.exhibition');
    ex.dataset['act'] = 'collection-view-carousel';
    ex.addEventListener('click', () => callbacks.onOpenExhibition?.());
    actions.appendChild(ex);
  }

  // La tienda de expansiones y el pase viven aca: son contenido, y esta es la
  // pantalla de contenido. Asi ya no ocupan lugar en el menu principal.
  if (callbacks.onOpenPacks) {
    actions.appendChild(buildPacksButton(callbacks.onOpenPacks, callbacks.packsPending ?? 0));
  }
  if (callbacks.onOpenExpansionPacks) {
    actions.appendChild(
      buildPacksButton(
        callbacks.onOpenExpansionPacks,
        callbacks.expansionPacksPending ?? 0,
        'expansion',
      ),
    );
  }
  if (callbacks.onOpenStore) {
    const store = document.createElement('button');
    store.className = 'btn is-ghost';
    store.textContent = t('menu.expansions');
    store.dataset['act'] = 'expansions';
    store.addEventListener('click', () => callbacks.onOpenStore?.());
    actions.appendChild(store);
  }
  if (callbacks.onOpenPass) {
    const pass = document.createElement('button');
    pass.className = 'btn is-ghost';
    pass.textContent = t('menu.pass');
    pass.dataset['act'] = 'pass';
    pass.addEventListener('click', () => callbacks.onOpenPass?.());
    actions.appendChild(pass);
  }
  if (callbacks.onOpenCosmetics) {
    const cos = document.createElement('button');
    cos.className = 'btn is-ghost';
    cos.textContent = t('menu.cosmetics');
    cos.dataset['act'] = 'cosmetics';
    cos.addEventListener('click', () => callbacks.onOpenCosmetics?.());
    actions.appendChild(cos);
  }

  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('ui.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  panel.append(title, subtitle, toolbar, scroll, actions);
  return { panel };
}
