from __future__ import annotations

import json
import os
import pathlib
import platform
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from endstone.plugin import Plugin


PORT = 18655
RUNTIME = pathlib.Path("/home/container/mumble-runtime")
ROOTFS = RUNTIME / "rootfs"
LAYERS = RUNTIME / "layers"

MUMBLE_REPOSITORY = "mumblevoip/mumble-server"
MUMBLE_TAG = "v1.6.870-acme"
MUMBLE_PLATFORM_MANIFEST = (
    "sha256:9322d72c8ac9f61233dd74ba662194654ff1fc0e5ad6c26967fc708d3d799b82"
)
DOCKER_AUTH_URL = "https://auth.docker.io/token"
DOCKER_REGISTRY = "https://registry-1.docker.io"

# Keep the MCSV host glibc. Only non-glibc runtime libraries are linked from
# the extracted official Mumble image.
GLIBC_PREFIXES = (
    "libc.so",
    "libpthread.so",
    "libm.so",
    "librt.so",
    "libdl.so",
    "libutil.so",
    "libresolv.so",
    "libanl.so",
    "libBrokenLocale.so",
    "libthread_db.so",
    "libnss_",
    "ld-linux-",
)


class MumbleHost(Plugin):
    prefix = "MumbleHost"
    version = "0.2.0"
    api_version = "0.11"
    description = "One-file MCSV Mumble server host with automatic runtime install"
    authors = ["SamSoSleepy"]

    def __init__(self):
        super().__init__()
        self._proc: subprocess.Popen | None = None
        self._stdout = None

    def on_enable(self) -> None:
        self.data_folder.mkdir(parents=True, exist_ok=True)
        threading.Thread(
            target=self._bootstrap_and_start,
            name="MumbleHostStart",
            daemon=True,
        ).start()

    def on_disable(self) -> None:
        process = self._proc
        if process is not None and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=8)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass

        if self._stdout is not None:
            try:
                self._stdout.close()
            except Exception:
                pass
            self._stdout = None

    def _status(self, message: str) -> None:
        (self.data_folder / "host-status.txt").write_text(
            message + "\n",
            encoding="utf-8",
        )

    @staticmethod
    def _fetch_json(
        url: str,
        headers: dict[str, str] | None = None,
    ) -> dict:
        request = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    def _docker_token(self) -> str:
        query = urllib.parse.urlencode(
            {
                "service": "registry.docker.io",
                "scope": f"repository:{MUMBLE_REPOSITORY}:pull",
            }
        )
        payload = self._fetch_json(f"{DOCKER_AUTH_URL}?{query}")
        return payload["token"]

    def _docker_manifest(self, token: str) -> dict:
        request = urllib.request.Request(
            (
                f"{DOCKER_REGISTRY}/v2/{MUMBLE_REPOSITORY}/manifests/"
                f"{MUMBLE_PLATFORM_MANIFEST}"
            ),
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

    def _download_blob(
        self,
        token: str,
        digest: str,
        destination: pathlib.Path,
    ) -> None:
        if destination.exists() and destination.stat().st_size > 0:
            return

        request = urllib.request.Request(
            f"{DOCKER_REGISTRY}/v2/{MUMBLE_REPOSITORY}/blobs/{digest}",
            headers={"Authorization": f"Bearer {token}"},
        )
        temporary = destination.with_suffix(destination.suffix + ".part")

        if temporary.exists():
            temporary.unlink()

        with urllib.request.urlopen(request, timeout=180) as response:
            with open(temporary, "wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)

        temporary.replace(destination)

    def _install_runtime(self) -> None:
        if platform.machine().lower() not in {"x86_64", "amd64"}:
            raise RuntimeError(
                f"unsupported MCSV architecture: {platform.machine()}"
            )

        tar_binary = pathlib.Path("/usr/bin/tar")
        if not tar_binary.exists():
            raise RuntimeError("/usr/bin/tar is required by the MCSV runtime installer")

        RUNTIME.mkdir(parents=True, exist_ok=True)
        LAYERS.mkdir(parents=True, exist_ok=True)

        if ROOTFS.exists():
            shutil.rmtree(ROOTFS)
        ROOTFS.mkdir(parents=True)

        self._status(
            f"stage=installing image={MUMBLE_REPOSITORY}:{MUMBLE_TAG}"
        )
        self.logger.info(
            f"Installing Mumble runtime {MUMBLE_REPOSITORY}:{MUMBLE_TAG}"
        )

        token = self._docker_token()
        manifest = self._docker_manifest(token)
        layers = manifest["layers"]

        for index, layer in enumerate(layers, start=1):
            digest = layer["digest"]
            archive = LAYERS / (digest.replace(":", "_") + ".tar")

            self._status(
                f"stage=downloading layer={index}/{len(layers)}"
            )
            self._download_blob(token, digest, archive)

            self._status(
                f"stage=extracting layer={index}/{len(layers)}"
            )
            subprocess.run(
                [
                    str(tar_binary),
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
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )

        binary = ROOTFS / "usr/bin/mumble-server"
        if not binary.exists():
            raise RuntimeError(
                "automatic runtime install finished but mumble-server was not found"
            )

        self._status("stage=installed")
        self.logger.info("Mumble runtime installation completed")

    def _prepare_compat_libs(
        self,
        root: pathlib.Path,
        runtime: pathlib.Path,
    ) -> pathlib.Path:
        source = root / "usr/lib/x86_64-linux-gnu"
        output = runtime / "compat-libs"

        if output.exists():
            shutil.rmtree(output)
        output.mkdir(parents=True)

        def add_directory(directory: pathlib.Path) -> None:
            if not directory.exists():
                return

            for item in directory.iterdir():
                if not (item.is_file() or item.is_symlink()):
                    continue
                if any(item.name.startswith(prefix) for prefix in GLIBC_PREFIXES):
                    continue

                destination = output / item.name
                try:
                    destination.symlink_to(item)
                except FileExistsError:
                    pass

        add_directory(source)
        add_directory(source / "libproxy")
        return output

    def _bootstrap_and_start(self) -> None:
        try:
            binary = ROOTFS / "usr/bin/mumble-server"
            if not binary.exists():
                self._install_runtime()

            self._start_mumble()
        except Exception as exc:
            self._status(
                f"stage=error error={type(exc).__name__}: {exc}"
            )
            self.logger.error(
                f"Mumble host failed: {type(exc).__name__}: {exc}"
            )

    def _start_mumble(self) -> None:
        runtime = RUNTIME
        root = ROOTFS
        binary = root / "usr/bin/mumble-server"

        if not binary.exists():
            raise RuntimeError("mumble-server runtime is unavailable")

        data = runtime / "data"
        data.mkdir(parents=True, exist_ok=True)
        compat = self._prepare_compat_libs(root, runtime)

        config = data / "mumble-server.ini"
        config.write_text(
            "host=0.0.0.0\n"
            f"port={PORT}\n"
            "users=20\n"
            "database=/home/container/mumble-runtime/data/mumble-server.sqlite\n"
            "welcometext=<b>MCSV Mumble</b><br>Hosted by MCSV<br>"
            "Plugin Mumble connate by SamSoSleepy<br>"
            "Discord : https://discord.gg/FnmWw7nWyq\n"
            "logfile=/home/container/mumble-runtime/data/mumble-server.log\n"
            "pidfile=\n"
            "bonjour=false\n",
            encoding="utf-8",
        )

        libbase = root / "usr/lib/x86_64-linux-gnu"
        env = os.environ.copy()
        env["PATH"] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        env["LANG"] = "C.UTF-8"
        env["LC_ALL"] = "C.UTF-8"
        env["LD_LIBRARY_PATH"] = str(compat)

        qt_plugins = libbase / "qt6/plugins"
        if qt_plugins.exists():
            env["QT_PLUGIN_PATH"] = str(qt_plugins)

        openssl_modules = libbase / "ossl-modules"
        if openssl_modules.exists():
            env["OPENSSL_MODULES"] = str(openssl_modules)

        self._stdout = open(data / "mumble-stdout.log", "ab", buffering=0)

        self._status(f"stage=starting port={PORT} compat_glibc=host")
        self._proc = subprocess.Popen(
            [
                str(binary),
                "--foreground",
                "--ini",
                str(config),
            ],
            cwd=data,
            env=env,
            stdout=self._stdout,
            stderr=subprocess.STDOUT,
        )

        time.sleep(5)
        return_code = self._proc.poll()
        if return_code is not None:
            tail = (data / "mumble-stdout.log").read_text(
                encoding="utf-8",
                errors="replace",
            )[-4000:]
            raise RuntimeError(
                f"mumble exited rc={return_code}: {tail}"
            )

        self._status(
            f"stage=running pid={self._proc.pid} port={PORT}"
        )
        self.logger.info(
            f"Mumble server running on 0.0.0.0:{PORT}"
        )
