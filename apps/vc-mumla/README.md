# VC Mumla client

แอป VoiceChat สำหรับผู้เล่นที่เชื่อมต่อ Mumble บน MCSV.

- APK: [VC-Mumla-v0.5-aec-debug.apk](apk/VC-Mumla-v0.5-aec-debug.apk)
- Complete patched client source: [source/](source/)
- VC customization: [scripts/patch-mumla-vc-client.py](scripts/patch-mumla-vc-client.py)
- Origin and pinned revisions: [PROVENANCE.json](PROVENANCE.json)

The published APK is copied unchanged. Keep upstream licenses alongside the source.

## Build

Use Java 21, Android SDK 36 and NDK 25.1.8937393.

~~~sh
cd apps/vc-mumla/source/libraries/humla/libs/humla-spongycastle
chmod +x ../../gradlew
../../gradlew jar --no-daemon
cd ../../../../..
chmod +x gradlew
./gradlew :app:assembleBetaDebug --stacktrace --no-daemon
~~~

## Patch tests

~~~sh
cd apps/vc-mumla
python3 tests/test_patch_mumla_vc_client.py
~~~

APK verification: run sha256sum -c SHA256SUMS.txt in apk/.
