"""Build the protected plugin wheel: text obfuscation, then Cython to native .so, then strip.

Run with the target runtime's Python (MCSV uses CPython 3.12 on Linux x86_64):
    /tmp/.../cyenv/bin/python tools/build_plugin_wheel.py
It emits obfuscator/plugin/endstone_mumble_host-<ver>-cp312-cp312-manylinux_2_28_x86_64.whl.
The compiled modules carry no Python source and no eval/exec of plaintext; __init__ stays a tiny
shim so Endstone can still import the entry point endstone_mumble_host:MumbleHost.
"""
import base64, csv, hashlib, io, subprocess, sys, sysconfig, tempfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from plugin_protection import protect

VERSION = (ROOT / "pyproject.toml").read_text().split('version = "', 1)[1].split('"', 1)[0]
DIST = f"endstone_mumble_host-{VERSION}.dist-info"
PACKAGE = "endstone_mumble_host"
# glibc requirement of our code is ~2.4, so manylinux_2_28 is safe and Endstone accepts it on 3.12.
TAG = "cp312-cp312-manylinux_2_28_x86_64"
WHEEL = ROOT / "obfuscator" / "plugin" / f"endstone_mumble_host-{VERSION}-{TAG}.whl"


def compile_module(src_py: str, module: str, workdir: Path) -> bytes:
    # Layer 1: the existing string-pool / local-rename obfuscation (still valid Python).
    obfuscated = protect(src_py, module + ".py")
    source = workdir / (module.replace(".", "_") + ".py")
    source.write_bytes(obfuscated)
    c_file = source.with_suffix(".c")
    subprocess.run(
        ["cython", "-3", "--module-name", f"{PACKAGE}.{module}", str(source), "-o", str(c_file)],
        check=True, cwd=workdir,
    )
    so_file = workdir / (module + ".so")
    include = sysconfig.get_path("include")
    subprocess.run(
        ["gcc", "-shared", "-fPIC", "-O2", "-fvisibility=hidden",
         f"-I{include}", str(c_file), "-o", str(so_file)],
        check=True, cwd=workdir,
    )
    subprocess.run(["strip", "--strip-all", str(so_file)], check=True)
    return so_file.read_bytes()


def main() -> None:
    if sys.version_info[:2] != (3, 12):
        raise SystemExit(f"build with Python 3.12 (server ABI); got {sys.version.split()[0]}")
    files: dict[str, bytes] = {}
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        for path in sorted((ROOT / "src" / PACKAGE).rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            rel = path.relative_to(ROOT / "src").as_posix()
            if path.suffix != ".py":
                files[rel] = path.read_bytes()            # bin/mumble-server-vc and other data
            elif path.name == "__init__.py":
                files[rel] = path.read_bytes()            # tiny shim, imported by Endstone
            else:
                module = path.stem
                files[f"{PACKAGE}/{module}.so"] = compile_module(path.read_text(), module, workdir)

    files[f"{DIST}/METADATA"] = (
        f"Metadata-Version: 2.1\nName: endstone-mumble-host\nVersion: {VERSION}\n"
        "Requires-Python: >=3.12,<3.13\nRequires-Dist: endstone>=0.11.0\n"
    ).encode()
    files[f"{DIST}/WHEEL"] = (
        f"Wheel-Version: 1.0\nGenerator: sleepy-protected\nRoot-Is-Purelib: false\nTag: {TAG}\n"
    ).encode()
    files[f"{DIST}/entry_points.txt"] = b"[endstone]\nmumble_host = endstone_mumble_host:MumbleHost\n"
    for path in ROOT.glob("LICENSE*"):
        files[f"{DIST}/licenses/{path.name}"] = path.read_bytes()

    record = io.StringIO()
    writer = csv.writer(record, lineterminator="\n")
    for name, data in files.items():
        writer.writerow([name, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("="), len(data)])
    writer.writerow([f"{DIST}/RECORD", "", ""])
    files[f"{DIST}/RECORD"] = record.getvalue().encode()

    WHEEL.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(WHEEL, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    blob = WHEEL.read_bytes()
    print(WHEEL.name)
    print("size", len(blob), "sha256", hashlib.sha256(blob).hexdigest())


if __name__ == "__main__":
    main()
