/**
 * SettingsScreen.ts — Ajustes.
 *
 * Escribir en el perfil es responsabilidad de quien llama (`AppController`):
 * esta pantalla solo emite intenciones. Los sliders de audio ya existen y ya
 * guardan su valor: cuando el audio sea real, no hay que tocar esta pantalla.
 */

import { currentLanguage, t } from '@i18n/index';
import type { ProfileSettings } from '@meta/ProfileState';

export interface SettingsCallbacks {
  onPatch: (patch: Partial<ProfileSettings>) => void;
  onToggleLanguage: () => void;
  onClose: () => void;
}

function field(label: string, control: HTMLElement): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'settings-field';
  const name = document.createElement('span');
  name.className = 'settings-label';
  name.textContent = label;
  el.append(name, control);
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
 * Control segmentado para elegir entre pocas opciones excluyentes.
 *
 * NO es un `<select>` a proposito: en movil un select nativo abre la rueda del
 * sistema operativo, que rompe por completo la estetica del panel.
 *
 * El estado visual se actualiza al hacer clic y no esperando a que se rearme el
 * panel: el HUD solo reconstruye Ajustes al abrirlo, asi que sin esto el
 * jugador tocaria una opcion y no veria ninguna respuesta.
 */
function segmented<T extends string>(
  value: T,
  options: ReadonlyArray<{ value: T; label: string }>,
  onChange: (value: T) => void,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'settings-segmented';
  el.dataset['act'] = 'quality';

  const buttons: Array<{ button: HTMLButtonElement; value: T }> = [];

  for (const option of options) {
    const button = document.createElement('button');
    button.className = `settings-segment${option.value === value ? ' is-on' : ''}`;
    button.textContent = option.label;
    button.dataset['value'] = option.value;
    button.setAttribute('aria-pressed', String(option.value === value));

    button.addEventListener('click', () => {
      for (const entry of buttons) {
        const on = entry.value === option.value;
        entry.button.classList.toggle('is-on', on);
        entry.button.setAttribute('aria-pressed', String(on));
      }
      onChange(option.value);
    });

    buttons.push({ button, value: option.value });
    el.appendChild(button);
  }

  return el;
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
  langButton.addEventListener('click', () => callbacks.onToggleLanguage());

  body.append(
    field(t('settings.language'), langButton),
    field(t('settings.reduceMotion'), checkbox(settings.reduceMotion, (v) => callbacks.onPatch({ reduceMotion: v }))),
    field(
      t('settings.quality.label'),
      segmented(
        settings.quality,
        [
          { value: 'auto', label: t('settings.quality.auto') },
          { value: 'low', label: t('settings.quality.low') },
          { value: 'medium', label: t('settings.quality.medium') },
          { value: 'high', label: t('settings.quality.high') },
        ] as const,
        (v) => callbacks.onPatch({ quality: v }),
      ),
    ),
    field(t('settings.haptics'), checkbox(settings.haptics, (v) => callbacks.onPatch({ haptics: v }))),
    field(t('settings.sfx'), slider(settings.sfxVolume, (v) => callbacks.onPatch({ sfxVolume: v }))),
    field(t('settings.music'), slider(settings.musicVolume, (v) => callbacks.onPatch({ musicVolume: v }))),
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
  return panel;
}
