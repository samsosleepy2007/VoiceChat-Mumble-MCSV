#!/usr/bin/env python3
"""Install the exact Mumble Linux runtime tested on MCSV.

Uses only the Python standard library plus /usr/bin/tar that is already
available inside the MCSV Endstone container.
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import urllib.parse
import urllib.request


REPOSITORY = "mumblevoip/mumble-server"
TAG = "v1.6.870-acme"
PLATFORM_MANIFEST = (
    "sha256:9322d72c8ac9f61233dd74ba662194654ff1fc0e5ad6c26967fc708d3d799b82"
)
RUNTIME = pathlib.Path("/home/container/mumble-runtime")
ROOTFS = RUNTIME / "rootfs"
LAYERS = RUNTIME / "layers"

AUTH_URL = "https://auth.docker.io/token"
REGISTRY = "https://registry-1.docker.io"


def fetch_json(url: str, headers: dict[str, str] | None = None) -> dict:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def get_token() -> str:
    query = urllib.parse.urlencode(
        {
            "service": "registry.docker.io",
            "scope": f"repository:{REPOSITORY}:pull",
        }
    )
    payload = fetch_json(f"{AUTH_URL}?{query}")
    return payload["token"]


def get_manifest(token: str) -> dict:
    request = urllib.request.Request(
        f"{REGISTRY}/v2/{REPOSITORY}/manifests/{PLATFORM_MANIFEST}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": (
                "application/vnd.oci.image.manifest.v1+json,"
                "application/vnd.docker.distribution.manifest.v2+json"
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def download_blob(token: str, digest: str, destination: pathlib.Path) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        return

    request = urllib.request.Request(
        f"{REGISTRY}/v2/{REPOSITORY}/blobs/{digest}",
        headers={"Authorization": f"Bearer {token}"},
    )
    temporary = destination.with_suffix(destination.suffix + ".part")

    with urllib.request.urlopen(request, timeout=180) as response:
        with open(temporary, "wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)

    temporary.replace(destination)


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    LAYERS.mkdir(parents=True, exist_ok=True)

    if ROOTFS.exists():
        shutil.rmtree(ROOTFS)
    ROOTFS.mkdir(parents=True)

    print(f"Installing {REPOSITORY}:{TAG}")
    print(f"Pinned linux/amd64 manifest: {PLATFORM_MANIFEST}")

    token = get_token()
    manifest = get_manifest(token)
    layers = manifest["layers"]

    for index, layer in enumerate(layers, start=1):
        digest = layer["digest"]
        filename = digest.replace(":", "_") + ".tar"
        archive = LAYERS / filename

        print(f"[{index}/{len(layers)}] download {digest}")
        download_blob(token, digest, archive)

        print(f"[{index}/{len(layers)}] extract")
        subprocess.run(
            [
                "/usr/bin/tar",
                "-xzf",
                str(archive),
                "-C",
                str(ROOTFS),
                "--warning=no-unknown-keyword",
            ],
            check=True,
            env={
                "PATH": "/usr/bin:/bin",
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
            },
        )

    binary = ROOTFS / "usr/bin/mumble-server"
    if not binary.exists():
        raise SystemExit("install failed: usr/bin/mumble-server was not found")

    print(f"Runtime ready: {binary}")
    print("Next: build/upload the Endstone MumbleHost wheel and restart MCSV.")


if __name__ == "__main__":
    main()
