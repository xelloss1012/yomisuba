import { es } from '../i18n/es';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { it } from '../i18n/it';
import { de } from '../i18n/de';
import { zh } from '../i18n/zh';
import { ko } from '../i18n/ko';
import { vi } from '../i18n/vi';

export type UiLanguage = 'es' | 'en' | 'fr' | 'it' | 'de' | 'zh' | 'ko' | 'vi';

export interface AvailableLanguage {
  code: UiLanguage;
  label: string;
}

export const AVAILABLE_LANGUAGES: AvailableLanguage[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'vi', label: 'Tiếng Việt' },
];

export interface SyncErrorInfo {
  key: string;
  details?: string;
}

export type SyncErrorState = SyncErrorInfo | string | null;

const translations: Record<UiLanguage, Record<string, string>> = {
  es,
  en,
  fr,
  it,
  de,
  zh,
  ko,
  vi,
};

export function t(
  key: string,
  lang: UiLanguage = 'es',
  params?: Record<string, string | number>
): string {
  let text = translations[lang]?.[key] || translations.es[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export function formatSyncError(error: SyncErrorState, lang: UiLanguage = 'es'): string | null {
  if (!error) return null;
  if (typeof error === 'string') {
    return error;
  }
  const message = t(error.key, lang);
  return error.details ? `${message}: ${error.details}` : message;
}
