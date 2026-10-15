import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import {
  resolveTranslationLanguage,
  t as translate,
  TranslationLanguage,
  UiLanguage,
} from '../utils/i18n';
import type { DictionarySearchOptions } from '../utils/dictionary';

interface LanguageState {
  language: UiLanguage;
  translationLanguage: TranslationLanguage;
}

const LanguageContext = createContext<LanguageState | null>(null);

export const LanguageProvider: React.FC<{
  language: UiLanguage;
  translationLanguage?: TranslationLanguage;
  children: React.ReactNode;
}> = ({ language, translationLanguage, children }) => {
  const value = useMemo(
    () => ({ language, translationLanguage: resolveTranslationLanguage(language, translationLanguage) }),
    [language, translationLanguage],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

const useLanguageState = (): LanguageState => {
  const state = useContext(LanguageContext);
  if (!state) throw new Error('Language hooks must be used inside <LanguageProvider>.');
  return state;
};

/** Current interface language. Components re-render when it changes. */
export const useLanguage = (): UiLanguage => useLanguageState().language;

/** Language Japanese text is translated into (never Japanese itself). */
export const useTranslationLanguage = (): TranslationLanguage => useLanguageState().translationLanguage;

/**
 * Dictionary lookup options that follow the interface: with a Japanese
 * interface lookups also search the downloaded Japanese–Japanese dictionary
 * (a no-op until it is installed). The object is stable per language.
 */
export const useDictionaryOptions = (): DictionarySearchOptions => {
  const language = useLanguage();
  return useMemo(() => ({ includeJapanese: language === 'ja' }), [language]);
};

export type Translate =(key: string, params?: Record<string, string | number>) => string;

/**
 * Translator bound to the interface language, so call sites never pass it.
 * The returned function is stable and reads the language of the latest render:
 * callbacks memoised without it in their dependencies still translate into the
 * current language instead of the one they were created with.
 */
export const useT = (): Translate => {
  const language = useLanguage();
  const languageRef = useRef(language);
  languageRef.current = language;
  return useCallback((key, params) => translate(key, languageRef.current, params), []);
};
