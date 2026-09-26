import { AiProvider } from '../types/epub';

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Gemini',
  openai: 'ChatGPT',
  deepseek: 'DeepSeek',
};

function translationPrompt(text: string): string {
  return [
    'Traduce del japonés al español el texto siguiente.',
    'Devuelve únicamente la traducción, sin explicaciones, notas ni markdown.',
    '',
    text,
  ].join('\n');
}

function explanationPrompt(text: string, translation: string): string {
  return [
    'Explica en español la traducción de este texto japonés.',
    'Describe el sentido general, la gramática y las conjugaciones importantes, y el vocabulario relevante.',
    'Aclara matices, registro o contexto cultural solo cuando sean útiles.',
    'No uses romaji ni transliteres japonés al alfabeto latino en las explicaciones de gramática o vocabulario.',
    'Cuando indiques la lectura o pronunciación de una palabra japonesa, escríbela en hiragana o katakana, según corresponda.',
    'Estructura la respuesta con apartados breves y viñetas. No inventes información si algo es ambiguo.',
    '',
    'Texto japonés:',
    text,
    '',
    'Traducción propuesta:',
    translation || '(todavía no hay traducción disponible)',
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
    throw new Error(`No se pudieron consultar los modelos de Gemini: ${message}`);
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
    throw new Error('La clave de Gemini no tiene ningún modelo compatible con generateContent.');
  }

  geminiModelCache.set(apiKey, sortedModels);
  return sortedModels;
}

async function parseResponse(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.code || `HTTP ${response.status}`;
    throw new Error(`El proveedor rechazó la petición: ${message}`);
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
        throw new Error(`El proveedor rechazó la petición: ${lastModelError}`);
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
      throw new Error(`El proveedor rechazó la petición: ${lastModelError}`);
    }
  } else {
    const isDeepSeek = provider === 'deepseek';
    response = await fetch(
      isDeepSeek ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini',
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

  if (!response) throw new Error('El proveedor no devolvió una respuesta.');
  const result = await parseResponse(response);
  if (!result) throw new Error('El proveedor no devolvió una respuesta.');
  return result;
}

export async function translateWithAi(
  provider: AiProvider,
  apiKey: string,
  text: string,
): Promise<string> {
  return generateWithAi(
    provider,
    apiKey,
    translationPrompt(text),
    'Eres un traductor preciso de japonés a español.',
    1024,
  );
}

export async function explainWithAi(
  provider: AiProvider,
  apiKey: string,
  text: string,
  translation: string,
): Promise<string> {
  return generateWithAi(
    provider,
    apiKey,
    explanationPrompt(text, translation),
    'Eres un profesor experto de japonés que explica en español de forma clara y precisa.',
    2048,
  );
}
