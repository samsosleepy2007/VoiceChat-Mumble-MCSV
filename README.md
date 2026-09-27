# VoiceChat-Mumble-MCSV

Mumble Server host for **MCSV Endstone servers**.

This repository intentionally contains only the MCSV-side Mumble hosting component. It does **not** contain the Android VC Mumla client, Minecraft proximity bridge, Item Mic addon, or VC Mumble Server APK.

## Verified setup

Tested successfully on 2026-09-27 with:

- MCSV / Pelican Endstone container
- Linux x86_64
- host glibc 2.41
- Endstone 0.11.12
- Mumble Server 1.6.870
- official image: `mumblevoip/mumble-server:v1.6.870-acme`
- public MCSV allocation: TCP + UDP on the same allocated port
- verified public TCP access from external probes

The live test used port `18655` and was reachable as:

```text
sv7.mcsv.me:18655
```

The hostname and allocated port will be different on other MCSV servers.

## How it works

```text
MCSV container
├─ Minecraft Bedrock + Endstone
└─ MumbleHost Endstone plugin
   └─ mumble-server child process
      ├─ TCP <allocated-port>
      └─ UDP <allocated-port>
```

MCSV's Endstone Python environment can spawn child processes, but its `PATH` is restricted. The host plugin therefore launches the Mumble binary by absolute path.

The runtime is extracted from the official Mumble container image into:

```text
/home/container/mumble-runtime
```

Mumble is started with the **host glibc** while Qt/OpenSSL/Protobuf/Ice/libproxy libraries are supplied from the extracted Mumble image. This avoids the `GLIBC_PRIVATE` symbol conflict that occurs when the image libc is mixed with MCSV's dynamic loader.

## Repository layout

- `src/endstone_mumble_host/plugin.py` — starts/stops Mumble with the Endstone server lifecycle
- `tools/install_runtime.py` — installs the pinned Mumble runtime from Docker Hub
- `pyproject.toml` — builds the Endstone wheel
- `.github/workflows/build-wheel.yml` — CI wheel build

## Install on MCSV

### 1. Pick an allocated MCSV port

Use one of the extra ports assigned to the MCSV server. Mumble needs the **same port for TCP and UDP**.

The tested source defaults to:

```text
18655
```

If your allocation is different, change `PORT` in:

```text
src/endstone_mumble_host/plugin.py
```

### 2. Prepare the Mumble runtime

Run:

```bash
python3 tools/install_runtime.py
```

The installer downloads and extracts the pinned official Mumble image:

```text
mumblevoip/mumble-server:v1.6.870-acme
linux/amd64 manifest:
sha256:9322d72c8ac9f61233dd74ba662194654ff1fc0e5ad6c26967fc708d3d799b82
```

### 3. Build the Endstone wheel

```bash
python3 -m pip install build
python3 -m build --wheel
```

Upload the generated `.whl` from `dist/` into MCSV's:

```text
/plugins
```

Then restart the MCSV server.

### 4. Check status

The plugin writes:

```text
/plugins/mumble_host/host-status.txt
```

Expected output:

```text
stage=running pid=<pid> port=18655
```

Mumble logs are stored in:

```text
/home/container/mumble-runtime/data/
```

## Mumble configuration

The current tested configuration is generated automatically with:

- bind address: `0.0.0.0`
- users: `20`
- password: none
- Bonjour: disabled
- SQLite database stored under `/home/container/mumble-runtime/data`

The welcome text is:

```text
Hosted by MCSV
Plugin Mumble connate by SamSoSleepy
Discord : https://discord.gg/FnmWw7nWyq
```

## Important

This repository only hosts a normal Mumble server on MCSV. Minecraft proximity routing is a separate component and is not implemented here.
