from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import threading
import time

from endstone.plugin import Plugin


PORT = 18655
RUNTIME = pathlib.Path("/home/container/mumble-runtime")

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
    version = "0.1.1"
    api_version = "0.11"
    description = "MCSV-hosted Mumble server"
    authors = ["SamSoSleepy"]

    def __init__(self):
        super().__init__()
        self._proc: subprocess.Popen | None = None
        self._stdout = None

    def on_enable(self) -> None:
        self.data_folder.mkdir(parents=True, exist_ok=True)
        threading.Thread(
            target=self._start,
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

    def _start(self) -> None:
        try:
            runtime = RUNTIME
            root = runtime / "rootfs"
            binary = root / "usr/bin/mumble-server"

            if not binary.exists():
                raise RuntimeError(
                    "mumble-server runtime missing; run tools/install_runtime.py first"
                )

            data = runtime / "data"
            data.mkdir(parents=True, exist_ok=True)
            compat = self._prepare_compat_libs(root, runtime)

            config = data / "mumble-server.ini"
            config.write_text(
                "host=0.0.0.0\n"
                f"port={PORT}\n"
                "users=20\n"
                "database=/home/container/mumble-runtime/data/mumble-server.sqlite\n"
                "welcometext=<b>MCSV Mumble</b><br>Hosted by VC Mumble Server\n"
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
        except Exception as exc:
            self._status(
                f"stage=error error={type(exc).__name__}: {exc}"
            )
            self.logger.error(
                f"Mumble host failed: {type(exc).__name__}: {exc}"
            )
