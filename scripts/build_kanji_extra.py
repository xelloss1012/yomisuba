"""Builds kanji-extra.json.gz, the optional download "more kanji": stroke order and the rare kanji.

    python scripts/build_kanji_extra.py kanjidic2.xml.gz kradfile.gz kanjivg.xml.gz kanji-extra.json.gz

It is published in the yomisuba-dictionaries repository and downloaded from the settings or from a kanji
card. Sources:
- KanjiVG (https://kanjivg.tagaini.net, © Ulrich Apel, CC BY-SA 3.0): the strokes of each kanji, in the
  order they are written, as SVG paths in a 109×109 box.
- KANJIDIC2 and KRADFILE (EDRDG, CC BY-SA 4.0): the card of every kanji that is not in the app's own
  kanji.json.gz (the ~10,000 outside the jōyō and jinmeiyō lists), in the same format.

Output: { "strokes": { literal: [path, ...] }, "kanji": { literal: record } }
"""

import argparse
import gzip
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from build_kanji_data import read_kanji

KVG = "{http://kanjivg.tagaini.net}"
NUMBER = re.compile(r"-?\d+\.\d+")


def is_kanji(literal):
    code = ord(literal)
    return 0x3400 <= code <= 0x4DBF or 0x4E00 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF or 0x20000 <= code <= 0x3134F


def read_strokes(path):
    """The stroke paths of each kanji, in writing order, with one decimal (the box is 109 units wide)."""
    strokes = {}
    with gzip.open(path, "rb") as xml:
        for _, element in ET.iterparse(xml, events=("end",)):
            if element.tag != "kanji":
                continue
            match = re.fullmatch(r"kvg:kanji_([0-9a-f]+)", element.get("id", ""))
            if match:
                literal = chr(int(match.group(1), 16))
                if is_kanji(literal):
                    paths = [NUMBER.sub(lambda number: f"{float(number.group()):.1f}".rstrip("0").rstrip("."), stroke.get("d"))
                             for stroke in element.iter("path") if stroke.get("d")]
                    if paths:
                        strokes[literal] = paths
            element.clear()
    return strokes


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kanjidic", type=Path)
    parser.add_argument("kradfile", type=Path)
    parser.add_argument("kanjivg", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    strokes = read_strokes(args.kanjivg)
    rare = read_kanji(args.kanjidic, args.kradfile, lambda grade: grade == 0)
    data = json.dumps({"strokes": dict(sorted(strokes.items())), "kanji": dict(sorted(rare.items()))},
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.GzipFile(args.output, "wb", compresslevel=9, mtime=0) as compressed:
        compressed.write(data)
    print(f"{len(strokes):,} kanji with strokes, {len(rare):,} rare kanji, {len(data):,} bytes raw, "
          f"{args.output.stat().st_size:,} gzip")


if __name__ == "__main__":
    main()
