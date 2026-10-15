"""Builds an optional JMdict dictionary for one gloss language (e.g. French, German).

    python scripts/build_jmdict_language.py ger jmdict-de.json.gz
    python scripts/build_jmdict_language.py fre jmdict-fr.json.gz --source JMdict.gz

The full JMdict carries glosses in several languages, but only the English
senses list parts of speech. Each entry keeps the senses of the requested
language and borrows the English parts of speech for its first sense, so the
app can still tell verbs and adjectives apart when it deconjugates a lookup.
The output uses the same compact format as src/data/jmdict-en.json.gz.
"""

import argparse
import gzip
import io
import json
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SOURCE_URL = "http://ftp.edrdg.org/pub/Nihongo/JMdict.gz"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


def child_text(element, name):
    child = element.find(name)
    return child.text if child is not None and child.text else None


def unique(items):
    return list(dict.fromkeys(item for item in items if item))


def download(path):
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "EReader-JMdict-updater"})
    with urllib.request.urlopen(request, timeout=120) as response, path.open("wb") as archive:
        while chunk := response.read(1024 * 1024):
            archive.write(chunk)


def build(source, language, output_path):
    count = 0
    temp_path = output_path.with_name(f"{output_path.name}.tmp")
    try:
        with temp_path.open("wb") as compressed_file:
            with gzip.GzipFile(fileobj=compressed_file, mode="wb", compresslevel=9, mtime=0) as compressed:
                with io.TextIOWrapper(compressed, encoding="utf-8", newline="\n") as output:
                    output.write("[")
                    with gzip.open(source, "rb") as xml:
                        for _, element in ET.iterparse(xml, events=("end",)):
                            if element.tag != "entry":
                                continue

                            entry_id = child_text(element, "ent_seq")
                            kanji = [text for item in element.findall("k_ele") if (text := child_text(item, "keb"))]
                            kana = [text for item in element.findall("r_ele") if (text := child_text(item, "reb"))]
                            english_pos = []
                            senses = []
                            for sense in element.findall("sense"):
                                glosses = sense.findall("gloss")
                                if any(gloss.get(XML_LANG, "eng") == "eng" for gloss in glosses):
                                    english_pos.extend(pos.text for pos in sense.findall("pos") if pos.text)
                                texts = [
                                    gloss.text for gloss in glosses
                                    if gloss.text and gloss.get(XML_LANG, "eng") == language
                                ]
                                if texts:
                                    senses.append({"p": [], "g": texts})

                            if entry_id and senses:
                                senses[0]["p"] = unique(english_pos)
                                item = {"id": entry_id, "k": kanji, "r": kana, "s": senses}
                                if count:
                                    output.write(",")
                                json.dump(item, output, ensure_ascii=False, separators=(",", ":"))
                                count += 1
                            element.clear()
                    output.write("]\n")
        temp_path.replace(output_path)
    finally:
        temp_path.unlink(missing_ok=True)
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("language", help="JMdict gloss language code: fre, ger, spa, rus, dut, hun, swe, slv")
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", type=Path, help="local JMdict.gz (downloaded when omitted)")
    args = parser.parse_args()

    if args.source:
        count = build(args.source, args.language, args.output)
    else:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "JMdict.gz"
            download(source)
            count = build(source, args.language, args.output)
    print(f"Wrote {count:,} {args.language} entries to {args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
