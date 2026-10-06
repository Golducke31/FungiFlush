/**
 * SettingsScreen.ts — Ajustes.
 *
 * Escribir en el perfil es responsabilidad de quien llama (`AppController`):
 * esta pantalla solo emite intenciones. Los sliders de audio ya existen y ya
 * guardan su valor: cuando el audio sea real, no hay que tocar esta pantalla.
 */

import { bus } from '@engine/index';
import { currentLanguage, t } from '@i18n/index';
import type { ProfileSettings } from '@meta/ProfileState';

export interface SettingsCallbacks {
  onPatch: (patch: Partial<ProfileSettings>) => void;
  onToggleLanguage: () => void;
  onClose: () => void;
}

function field(label: HTMLElement, control: HTMLElement, mod?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `settings-field${mod ? ` ${mod}` : ''}`;
  el.append(label, control);
  return el;
}

function checkbox(checked: boolean, onChange: (value: boolean) => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = `settings-toggle${checked ? ' is-on' : ''}`;
  el.textContent = checked ? '✓' : '';
  el.setAttribute('aria-pressed', String(checked));
  el.addEventListener('click', () => {
    const next = !el.classList.contains('is-on');
    el.classList.toggle('is-on', next);
    el.textContent = next ? '✓' : '';
    el.setAttribute('aria-pressed', String(next));
    onChange(next);
  });
  return el;
}

/**
 * Separador de seccion dentro del grid de ajustes. Ocupa las dos columnas (el
 * grid es `auto-fit`), asi que agrupa visualmente lo que viene despues. Lleva
 * su propia clave i18n para reescribirse al cambiar de idioma.
 */
function section(titleKey: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'settings-section';
  el.textContent = t(titleKey);
  el.dataset['i18nKey'] = titleKey;
  return el;
}

function slider(value: number, onChange: (value: number) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'range';
  el.className = 'settings-slider';
  el.min = '0';
  el.max = '100';
  el.step = '5';
  el.value = String(Math.round(value * 100));
  el.addEventListener('input', () => onChange(Number(el.value) / 100));
  return el;
}

/**
 * Segmentado para elegir entre pocas opciones excluyentes.
 *
 * NO es un `<select>` a proposito: en movil un select nativo abre la rueda del
 * sistema operativo, que rompe por completo la estetica del panel.
 *
 * El estado visual se actualiza al hacer clic y no esperando a que se rearme el
 * panel: el HUD solo reconstruye Ajustes al abrirlo, asi que sin esto el
 * jugador tocaria una opcion y no veria ninguna respuesta.
 *
 * Devuelve ademas la lista de botones para que `buildSettingsPanel` pueda
 * reescribir sus textos cuando cambia el idioma (los nombres de las rarezas
 * se traducen igual que el resto del HUD).
 */
function buildSegmented<T extends string>(
  value: T,
  options: ReadonlyArray<{ value: T; label: string }>,
  onChange: (value: T) => void,
): { container: HTMLDivElement; buttons: Array<{ button: HTMLButtonElement; label: string }> } {
  const container = document.createElement('div');
  container.className = 'settings-segmented';
  container.dataset['act'] = 'quality';

  const buttons: Array<{ button: HTMLButtonElement; label: string }> = [];

  for (const option of options) {
    const button = document.createElement('button');
    button.className = `settings-segment${option.value === value ? ' is-on' : ''}`;
    button.textContent = option.label;
    button.dataset['value'] = option.value;
    button.setAttribute('aria-pressed', String(option.value === value));
    button.addEventListener('click', () => {
      for (const entry of buttons) {
        const on = entry.button.dataset['value'] === option.value;
        entry.button.classList.toggle('is-on', on);
        entry.button.setAttribute('aria-pressed', String(on));
      }
      onChange(option.value);
    });
    buttons.push({ button, label: option.label });
    container.appendChild(button);
  }
  return { container, buttons };
}

export function buildSettingsPanel(settings: ProfileSettings, callbacks: SettingsCallbacks): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel is-settings';

  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = t('settings.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'panel-subtitle';
  subtitle.textContent = t('settings.audioSoon');

  const body = document.createElement('div');
  body.className = 'settings-grid';

  const langButton = document.createElement('button');
  langButton.className = 'btn is-ghost';
  langButton.textContent = `${t('settings.language')}: ${currentLanguage().toUpperCase()}`;
  langButton.dataset['act'] = 'lang';
  langButton.addEventListener('click', () => callbacks.onToggleLanguage());

  // Etiquetas: las guardamos como referencias vivas para reescribir su texto
  // al cambiar de idioma. Sin esto, despues de tocar el toggle el jugador ve
  // el mismo texto y cree que no funciono (el toggle SI cambia el idioma, pero
  // el panel DOM queda congelado con el texto del idioma anterior).
  const makeLabel = (key: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = 'settings-label';
    span.textContent = t(key);
    span.dataset['i18nKey'] = key;
    return span;
  };
  const reduceMotionLabel = makeLabel('settings.reduceMotion');
  const autoSortLabel = makeLabel('settings.autoSort');
  const hapticsLabel = makeLabel('settings.haptics');
  const notifyDailyLabel = makeLabel('settings.notifyDaily');
  const notifyAchievementsLabel = makeLabel('settings.notifyAchievements');
  const notifySection = section('settings.notifications');
  const sfxLabel = makeLabel('settings.sfx');
  const musicLabel = makeLabel('settings.music');
  const langLabel = makeLabel('settings.language');
  const qualityLabel = makeLabel('settings.quality.label');

  const { container: qualityControl, buttons: qualityButtons } = buildSegmented(
    settings.quality,
    [
      { value: 'auto', label: t('settings.quality.auto') },
      { value: 'low', label: t('settings.quality.low') },
      { value: 'medium', label: t('settings.quality.medium') },
      { value: 'high', label: t('settings.quality.high') },
    ] as const,
    (v) => callbacks.onPatch({ quality: v }),
  );

  body.append(
    field(langLabel, langButton),
    field(reduceMotionLabel, checkbox(settings.reduceMotion, (v) => callbacks.onPatch({ reduceMotion: v }))),
    field(autoSortLabel, checkbox(settings.autoSortHand, (v) => callbacks.onPatch({ autoSortHand: v }))),
    // `settings-field--wide`: el control segmentado (Auto/Baja/Media/Alta) NO
    // entra en UNA columna de la grilla y la 4a opcion quedaba RECORTADA por el
    // `overflow:hidden` del propio control. Con dos columnas entra entero y la
    // grilla sigue teniendo las mismas filas (2 + 1 completan la fila).
    field(qualityLabel, qualityControl, 'settings-field--wide'),
    field(hapticsLabel, checkbox(settings.haptics, (v) => callbacks.onPatch({ haptics: v }))),
    notifySection,
    field(notifyDailyLabel, checkbox(settings.notifyDaily, (v) => callbacks.onPatch({ notifyDaily: v }))),
    field(notifyAchievementsLabel, checkbox(settings.notifyAchievements, (v) => callbacks.onPatch({ notifyAchievements: v }))),
    field(sfxLabel, slider(settings.sfxVolume, (v) => callbacks.onPatch({ sfxVolume: v }))),
    field(musicLabel, slider(settings.musicVolume, (v) => callbacks.onPatch({ musicVolume: v }))),
  );

  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const close = document.createElement('button');
  close.className = 'btn is-play';
  close.textContent = t('settings.close');
  close.dataset['act'] = 'close';
  close.addEventListener('click', () => callbacks.onClose());
  actions.appendChild(close);

  panel.append(title, subtitle, body, actions);

  // Al cambiar de idioma: actualizamos todos los textos traducibles del panel.
  // El boton de idioma ademas muestra el codigo activo, asi que se reconstruye
  // aparte. Sin esta suscripcion, despues del toggle el panel sigue mostrando
  // el texto del idioma anterior y el jugador piensa que no cambio nada.
  const allLabels = [
    reduceMotionLabel,
    autoSortLabel,
    hapticsLabel,
    sfxLabel,
    musicLabel,
    langLabel,
    qualityLabel,
    notifyDailyLabel,
    notifyAchievementsLabel,
    notifySection,
  ];
  const unsub = bus.on('i18n:changed', () => {
    for (const span of allLabels) {
      const key = span.dataset['i18nKey'];
      if (key) span.textContent = t(key);
    }
    title.textContent = t('settings.title');
    subtitle.textContent = t('settings.audioSoon');
    langButton.textContent = `${t('settings.language')}: ${currentLanguage().toUpperCase()}`;
    close.textContent = t('settings.close');

    const labels: Record<string, string> = {
      auto: t('settings.quality.auto'),
      low: t('settings.quality.low'),
      medium: t('settings.quality.medium'),
      high: t('settings.quality.high'),
    };
    for (const entry of qualityButtons) {
      const next = labels[entry.button.dataset['value'] ?? ''];
      if (next) entry.label = next;
      entry.button.textContent = entry.label;
    }
  });

  // Cuando el panel se quita del DOM hay que soltar la suscripcion, si no
  // cada `i18n:changed` reescribe nodos sueltos.
  const observer = new MutationObserver(() => {
    if (!panel.isConnected) {
      unsub();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return panel;
}
