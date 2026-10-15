import { es } from '../i18n/es';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { it } from '../i18n/it';
import { de } from '../i18n/de';
import { zh } from '../i18n/zh';
import { ko } from '../i18n/ko';
import { vi } from '../i18n/vi';
import { ja } from '../i18n/ja';

export type UiLanguage = 'es' | 'en' | 'fr' | 'it' | 'de' | 'zh' | 'ko' | 'vi' | 'ja';

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
  { code: 'ja', label: '日本語' },
];

/** Languages Japanese text can be translated into: every interface language but Japanese itself. */
export type TranslationLanguage = Exclude<UiLanguage, 'ja'>;

export const TRANSLATION_LANGUAGES = AVAILABLE_LANGUAGES.filter(
  (item): item is AvailableLanguage & { code: TranslationLanguage } => item.code !== 'ja',
);

/**
 * Language that translations, AI translations and the bilingual dictionary use.
 * Unless the reader picks one it follows the interface; a Japanese interface
 * falls back to English, since translating Japanese into Japanese makes no sense.
 */
export const resolveTranslationLanguage = (
  interfaceLanguage: UiLanguage,
  chosen?: TranslationLanguage,
): TranslationLanguage => chosen ?? (interfaceLanguage === 'ja' ? 'en' : interfaceLanguage);

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
  ja,
};

/**
 * Translation for code outside React components, which must say which language
 * it wants. Components use `useT()` from `i18n/LanguageContext` instead.
 */
export function t(
  key: string,
  lang: UiLanguage,
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

export function formatSyncError(error: SyncErrorState, lang: UiLanguage): string | null {
  if (!error) return null;
  if (typeof error === 'string') {
    return error;
  }
  const message = t(error.key, lang);
  return error.details ? `${message}: ${error.details}` : message;
}
