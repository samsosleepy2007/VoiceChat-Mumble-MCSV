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
from importlib import resources
from typing import Any

from endstone import ColorFormat

RUNTIME = pathlib.Path("/home/container/mumble-runtime")
ROOTFS = RUNTIME / "rootfs"
LAYERS = RUNTIME / "layers"
CUSTOM_DIR = RUNTIME / "custom"
CUSTOM_BINARY = CUSTOM_DIR / "mumble-server-vc"

MUMBLE_REPOSITORY = "mumblevoip/mumble-server"
MUMBLE_TAG = "v1.6.870-acme"
MUMBLE_PLATFORM_MANIFEST = (
    "sha256:9322d72c8ac9f61233dd74ba662194654ff1fc0e5ad6c26967fc708d3d799b82"
)
DOCKER_AUTH_URL = "https://auth.docker.io/token"
DOCKER_REGISTRY = "https://registry-1.docker.io"

GLIBC_PREFIXES = (
    "libc.so", "libpthread.so", "libm.so", "librt.so", "libdl.so",
    "libutil.so", "libresolv.so", "libanl.so", "libBrokenLocale.so",
    "libthread_db.so", "libnss_", "ld-linux-",
)


class MumbleRuntimeHost:
    def __init__(
        self,
        logger: Any,
        data_folder: pathlib.Path,
        *,
        port: int = 18655,
        users: int = 20,
    ) -> None:
        self._logger = logger
        self._data_folder = pathlib.Path(data_folder)
        self._port = int(port)
        self._users = int(users)
        self._proc: subprocess.Popen | None = None
        self._stdout = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._stage = "offline"
        self._last_error = ""
        self._pid = 0

    @property
    def port(self) -> int:
        return self._port

    @property
    def pid(self) -> int:
        with self._lock:
            return self._pid

    @property
    def running(self) -> bool:
        process = self._proc
        return process is not None and process.poll() is None

    def status_line(self) -> str:
        with self._lock:
            if self._stage == "running":
                return f"running • port {self._port} • pid {self._pid}"
            if self._stage == "error":
                return f"error • {self._last_error}"
            return self._stage

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._bootstrap_and_monitor,
            name="MumbleHostRuntime",
            daemon=True,
        )
        self._thread.start()

    def restart(self) -> None:
        self.stop()
        self.start()

    def stop(self) -> None:
        self._stop.set()
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
        self._proc = None

        if self._stdout is not None:
            try:
                self._stdout.close()
            except Exception:
                pass
            self._stdout = None

        thread = self._thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=3)
        self._thread = None
        self._set_status("offline")

    def _status_file(self, message: str) -> None:
        try:
            self._data_folder.mkdir(parents=True, exist_ok=True)
            (self._data_folder / "host-status.txt").write_text(
                message + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass

    def _set_status(self, stage: str, error: str = "", pid: int = 0) -> None:
        with self._lock:
            self._stage = stage
            self._last_error = error
            self._pid = int(pid)
        text = f"stage={stage} port={self._port}"
        if pid:
            text += f" pid={pid}"
        if error:
            text += f" error={error}"
        self._status_file(text)

    @staticmethod
    def _fetch_json(url: str, headers: dict[str, str] | None = None) -> dict:
        request = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    def _docker_token(self) -> str:
        query = urllib.parse.urlencode({
            "service": "registry.docker.io",
            "scope": f"repository:{MUMBLE_REPOSITORY}:pull",
        })
        payload = self._fetch_json(f"{DOCKER_AUTH_URL}?{query}")
        return str(payload["token"])

    def _docker_manifest(self, token: str) -> dict:
        request = urllib.request.Request(
            f"{DOCKER_REGISTRY}/v2/{MUMBLE_REPOSITORY}/manifests/{MUMBLE_PLATFORM_MANIFEST}",
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

    def _download_blob(self, token: str, digest: str, destination: pathlib.Path) -> None:
        if destination.exists() and destination.stat().st_size > 0:
            return
        request = urllib.request.Request(
            f"{DOCKER_REGISTRY}/v2/{MUMBLE_REPOSITORY}/blobs/{digest}",
            headers={"Authorization": f"Bearer {token}"},
        )
        temporary = destination.with_suffix(destination.suffix + ".part")
        temporary.unlink(missing_ok=True)
        with urllib.request.urlopen(request, timeout=180) as response:
            with open(temporary, "wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
        temporary.replace(destination)

    def _install_runtime(self) -> None:
        if platform.machine().lower() not in {"x86_64", "amd64"}:
            raise RuntimeError(f"unsupported MCSV architecture: {platform.machine()}")
        tar_binary = pathlib.Path("/usr/bin/tar")
        if not tar_binary.exists():
            raise RuntimeError("/usr/bin/tar is required")

        RUNTIME.mkdir(parents=True, exist_ok=True)
        LAYERS.mkdir(parents=True, exist_ok=True)
        if ROOTFS.exists():
            shutil.rmtree(ROOTFS)
        ROOTFS.mkdir(parents=True)

        self._set_status("installing")
        token = self._docker_token()
        layers = self._docker_manifest(token)["layers"]

        for index, layer in enumerate(layers, start=1):
            if self._stop.is_set():
                raise RuntimeError("host start cancelled")
            digest = str(layer["digest"])
            archive = LAYERS / (digest.replace(":", "_") + ".tar")
            self._set_status(f"downloading-{index}-{len(layers)}")
            self._download_blob(token, digest, archive)
            self._set_status(f"extracting-{index}-{len(layers)}")
            subprocess.run(
                [
                    str(tar_binary), "-xzf", str(archive), "-C", str(ROOTFS),
                    "--warning=no-unknown-keyword",
                ],
                check=True,
                env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )

        if not (ROOTFS / "usr/bin/mumble-server").exists():
            raise RuntimeError("runtime install finished but mumble-server was not found")
        self._set_status("installed")

    @staticmethod
    def _prepare_compat_libs(root: pathlib.Path, runtime: pathlib.Path) -> pathlib.Path:
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

    @staticmethod
    def _install_custom_binary() -> pathlib.Path:
        package_binary = resources.files("endstone_mumble_host").joinpath(
            "bin/mumble-server-vc"
        )
        if not package_binary.is_file():
            raise RuntimeError("VC proximity Mumble binary is missing from wheel")
        CUSTOM_DIR.mkdir(parents=True, exist_ok=True)
        temporary = CUSTOM_BINARY.with_suffix(".tmp")
        with resources.as_file(package_binary) as source:
            shutil.copyfile(source, temporary)
        temporary.chmod(0o755)
        temporary.replace(CUSTOM_BINARY)
        return CUSTOM_BINARY

    def _start_mumble(self, binary: pathlib.Path) -> None:
        data = RUNTIME / "data"
        data.mkdir(parents=True, exist_ok=True)
        compat = self._prepare_compat_libs(ROOTFS, RUNTIME)

        config = data / "mumble-server.ini"
        config.write_text(
            "host=0.0.0.0\n"
            f"port={self._port}\n"
            f"users={self._users}\n"
            "database=/home/container/mumble-runtime/data/mumble-server.sqlite\n"
            "welcometext=Hosted by MCSV<br>Plugin Mumble connate by SamSoSleepy<br>Discord : https://discord.gg/FnmWw7nWyq\n"
            "logfile=/home/container/mumble-runtime/data/mumble-server.log\n"
            "pidfile=\n"
            "bonjour=false\n",
            encoding="utf-8",
        )

        libbase = ROOTFS / "usr/lib/x86_64-linux-gnu"
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
        self._set_status("starting")
        self._proc = subprocess.Popen(
            [str(binary), "--foreground", "--ini", str(config)],
            cwd=data,
            env=env,
            stdout=self._stdout,
            stderr=subprocess.STDOUT,
        )

        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            if self._stop.is_set():
                raise RuntimeError("host start cancelled")
            rc = self._proc.poll()
            if rc is not None:
                tail = (data / "mumble-stdout.log").read_text(
                    encoding="utf-8", errors="replace"
                )[-4000:]
                raise RuntimeError(f"mumble exited rc={rc}: {tail}")
            time.sleep(0.25)

        self._set_status("running", pid=self._proc.pid)
        self._logger.info(
            f"{ColorFormat.GREEN}✔ เซิร์ฟเวอร์เสียง Mumble ทำงานแล้ว{ColorFormat.RESET} "
            f"{ColorFormat.GRAY}— 0.0.0.0:{self._port}{ColorFormat.RESET}"
        )

    def _bootstrap_and_monitor(self) -> None:
        try:
            if not (ROOTFS / "usr/bin/mumble-server").exists():
                self._install_runtime()
            binary = self._install_custom_binary()
            self._start_mumble(binary)
            while not self._stop.wait(1.0):
                process = self._proc
                if process is None:
                    return
                rc = process.poll()
                if rc is not None:
                    raise RuntimeError(f"mumble process exited unexpectedly rc={rc}")
        except Exception as exc:
            if not self._stop.is_set():
                message = f"{type(exc).__name__}: {exc}"
                self._set_status("error", message)
                self._logger.error(f"Mumble host failed: {message}")
        finally:
            if self._stop.is_set():
                self._set_status("offline")
