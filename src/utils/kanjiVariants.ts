/**
 * Kanji that books print in their traditional form (the 印刷標準字体 of JIS X 0213: 摑む, 啞然, 噓) where
 * kuromoji's dictionary only knows the everyday one (掴む, 唖然, 嘘). Unknown, kuromoji cuts the word
 * into single characters with no base form. Each pair is one UTF-16 unit on both sides, so swapping
 * them keeps every offset of the text.
 */
const VARIANT_PAIRS = [
  '啞唖', '噓嘘', '摑掴', '蟬蝉', '頰頬', '剝剥', '搔掻', '醬醤', '屛屏', '瘦痩', '繡繍', '蔣蒋', '餠餅',
  '鷗鴎', '麴麹', '繫繋', '禱祷', '潑溌', '囊嚢', '蠟蝋', '俠侠', '俱倶', '吞呑', '屢屡', '焰焔', '簞箪',
  '藪薮', '讚讃', '賤賎', '頸頚', '鹼鹸', '麵麺', '塡填', '瀆涜', '禰祢', '蠅蝿', '軀躯', '邇迩', '攪撹',
];

const EVERYDAY_FORM = new Map(VARIANT_PAIRS.map((pair) => [pair[0], pair[1]]));
const VARIANTS = new RegExp(`[${[...EVERYDAY_FORM.keys()].join('')}]`, 'g');

/** The text with its traditional kanji in their everyday form, of the same length. */
export const toEverydayKanji = (text: string): string =>
  text.replace(VARIANTS, (variant) => EVERYDAY_FORM.get(variant) ?? variant);
