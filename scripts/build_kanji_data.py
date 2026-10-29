"""Builds src/data/kanji.json.gz: what the kanji card shows of each kanji in common use.

    python scripts/build_kanji_data.py kanjidic2.xml.gz kradfile.gz src/data/kanji.json.gz

Sources (EDRDG, CC BY-SA 4.0, credited in README):
- KANJIDIC2 (https://www.edrdg.org/kanjidic/kanjidic2.xml.gz): readings, meanings (English, Spanish,
  French, Portuguese), stroke count, school grade and newspaper frequency of each kanji, and its
  reading in Chinese (pinyin), Korean (hangul) and Vietnamese.
- KRADFILE (http://ftp.edrdg.org/pub/Nihongo/kradfile.gz, EUC-JP): the parts each kanji is made of.

Only the kanji of the jōyō and jinmeiyō lists (school grade 1-10, about 3,000) go in: the ones a
reader meets. Their JLPT level is not repeated here; it comes from word-levels.json.gz.

Output: { "kanji": { literal: {
  "s": strokes, "g": grade, "f": frequency rank (1 = most frequent; absent if not ranked),
  "on": [katakana], "kun": ["はげ.しい" — the part after "." is okurigana, "-" marks an affix],
  "n": [readings in names],
  "m": { "en": [...], "es": [...], "fr": [...], "pt": [...] },
  "py": [pinyin], "ko": [hangul], "vi": [Vietnamese],
  "c": [parts] } } }
"""

import argparse
import gzip
import json
import xml.etree.ElementTree as ET
from pathlib import Path

MEANING_LANGUAGES = ("en", "es", "fr", "pt")

# KRADFILE writes some parts with a whole kanji that stands for them (JIS X 0208 has no character for the
# part alone): 汁 is 氵, 扎 is 扌... These are the parts as they look inside a kanji.
PART_FORMS = {
    "化": "⺅", "个": "𠆢", "并": "丷", "刈": "刂", "込": "⻌", "尚": "⺌", "忙": "忄", "扎": "扌",
    "汁": "氵", "犯": "犭", "艾": "⺾", "邦": "⻏", "阡": "⻖", "老": "⺹", "杰": "灬", "礼": "礻",
    "疔": "疒", "禹": "禸", "初": "衤", "滴": "啇", "乞": "𠂉",
}


def read_parts(path):
    parts = {}
    with gzip.open(path, "rb") as raw:
        for line in raw.read().decode("euc_jp", errors="replace").splitlines():
            if not line or line.startswith("#") or " : " not in line:
                continue
            literal, pieces = line.split(" : ", 1)
            parts[literal.strip()] = [PART_FORMS.get(piece, piece) for piece in pieces.split()]
    return parts


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kanjidic", type=Path)
    parser.add_argument("kradfile", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    parts = read_parts(args.kradfile)
    kanji = {}
    with gzip.open(args.kanjidic, "rb") as xml:
        for _, element in ET.iterparse(xml, events=("end",)):
            if element.tag != "character":
                continue
            literal = element.findtext("literal")
            grade = int(element.findtext("misc/grade") or 0)
            if not grade:
                element.clear()
                continue
            readings = {}
            meanings = {language: [] for language in MEANING_LANGUAGES}
            for group in element.iterfind("reading_meaning/rmgroup"):
                for reading in group.iterfind("reading"):
                    readings.setdefault(reading.get("r_type"), []).append(reading.text)
                for meaning in group.iterfind("meaning"):
                    language = meaning.get("m_lang", "en")
                    if language in meanings:
                        meanings[language].append(meaning.text)
            entry = {
                "s": int(element.findtext("misc/stroke_count") or 0),
                "g": grade,
            }
            freq = element.findtext("misc/freq")
            if freq:
                entry["f"] = int(freq)
            for key, r_type in (("on", "ja_on"), ("kun", "ja_kun"), ("py", "pinyin"), ("ko", "korean_h"), ("vi", "vietnam")):
                if readings.get(r_type):
                    entry[key] = readings[r_type]
            names = [name.text for name in element.iterfind("reading_meaning/nanori")]
            if names:
                entry["n"] = names
            entry["m"] = {language: values for language, values in meanings.items() if values}
            if parts.get(literal):
                entry["c"] = parts[literal]
            kanji[literal] = entry
            element.clear()

    data = json.dumps({"kanji": dict(sorted(kanji.items()))}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.GzipFile(args.output, "wb", compresslevel=9, mtime=0) as compressed:
        compressed.write(data)
    with_parts = sum(1 for entry in kanji.values() if "c" in entry)
    print(f"{len(kanji):,} kanji ({with_parts:,} with parts), {len(data):,} bytes raw, {args.output.stat().st_size:,} gzip")


if __name__ == "__main__":
    main()
