import io
import gzip
import json
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


SOURCE_URL = "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "src" / "data" / "jmdict-en.json.gz"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


def child_text(element, name):
    child = element.find(name)
    return child.text if child is not None and child.text else None


def main():
    with tempfile.TemporaryDirectory() as temporary_directory:
        archive_path = Path(temporary_directory) / "jmdict-en.gz"
        request = urllib.request.Request(
            SOURCE_URL, headers={"User-Agent": "Yomisuba-JMdict-updater"}
        )
        with urllib.request.urlopen(request, timeout=60) as response, archive_path.open("wb") as archive:
            while chunk := response.read(1024 * 1024):
                archive.write(chunk)

        output_temp_path = OUTPUT_PATH.with_name(f"{OUTPUT_PATH.name}.tmp")
        try:
            count = 0
            with output_temp_path.open("wb") as compressed_file:
                with gzip.GzipFile(
                    fileobj=compressed_file, mode="wb", compresslevel=9, mtime=0
                ) as compressed:
                    with io.TextIOWrapper(compressed, encoding="utf-8", newline="\n") as output:
                        output.write("[")
                        with gzip.open(archive_path, "rb") as xml:
                            for _, element in ET.iterparse(xml, events=("end",)):
                                if element.tag != "entry":
                                    continue

                                entry_id = child_text(element, "ent_seq")
                                kanji = [
                                    text
                                    for item in element.findall("k_ele")
                                    if (text := child_text(item, "keb"))
                                ]
                                kana = [
                                    text
                                    for item in element.findall("r_ele")
                                    if (text := child_text(item, "reb"))
                                ]
                                senses = []
                                for sense in element.findall("sense"):
                                    glosses = [
                                        gloss.text
                                        for gloss in sense.findall("gloss")
                                        if gloss.text
                                        and gloss.get(XML_LANG, "eng") in ("eng", "en")
                                    ]
                                    if glosses:
                                        senses.append(
                                            {
                                                "p": [
                                                    pos.text
                                                    for pos in sense.findall("pos")
                                                    if pos.text
                                                ],
                                                "g": glosses,
                                            }
                                        )

                                if entry_id and senses:
                                    item = {"id": entry_id, "k": kanji, "r": kana, "s": senses}
                                    if count:
                                        output.write(",")
                                    json.dump(
                                        item,
                                        output,
                                        ensure_ascii=False,
                                        separators=(",", ":"),
                                    )
                                    count += 1
                                element.clear()

                        output.write("]\n")
            output_temp_path.replace(OUTPUT_PATH)
        finally:
            output_temp_path.unlink(missing_ok=True)

    print(f"Wrote {count:,} English entries to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
