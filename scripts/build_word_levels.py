"""Builds src/data/word-levels.json.gz: how common or useful each Japanese word is.

    python scripts/build_word_levels.py JMdict.gz kanjidic2.xml.gz JLPT_vocab_ALL.json JLPT_kanji_ALL.json src/data/word-levels.json.gz

Sources (all free licenses, credited in README):
- JMdict (EDRDG, CC BY-SA 4.0): frequency priority tags of each written form.
  news1/ichi1/spec1/spec2/gai1 mark the ~22,000 "common" words; nfXX ranks
  newspaper frequency in blocks of 500 words (nf01 = top 500 ... nf48).
- JLPT word and kanji lists by Jonathan Waller (tanos.co.uk, CC BY), as
  packaged by github.com/Bluskyo/JLPT_Vocabulary. Unofficial: the JLPT has not
  published word lists since 2010, but they are the reference learners use.
- KANJIDIC2 (EDRDG, CC BY-SA 4.0): school grade of each kanji (jōyō or not).

Output:
  { "w": { form: code }, "k": { kanji: code } }
  word code  = jlpt * 10 + band   (jlpt 5..1 = N5..N1, 0 = not listed;
                                   band 1 basic, 2 common, 3 uncommon)
  kanji code = jlpt * 100 + grade (grade 1-6 school, 8 secondary jōyō,
                                   9-10 jinmeiyō; kanji outside every list are omitted)
Kana forms inherit the level of the word they spell (たべる → N5 like 食べる);
when a spelling belongs to several words, the easiest one wins.
"""

import argparse
import gzip
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

COMMON_TAGS = {"news1", "ichi1", "spec1", "spec2", "gai1"}
LESS_COMMON_TAGS = {"news2", "ichi2", "gai2"}
# nf01-nf06: the 3,000 most frequent words in the newspaper corpus.
BASIC_NF_LIMIT = 6


def band_of(tags):
    nf = min((int(tag[2:]) for tag in tags if re.fullmatch(r"nf\d+", tag)), default=None)
    if nf is not None and nf <= BASIC_NF_LIMIT:
        return 1
    if tags & COMMON_TAGS or nf is not None:
        return 2
    if tags & LESS_COMMON_TAGS:
        return 3
    return 0


def easier(left, right):
    """The easier of two (jlpt, band) pairs: higher JLPT number, then lower band."""
    def key(pair):
        jlpt, band = pair
        return (jlpt or 0, -(band or 4))
    return left if key(left) >= key(right) else right


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("jmdict", type=Path)
    parser.add_argument("kanjidic", type=Path)
    parser.add_argument("jlpt_vocab", type=Path)
    parser.add_argument("jlpt_kanji", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    jlpt_vocab = json.loads(args.jlpt_vocab.read_text(encoding="utf-8"))
    # (written form, reading) → level, and written form → easiest level.
    jlpt_by_pair = {}
    jlpt_by_form = {}
    for form, items in jlpt_vocab.items():
        for item in items:
            level = int(item["level"])
            jlpt_by_pair[(form, item["reading"])] = max(level, jlpt_by_pair.get((form, item["reading"]), 0))
            jlpt_by_form[form] = max(level, jlpt_by_form.get(form, 0))

    words = {}

    def add(form, pair):
        if pair == (0, 0):
            return
        words[form] = easier(words[form], pair) if form in words else pair

    with gzip.open(args.jmdict, "rb") as xml:
        for _, element in ET.iterparse(xml, events=("end",)):
            if element.tag != "entry":
                continue
            kanji = [(k.findtext("keb"), {p.text for p in k.findall("ke_pri")}) for k in element.findall("k_ele")]
            readings = [(r.findtext("reb"), {p.text for p in r.findall("re_pri")}) for r in element.findall("r_ele")]
            # The JLPT lists key words that are written in kana (する, ある) by their
            # kana. Those only identify this entry when it is itself written in
            # kana, or JMdict marks it as usually so: otherwise 刷る would inherit
            # the N5 of する.
            usually_kana = not kanji or any(
                misc.text and "usually written using kana" in misc.text
                for sense in element.findall("sense") for misc in sense.findall("misc")
            )
            # The JLPT level belongs to the word, so every spelling and reading of
            # the entry shares the easiest level any of its spellings has.
            jlpt = max(
                [jlpt_by_pair.get((k, r), 0) for k, _ in kanji for r, _ in readings]
                + [jlpt_by_form.get(k, 0) for k, _ in kanji]
                + ([jlpt_by_form.get(r, 0) for r, _ in readings] if usually_kana else []),
                default=0,
            )
            entry_band = min((b for b in (band_of(t) for _, t in kanji + readings) if b), default=0)
            for form, tags in kanji:
                add(form, (jlpt, band_of(tags) or (entry_band if jlpt else 0)))
            for form, tags in readings:
                add(form, (jlpt, band_of(tags) or (entry_band if jlpt else 0)))
            element.clear()

    jlpt_kanji = json.loads(args.jlpt_kanji.read_text(encoding="utf-8"))
    kanji_codes = {}
    with gzip.open(args.kanjidic, "rb") as xml:
        for _, element in ET.iterparse(xml, events=("end",)):
            if element.tag != "character":
                continue
            literal = element.findtext("literal")
            grade = int(element.findtext("misc/grade") or 0)
            level = int(jlpt_kanji.get(literal, 0))
            if grade or level:
                kanji_codes[literal] = level * 100 + grade
            element.clear()

    output = {
        "w": {form: jlpt * 10 + band for form, (jlpt, band) in sorted(words.items())},
        "k": dict(sorted(kanji_codes.items())),
    }
    data = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.GzipFile(args.output, "wb", compresslevel=9, mtime=0) as compressed:
        compressed.write(data)

    levels = {}
    for jlpt, band in words.values():
        levels[f"N{jlpt}" if jlpt else f"band{band}"] = levels.get(f"N{jlpt}" if jlpt else f"band{band}", 0) + 1
    print(f"{len(words):,} forms, {len(kanji_codes):,} kanji, {len(data):,} bytes raw, "
          f"{args.output.stat().st_size:,} gzip; {dict(sorted(levels.items()))}")


if __name__ == "__main__":
    main()
