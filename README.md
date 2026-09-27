# VoiceChat-Mumble-MCSV

**One-file Endstone plugin** for hosting a Mumble Server directly inside an MCSV server.

Upload the wheel to `/plugins`, restart MCSV, and the plugin does the rest.

It contains the MCSV-side custom Mumble hosting and Minecraft proximity routing core. VC Mumla, the Item Mic add-on, and the VC Mumble Endstone bridge remain separate components.

## One-file install

1. Download the latest `endstone_mumble_host-*.whl` from GitHub Releases.
2. Upload the wheel to MCSV's `/plugins` directory.
3. Restart the MCSV server.
4. On first start, the plugin automatically downloads and extracts the pinned official Mumble runtime.
5. Mumble starts automatically and follows the Endstone server lifecycle.

No separate runtime installer is required.

The first-start status is written to:

```text
/plugins/mumble_host/host-status.txt
```

Possible states include:

```text
stage=installing
stage=downloading layer=1/13
stage=extracting layer=1/13
stage=starting port=18655 compat_glibc=host
stage=running pid=<pid> port=18655
```

## Verified setup

Tested on MCSV with:

- Linux x86_64
- host glibc 2.41
- Endstone 0.11.12
- Mumble Server 1.6.870
- official image `mumblevoip/mumble-server:v1.6.870-acme`
- same allocated port exposed for TCP and UDP
- external public TCP connectivity verified

The current MCSV deployment uses:

```text
sv7.mcsv.me:18655
```

## Runtime installation

The plugin downloads the pinned official Linux/amd64 Mumble image from Docker Hub only when:

```text
/home/container/mumble-runtime/rootfs/usr/bin/mumble-server
```

does not exist.

Pinned image:

```text
mumblevoip/mumble-server:v1.6.870-acme
linux/amd64 manifest:
sha256:9322d72c8ac9f61233dd74ba662194654ff1fc0e5ad6c26967fc708d3d799b82
```

Downloaded layers are cached in:

```text
/home/container/mumble-runtime/layers
```

After the first successful installation, normal MCSV restarts reuse the existing runtime and start Mumble immediately.

## Why the compatibility library layer exists

MCSV's Endstone environment can spawn child processes, but its Python `PATH` is restricted.

The Mumble runtime is therefore launched by absolute path. Mumble uses the **MCSV host glibc**, while Qt/OpenSSL/Protobuf/Ice/libproxy libraries come from the pinned official Mumble image.

This avoids the `GLIBC_PRIVATE` symbol conflict that occurs if the image libc is mixed with MCSV's dynamic loader.

## Current Mumble configuration

- bind: `0.0.0.0`
- port: `18655`
- maximum users: `20`
- password: none
- Bonjour: disabled
- SQLite database: `/home/container/mumble-runtime/data/mumble-server.sqlite`

Welcome text:

```text
Hosted by MCSV
Plugin Mumble connate by SamSoSleepy
Discord : https://discord.gg/FnmWw7nWyq
```

## Repository layout

- `src/endstone_mumble_host/plugin.py` — complete one-file bootstrap + Mumble lifecycle
- `tools/install_runtime.py` — optional manual repair/debug installer
- `.github/workflows/build-wheel.yml` — wheel CI

## Important

Port `18655` is an allocated port of the MCSV server used for this project. Another MCSV server must use one of its own allocated ports.

This repository hosts the custom VC proximity-enabled Mumble server on MCSV. Minecraft position/range state is supplied by the VC Mumble Endstone bridge, and distance gain is consumed by the custom VC Mumla client.
