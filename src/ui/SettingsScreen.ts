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
    field(
      t('settings.reduceMotion'),
      checkbox(settings.reduceMotion, (v) => callbacks.onPatch({ reduceMotion: v })),
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
