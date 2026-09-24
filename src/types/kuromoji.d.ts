declare module 'kuromoji' {
  export interface KuromojiToken {
    surface_form: string;
    pos: string;
    basic_form?: string;
  }

  export interface KuromojiTokenizer {
    tokenize(input: string): KuromojiToken[];
  }

  export interface KuromojiBuilder {
    build(callback: (err: Error | null, tokenizer: KuromojiTokenizer) => void): void;
  }

  export function builder(options: { dicPath: string }): KuromojiBuilder;
}
