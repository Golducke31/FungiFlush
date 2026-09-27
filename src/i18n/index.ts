/**
 * i18n/index.ts — Internacionalizacion desde el dia 1.
 *
 * REGLA: ninguna cadena visible al usuario se escribe literal en el codigo.
 * Todo pasa por `t('clave')`. Los nombres y descripciones de cartas viven en
 * los JSON de contenido como `nameKey` / `descKey`, nunca como texto plano.
 *
 * El ingles es el idioma base (fallback). El español esta completo.
 */

import i18next from 'i18next';
import { bus } from '@engine/index';

import en from './en.json';
import es from './es.json';

export { validateDictionaryCoverage } from './coverage';
export type { Dictionary } from './coverage';

export const SUPPORTED_LANGS = ['en', 'es'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const STORAGE_KEY = 'fungiflush.lang';

const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

function detectLang(): Lang {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) return stored as Lang;
    const nav = globalThis.navigator?.language?.toLowerCase() ?? 'en';
    return nav.startsWith('es') ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

let initialized = false;

export async function initI18n(lang?: Lang): Promise<void> {
  if (initialized) return;
  await i18next.init({
    lng: lang ?? detectLang(),
    fallbackLng: 'en',
    resources,
    // Los diccionarios usan interpolacion de una sola llave ({cost}), no la
    // doble de i18next ({{cost}}). Es mas legible para quien traduce.
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    returnNull: false,
    debug: false,
  });
  initialized = true;
  globalThis.document?.documentElement?.setAttribute('lang', currentLanguage());
}

/** Traduce una clave. Devuelve la clave entre corchetes si falta. */
export function t(key: string, params?: Record<string, unknown>): string {
  const value = i18next.t(key, params);
  return typeof value === 'string' && value.length > 0 ? value : `[${key}]`;
}

/** Traduce una clave de contenido (nameKey / descKey) de un objeto de datos. */
export function tName(obj: { nameKey: string }): string {
  return t(obj.nameKey);
}

export function tDesc(obj: { descKey: string }): string {
  return t(obj.descKey);
}

export function currentLanguage(): Lang {
  return (i18next.language as Lang) ?? 'en';
}

export async function setLanguage(lang: Lang): Promise<void> {
  await i18next.changeLanguage(lang);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    /* almacenamiento no disponible: no es critico */
  }
  // IMPORTANTE: el atributo lang del <html> se actualiza ANTES de emitir el
  // evento. El render lo lee para regenerar las texturas de las cartas; si se
  // actualizara despues, las cartas quedarian en el idioma anterior.
  globalThis.document?.documentElement?.setAttribute('lang', lang);
  bus.emit('i18n:changed', { lang });
}

export function toggleLanguage(): Promise<void> {
  return setLanguage(currentLanguage() === 'en' ? 'es' : 'en');
}
