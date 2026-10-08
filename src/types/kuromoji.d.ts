declare module 'kuromoji' {
  export interface KuromojiToken {
    surface_form: string;
    pos: string;
    pos_detail_1?: string;
    pos_detail_2?: string;
    pos_detail_3?: string;
    basic_form?: string;
    reading?: string;
    conjugated_type?: string;
    conjugated_form?: string;
  }

  export interface KuromojiTokenizer {
    tokenize(input: string): KuromojiToken[];
  }

  export interface KuromojiBuilder {
    build(callback: (err: Error | null, tokenizer: KuromojiTokenizer) => void): void;
  }

  export function builder(options: { dicPath: string }): KuromojiBuilder;
}
