// kuromoji's DictionaryLoader does require("path") just to call path.join on
// the dictionary URL. Vite replaces Node built-ins with an empty stub in the
// browser, so join was undefined, the tokenizer failed to build, and the
// dictionary silently fell back to the regex deconjugation. This is the
// only part of `path` it needs.
export const join = (...parts: string[]): string =>
  parts
    .filter((part) => part !== '')
    .join('/')
    .replace(/\/{2,}/g, '/');

export default { join };
