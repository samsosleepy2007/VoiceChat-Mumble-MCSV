"""Build the checked-in BP/RP sources into an importable Minecraft addon."""
from pathlib import Path
import io
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build():
    source = ROOT / "addon"
    version = ".".join(map(str, json.loads((source / "BP/manifest.json").read_text())["header"]["version"]))
    output = ROOT / "release-assets" / f"VC_Mumble_ItemMic_v{version}_MicFix.mcaddon"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as addon:
        for pack in ("BP", "RP"):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                for path in sorted((source / pack).rglob("*")):
                    if path.is_file():
                        if path.suffix == ".json":
                            json.loads(path.read_text())
                        entry = zipfile.ZipInfo(path.relative_to(source / pack).as_posix())
                        entry.compress_type = zipfile.ZIP_DEFLATED
                        archive.writestr(entry, path.read_bytes())
            addon.writestr(f"VC_Mumble_ItemMic_{pack}_v{version}.mcpack", buffer.getvalue())
    print(output)


if __name__ == "__main__":
    build()
