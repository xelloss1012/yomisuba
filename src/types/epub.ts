export type WritingMode = 'vertical-rl' | 'horizontal-tb' | 'auto';
export type ProgressionDirection = 'rtl' | 'ltr' | 'auto';
export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'paper';
export type FontFamily = 'mincho' | 'gothic' | 'serif' | 'sans';
export type AiProvider = 'gemini' | 'openai' | 'deepseek' | 'openrouter';

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
  theme: ReaderTheme;
  autoNightMode: boolean;
  letterSpacing: number; // in em
  aiApiKeys: Partial<Record<AiProvider, string>>;
  openRouterModel: string;
}
