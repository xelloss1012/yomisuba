import React from 'react';
import { AiProvider, FontFamily, ReaderSettingsState, ReaderTheme } from '../types/epub';
import { X, Type, AlignLeft, Sun, BookOpen, Compass, Languages } from 'lucide-react';
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_MODEL_PRESETS } from '../utils/aiTranslation';
import {
  AVAILABLE_LANGUAGES,
  resolveTranslationLanguage,
  TRANSLATION_LANGUAGES,
  TranslationLanguage,
} from '../utils/i18n';
import { useT } from '../i18n/LanguageContext';
import { DownloadableDictionariesSection } from './OptionalDictionaryPanel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettingsState;
  selectedTheme: ReaderTheme;
  onUpdateSettings: (newSettings: Partial<ReaderSettingsState>) => void;
  printedPages?: number;
  onUpdatePrintedPages?: (pages: number | undefined) => void;
}

export const ReaderSettings: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  selectedTheme,
  onUpdateSettings,
  printedPages,
  onUpdatePrintedPages,
}) => {
  const t = useT();
  if (!isOpen) return null;

  const themes: { id: ReaderTheme; label: string; bg: string; text: string; border: string }[] = [
    { id: 'light', label: t('settings.themeLight'), bg: 'bg-white', text: 'text-zinc-900', border: 'border-zinc-300' },
    { id: 'paper', label: t('settings.themePaper'), bg: 'bg-[#faf7f0]', text: 'text-[#2c2825]', border: 'border-[#dfd7ca]' },
    { id: 'sepia', label: t('settings.themeSepia'), bg: 'bg-[#f4ede4]', text: 'text-[#5c4838]', border: 'border-[#d7c0a9]' },
    { id: 'dark', label: t('settings.themeDark'), bg: 'bg-[#18181b]', text: 'text-[#e4e4e7]', border: 'border-[#3f3f46]' },
  ];

  const fonts: { id: FontFamily; label: string; sample: string; family: string }[] = [
    { id: 'mincho', label: 'Mincho (明朝体)', sample: '美しい日本語', family: '"Noto Serif JP", serif' },
    { id: 'gothic', label: 'Gothic (ゴシック体)', sample: '美しい日本語', family: '"Noto Sans JP", sans-serif' },
    { id: 'serif', label: t('settings.fontSerif'), sample: 'Typography', family: 'Georgia, serif' },
    { id: 'sans', label: 'Sans-serif', sample: 'Typography', family: 'system-ui, sans-serif' },
  ];
  const aiProviders: { id: AiProvider; label: string; hint: string }[] = [
    { id: 'gemini', label: 'Google Gemini', hint: 'AIza...' },
    { id: 'openai', label: 'ChatGPT / OpenAI', hint: 'sk-...' },
    { id: 'deepseek', label: 'DeepSeek', hint: 'sk-...' },
    { id: 'openrouter', label: 'OpenRouter', hint: 'sk-or-v1-...' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl border border-zinc-200 dark:border-zinc-800 transform transition-transform"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Type className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('settings.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 pt-4 max-h-[75vh] overflow-y-auto">
          {/* Idioma de la interfaz */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
              <Languages className="w-4 h-4" /> {t('language.label')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {AVAILABLE_LANGUAGES.map((langItem) => (
                <button
                  key={langItem.code}
                  type="button"
                  onClick={() => onUpdateSettings({ language: langItem.code })}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    (settings.language || 'es') === langItem.code
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300 shadow-sm'
                      : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {langItem.label}
                </button>
              ))}
            </div>
            <span className="mt-3 block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('settings.translationLanguage')}
            </span>
            <select
              value={settings.translationLanguage ?? ''}
              onChange={(event) => onUpdateSettings({
                translationLanguage: (event.target.value || undefined) as TranslationLanguage | undefined,
              })}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
            >
              <option value="">
                {t('settings.translationLanguageAuto', {
                  language: TRANSLATION_LANGUAGES.find(
                    (item) => item.code === resolveTranslationLanguage(settings.language),
                  )?.label || '',
                })}
              </option>
              {TRANSLATION_LANGUAGES.map((langItem) => (
                <option key={langItem.code} value={langItem.code}>{langItem.label}</option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-zinc-500 dark:text-zinc-400">
              {t('settings.translationLanguageHint')}
            </span>
            <DownloadableDictionariesSection />
          </div>

          {/* Dirección y Modo de Escritura (Japonés vertical vs horizontal) */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
              <Compass className="w-4 h-4" /> {t('settings.orientation')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings({ writingMode: 'vertical-rl', progressionDirection: 'rtl' })}
                className={`py-3 px-4 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                  settings.writingMode === 'vertical-rl'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300 font-semibold shadow-sm'
                    : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <span className="text-base">{t('settings.vertical')}</span>
                <span className="text-xs opacity-75">{t('settings.verticalHint')}</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ writingMode: 'horizontal-tb', progressionDirection: 'ltr' })}
                className={`py-3 px-4 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                  settings.writingMode === 'horizontal-tb'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300 font-semibold shadow-sm'
                    : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <span className="text-base">{t('settings.horizontal')}</span>
                <span className="text-xs opacity-75">{t('settings.horizontalHint')}</span>
              </button>
            </div>
          </div>

          {/* Tipo de Paginación y Páginas Impresas */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" /> {t('settings.pagination')}
            </label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { id: 'device' as const, label: t('settings.paginationDevice') },
                { id: 'printed' as const, label: t('settings.paginationPrinted') },
                { id: 'percent' as const, label: t('settings.paginationPercent') },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onUpdateSettings({ paginationMode: m.id })}
                  className={`py-2 px-2 rounded-xl border text-xs font-medium transition-all ${
                    settings.paginationMode === m.id
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300 font-semibold shadow-sm'
                      : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {onUpdatePrintedPages && (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('settings.printedPages')}</span>
                  <span className="text-xs text-zinc-500">{t('settings.optional')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    placeholder="Ej. 300"
                    value={printedPages || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      onUpdatePrintedPages(isNaN(val) || val <= 0 ? undefined : val);
                    }}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-transparent px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100"
                  />
                  {printedPages && (
                    <button
                      type="button"
                      onClick={() => onUpdatePrintedPages(undefined)}
                      className="text-xs text-rose-600 dark:text-rose-400 hover:underline px-2 py-1 shrink-0"
                    >
                      {t('settings.clear')}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t('settings.printedHint')}
                </p>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={settings.autoRotate}
              onChange={(event) => onUpdateSettings({ autoRotate: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span>
              <span className="block text-sm font-medium">{t('settings.autoRotate')}</span>
              <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                {t('settings.autoRotateHint')}
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={settings.showFurigana}
              onChange={(event) => onUpdateSettings({ showFurigana: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span>
              <span className="block text-sm font-medium">{t('settings.furigana')}</span>
              <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                {t('settings.furiganaHint')}
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={settings.autoAnalyzePage}
              onChange={(event) => onUpdateSettings({ autoAnalyzePage: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span>
              <span className="block text-sm font-medium">{t('settings.autoAnalyze')}</span>
              <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                {t('settings.autoAnalyzeHint')}
              </span>
            </span>
          </label>

          {/* Tema / Color de fondo */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
              <Sun className="w-4 h-4" /> {t('settings.theme')}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {themes.map((th) => (
                <button
                  key={th.id}
                  onClick={() => onUpdateSettings({ theme: th.id })}
                  className={`py-2 px-1 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${th.bg} ${th.border} ${th.text} ${
                    selectedTheme === th.id ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-zinc-900 font-bold shadow-md' : 'opacity-85 hover:opacity-100'
                  }`}
                >
                  <span className="text-xs font-medium">{th.label}</span>
                </button>
              ))}
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={settings.autoNightMode}
                onChange={(event) => onUpdateSettings({ autoNightMode: event.target.checked })}
                className="mt-0.5 h-4 w-4 accent-indigo-600"
              />
              <span>
                <span className="block text-sm font-medium">{t('settings.nightMode')}</span>
                <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                  {t('settings.nightModeHint')}
                </span>
              </span>
            </label>
          </div>

          {/* Tipografía */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" /> {t('settings.fontFamily')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {fonts.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onUpdateSettings({ fontFamily: f.id })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    settings.fontFamily === f.id
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 dark:border-indigo-500 font-semibold'
                      : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                  }`}
                  style={{ fontFamily: f.family }}
                >
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{f.sample}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Tamaño de Fuente */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Type className="w-4 h-4" /> {t('settings.fontSize')}
              </label>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                {settings.fontSize}px
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onUpdateSettings({ fontSize: Math.max(12, settings.fontSize - 2) })}
                className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center text-sm font-bold text-zinc-700 dark:text-zinc-300"
              >
                A-
              </button>
              <input
                type="range"
                min="12"
                max="50"
                step="1"
                value={settings.fontSize}
                onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                className="flex-1 accent-indigo-600 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => onUpdateSettings({ fontSize: Math.min(50, settings.fontSize + 2) })}
                className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center text-base font-bold text-zinc-700 dark:text-zinc-300"
              >
                A+
              </button>
            </div>
          </div>

          {/* Interlineado */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <AlignLeft className="w-4 h-4" /> {t('settings.lineHeight')}
              </label>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                {settings.lineHeight.toFixed(1)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 1.5, label: t('settings.lineCompact') },
                { val: 1.9, label: t('settings.lineNormal') },
                { val: 2.3, label: t('settings.lineWide') },
              ].map((lh) => (
                <button
                  key={lh.val}
                  onClick={() => onUpdateSettings({ lineHeight: lh.val })}
                  className={`py-2 rounded-xl border text-xs font-medium transition-all ${
                    Math.abs(settings.lineHeight - lh.val) < 0.1
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300 font-bold'
                      : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {lh.label}
                </button>
              ))}
            </div>

            {/* Traducción con IA */}
            <div className="mt-6">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
                <span className="text-sm">✦</span> {t('settings.aiSection')}
              </label>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3">
                {t('settings.aiKeysNote')}
              </p>
              <div className="space-y-2">
                {aiProviders.map((provider) => (
                  <label key={provider.id} className="block">
                    <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {provider.label}
                    </span>
                    <input
                      type="password"
                      value={settings.aiApiKeys[provider.id] || ''}
                      onChange={(event) =>
                        onUpdateSettings({
                          aiApiKeys: {
                            ...settings.aiApiKeys,
                            [provider.id]: event.target.value,
                          },
                        })
                      }
                      placeholder={provider.hint}
                      autoComplete="off"
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
                    />
                  </label>
                ))}
                <div>
                  <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('settings.aiModel')}
                  </span>
                  <select
                    value={OPENROUTER_MODEL_PRESETS.some((model) => model.id === settings.openRouterModel)
                      ? settings.openRouterModel
                      : 'custom'}
                    onChange={(event) => {
                      onUpdateSettings({
                        openRouterModel: event.target.value === 'custom' ? '' : event.target.value,
                      });
                    }}
                    className="mb-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
                  >
                    {OPENROUTER_MODEL_PRESETS.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                    <option value="custom">{t('settings.customModel')}</option>
                  </select>
                  {settings.openRouterModel === '' || !OPENROUTER_MODEL_PRESETS.some((model) => model.id === settings.openRouterModel) ? (
                    <input
                      type="text"
                      value={settings.openRouterModel}
                      onChange={(event) => onUpdateSettings({ openRouterModel: event.target.value })}
                      placeholder="proveedor/modelo"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
                    />
                  ) : null}
                  <span className="mt-1 block text-[10px] text-zinc-500 dark:text-zinc-400">
                    {t('settings.defaultModel').replace('{model}', DEFAULT_OPENROUTER_MODEL)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
