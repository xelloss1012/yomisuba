import { AiProvider } from '../types/epub';
import { TranslationLanguage, UiLanguage, tr } from './i18n';

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Gemini',
  openai: 'ChatGPT',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
};

export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
export const OPENROUTER_MODEL_PRESETS = [
  { id: 'openrouter/free', label: 'Gratis · selección automática' },
  { id: 'openrouter/auto', label: 'Automático · mejor modelo para la tarea' },
  { id: 'latest/openai', label: 'Último disponible de OpenAI' },
  { id: 'latest/anthropic', label: 'Último disponible de Claude (Anthropic)' },
  { id: 'latest/google', label: 'Último disponible de Gemini (Google)' },
  { id: 'latest/deepseek', label: 'Último disponible de DeepSeek' },
  { id: 'latest/x-ai', label: 'Último disponible de xAI (Grok)' },
  { id: 'latest/meta-llama', label: 'Último disponible de Meta (Llama)' },
  { id: 'latest/mistralai', label: 'Último disponible de Mistral' },
  { id: 'latest/qwen', label: 'Último disponible de Qwen' },
] as const;

interface OpenRouterCatalogModel {
  id?: string;
  name?: string;
  created?: number;
  expiration_date?: string | null;
}

let openRouterCatalogPromise: Promise<OpenRouterCatalogModel[]> | null = null;
let openRouterCatalogLoadedAt = 0;
const OPENROUTER_CATALOG_CACHE_MS = 15 * 60 * 1000;

async function getOpenRouterCatalog(): Promise<OpenRouterCatalogModel[]> {
  if (
    openRouterCatalogPromise &&
    Date.now() - openRouterCatalogLoadedAt < OPENROUTER_CATALOG_CACHE_MS
  ) {
    return openRouterCatalogPromise;
  }

  openRouterCatalogLoadedAt = Date.now();
  const request = (async () => {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || `HTTP ${response.status}`;
      throw new Error(tr('err.aiCatalogFetch', { message }));
    }
    if (!Array.isArray(payload?.data)) {
      throw new Error(tr('err.aiCatalogFormat'));
    }
    return payload.data as OpenRouterCatalogModel[];
  })();
  openRouterCatalogPromise = request;
  request.catch(() => {
    if (openRouterCatalogPromise === request) {
      openRouterCatalogPromise = null;
      openRouterCatalogLoadedAt = 0;
    }
  });
  return request;
}

export async function resolveOpenRouterModel(selection: string): Promise<string> {
  if (!selection.startsWith('latest/')) return selection;

  const provider = selection.slice('latest/'.length);
  const models = (await getOpenRouterCatalog())
    .filter((model) =>
      model.id?.startsWith(`${provider}/`) &&
      (provider !== 'google' || /gemini/i.test(`${model.id} ${model.name || ''}`)) &&
      !model.id.includes(':') &&
      model.created &&
      (!model.expiration_date || Date.parse(model.expiration_date) > Date.now())
    )
    .sort((left, right) => (right.created || 0) - (left.created || 0));
  const latestModel = models[0]?.id;
  if (!latestModel) {
    throw new Error(tr('err.aiNoActiveModels', { provider }));
  }
  return latestModel;
}

const languageNames: Record<TranslationLanguage, string> = {
  es: 'español',
  en: 'English',
  fr: 'French',
  it: 'Italian',
  de: 'German',
  zh: 'Simplified Chinese',
  ko: 'Korean',
  vi: 'Vietnamese',
};

function translationPrompt(text: string, targetLanguage: TranslationLanguage): string {
  const target = languageNames[targetLanguage] || 'English';
  if (targetLanguage === 'es') {
    return [
      'Traduce del japonés al español el texto siguiente.',
      'Devuelve únicamente la traducción, sin explicaciones, notas ni markdown.',
      '',
      text,
    ].join('\n');
  }
  return [
    `Translate the following Japanese text to ${target}.`,
    'Return only the translation, without explanations, notes, or markdown.',
    '',
    text,
  ].join('\n');
}

function explanationPrompt(text: string, targetLanguage: UiLanguage): string {
  // With a Japanese interface there is nothing to translate into: the text is
  // paraphrased and explained in plain Japanese, as a monolingual dictionary would.
  if (targetLanguage === 'ja') {
    return [
      '次の日本語の文を、日本語学習者にもわかるやさしい日本語で言い換えてから、解説してください。',
      '最初に言い換えた文を示し、そのあとで全体の意味、文法の構造、大事な活用、重要な語彙を説明してください。',
      'ニュアンス、文体、文化的な背景は、役に立つときだけ補足してください。',
      '難しい漢字を使うときは、読みをひらがなで（ ）に入れてください。ローマ字は使わないでください。',
      '「言い換え」と「解説」の見出しを付け、短い箇条書きでまとめてください。あいまいな点について情報を作り上げないでください。',
      '',
      '日本語の文:',
      text,
    ].join('\n');
  }
  const target = languageNames[targetLanguage] || 'English';
  if (targetLanguage === 'es') {
    return [
      'Traduce primero el texto japonés al español y, a continuación, explica esa traducción que tú mismo has generado.',
      'Incluye la traducción al principio de la respuesta y después explica el sentido general, las construcciones gramaticales, las conjugaciones importantes y el vocabulario relevante.',
      'Aclara matices, registro o contexto cultural solo cuando sean útiles.',
      'No uses romaji ni transliteres japonés al alfabeto latino en las explicaciones de gramática o vocabulario.',
      'Cuando indiques la lectura o pronunciación de una palabra japonesa, escríbela en hiragana o katakana, según corresponda.',
      'Estructura la respuesta con los apartados «Traducción» y «Explicación», además de viñetas breves. No inventes información si algo es ambiguo.',
      '',
      'Texto japonés:',
      text,
    ].join('\n');
  }
  return [
    `Translate the Japanese text to ${target} first, and then explain the translation you generated in ${target}.`,
    'Include the translation at the beginning of the response and then explain the general meaning, grammatical structures, important conjugations, and relevant vocabulary.',
    'Clarify nuances, register, or cultural context only when useful.',
    'Do not use romaji or transliterate Japanese into the Latin alphabet in grammar or vocabulary explanations.',
    'When indicating the reading or pronunciation of a Japanese word, write it in hiragana or katakana as appropriate.',
    'Structure the response with "Translation" and "Explanation" headings, plus brief bullet points. Do not invent information if something is ambiguous.',
    '',
    'Japanese text:',
    text,
  ].join('\n');
}

interface GeminiModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

const geminiModelCache = new Map<string, string[]>();

async function getGeminiTranslationModels(apiKey: string, refresh = false): Promise<string[]> {
  const cachedModel = geminiModelCache.get(apiKey);
  if (cachedModel && !refresh) return cachedModel;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(tr('err.aiGeminiModels', { message }));
  }

  const models = (payload?.models || []) as GeminiModel[];
  const usableModels = models
    .filter((model) =>
      model.name &&
      model.supportedGenerationMethods?.includes('generateContent') &&
      !model.name.includes('image') &&
      !model.name.includes('audio') &&
      !model.name.includes('tts') &&
      !model.name.includes('embedding') &&
      !model.name.includes('robotics')
    )
    .map((model) => model.name as string);

  const sortedModels = usableModels
    .sort((a, b) => {
      const score = (name: string) => {
        if (name.includes('3.5') && name.includes('flash-lite')) return 0;
        if (name.includes('flash-lite')) return 1;
        if (name.includes('flash')) return 2;
        if (name.includes('pro')) return 3;
        return 4;
      };
      return score(a) - score(b) || a.localeCompare(b);
    });

  if (sortedModels.length === 0) {
    throw new Error(tr('err.aiGeminiNoModel'));
  }

  geminiModelCache.set(apiKey, sortedModels);
  return sortedModels;
}

async function parseResponse(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.code || `HTTP ${response.status}`;
    throw new Error(tr('err.aiRejected', { message }));
  }
  return String(
    payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') ||
    payload?.choices?.[0]?.message?.content ||
    ''
  ).trim();
}

async function generateWithAi(
  provider: AiProvider,
  apiKey: string,
  prompt: string,
  systemMessage: string,
  maxOutputTokens: number,
  openRouterModel = DEFAULT_OPENROUTER_MODEL,
): Promise<string> {
  let response: Response | undefined;

  if (provider === 'gemini') {
    let models = await getGeminiTranslationModels(apiKey);
    let lastModelError = '';

    for (const model of models) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens },
          }),
        },
      );

      if (response.ok) {
        geminiModelCache.set(apiKey, [model, ...models.filter((candidate) => candidate !== model)]);
        break;
      }

      const errorPayload = await response.json().catch(() => null);
      const errorMessage = String(errorPayload?.error?.message || '');
      lastModelError = errorMessage || `HTTP ${response.status}`;
      const modelUnavailable =
        response.status === 404 ||
        /not available|no longer available|not found|unsupported/i.test(errorMessage);

      if (!modelUnavailable) {
        throw new Error(tr('err.aiRejected', { message: lastModelError }));
      }
    }

    if (!response || !response.ok) {
      // Refresh once because the account's available models can differ from
      // the first list returned by the API.
      models = await getGeminiTranslationModels(apiKey, true);
      for (const model of models) {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens },
            }),
          },
        );
        if (response.ok) {
          geminiModelCache.set(apiKey, [model, ...models.filter((candidate) => candidate !== model)]);
          break;
        }
        const errorPayload = await response.json().catch(() => null);
        lastModelError = String(errorPayload?.error?.message || `HTTP ${response.status}`);
      }
    }

    if (!response || !response.ok) {
      throw new Error(tr('err.aiRejected', { message: lastModelError }));
    }
  } else {
    const isDeepSeek = provider === 'deepseek';
    const isOpenRouter = provider === 'openrouter';
    response = await fetch(
      isOpenRouter
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : isDeepSeek
          ? 'https://api.deepseek.com/chat/completions'
          : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: isOpenRouter
            ? openRouterModel.trim() || DEFAULT_OPENROUTER_MODEL
            : isDeepSeek
              ? 'deepseek-chat'
              : 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: maxOutputTokens,
        }),
      },
    );
  }

  if (!response) throw new Error(tr('err.aiNoResponse'));
  const result = await parseResponse(response);
  if (!result) throw new Error(tr('err.aiNoResponse'));
  return result;
}

export async function translateWithAi(
  provider: AiProvider,
  apiKey: string,
  text: string,
  openRouterModel: string | undefined,
  targetLanguage: TranslationLanguage,
): Promise<string> {
  const target = languageNames[targetLanguage] || 'English';
  const systemMessage = targetLanguage === 'es'
    ? 'Eres un traductor preciso de japonés a español.'
    : `You are a precise Japanese to ${target} translator.`;
  return generateWithAi(
    provider,
    apiKey,
    translationPrompt(text, targetLanguage),
    systemMessage,
    1024,
    openRouterModel,
  );
}

export async function explainWithAi(
  provider: AiProvider,
  apiKey: string,
  text: string,
  openRouterModel: string | undefined,
  targetLanguage: UiLanguage,
): Promise<string> {
  const systemMessage = targetLanguage === 'ja'
    ? 'あなたは、やさしい日本語で正確にわかりやすく説明する日本語の先生です。'
    : targetLanguage === 'es'
      ? 'Eres un profesor experto de japonés que explica en español de forma clara y precisa.'
      : `You are an expert Japanese teacher who explains clearly and accurately in ${languageNames[targetLanguage] || 'English'}.`;
  return generateWithAi(
    provider,
    apiKey,
    explanationPrompt(text, targetLanguage),
    systemMessage,
    2048,
    openRouterModel,
  );
}
