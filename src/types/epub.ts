import { TranslationLanguage, UiLanguage } from '../utils/i18n';
import type { JlptLevel } from '../utils/wordLevels';
import type { FuriganaMode } from '../utils/furigana';

export type WritingMode = 'vertical-rl' | 'horizontal-tb' | 'auto';
export type ProgressionDirection = 'rtl' | 'ltr' | 'auto';
export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'paper';
export type FontFamily = 'mincho' | 'gothic' | 'serif' | 'sans';
export type AiProvider = 'gemini' | 'openai' | 'deepseek' | 'openrouter';
export type PaginationMode = 'device' | 'printed' | 'percent';

export interface BookMetadata {
  title: string;
  creator: string;
  language: string;
  direction?: 'rtl' | 'ltr';
  publisher?: string;
  description?: string;
  coverUrl?: string;
}

export interface TocItem {
  id: string;
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface SpineItem {
  id: string;
  href: string;
  mediaType?: string;
  linear?: boolean;
  properties?: string;
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export interface ParsedEpub {
  metadata: BookMetadata;
  spine: SpineItem[];
  toc: TocItem[];
  manifest: Record<string, ManifestItem>;
  rootPath: string; // Directory containing OPF file
  coverBlob?: Blob;
  getChapterContent: (href: string) => Promise<string>;
  getResourceBlobUrl: (href: string) => Promise<string | null>;
  close: () => void;
}

export interface ReaderSettingsState {
  writingMode: WritingMode;
  progressionDirection: ProgressionDirection;
  fontSize: number; // in pixels
  lineHeight: number; // multiplier e.g. 1.8
  fontFamily: FontFamily;
  /** Kept alongside furiganaMode for settings saved before it: true unless the mode is "hidden". */
  showFurigana: boolean;
  /** Unset in settings saved before the modes existed; see resolveFuriganaMode. */
  furiganaMode?: FuriganaMode;
  autoAnalyzePage: boolean;
  autoRotate: boolean;
  theme: ReaderTheme;
  autoNightMode: boolean;
  letterSpacing: number; // in em
  aiApiKeys: Partial<Record<AiProvider, string>>;
  openRouterModel: string;
  paginationMode: PaginationMode;
  language: UiLanguage;
  /** Target of translations; unset means "follow the interface" (see resolveTranslationLanguage). */
  translationLanguage?: TranslationLanguage;
  /** The reader's JLPT level (5 = N5 … 1 = N1); unset when they have not said. */
  studyLevel?: JlptLevel;
}
