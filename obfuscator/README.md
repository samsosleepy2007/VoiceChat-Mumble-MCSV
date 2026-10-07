# Protected distributions

Build: `npm ci --prefix tools/obfuscation --ignore-scripts` then `python tools/build_obfuscated.py`.

- addon/: complete BP/RP addon; JavaScript identifiers are mangled by pinned Terser 5.44.0. Compression/unsafe optimizations/property mangling/source maps are disabled. No runtime decoder or watchdog-heavy control-flow transformations.
- plugin/: portable Python wheel, with cautious local variable renaming, an encoded literal pool decoded once at import, compressed/masked module payloads and an import-time checksum. The mask is embedded in the artifact, so this is obfuscation rather than secret-key encryption. No marshal bytecode or external protection runtime is used. Public class/method/parameter/import/attribute names, metadata, configuration and native voice binary remain intact. Complex/reflection-sensitive scopes are unchanged.
- SHA256SUMS.txt: checksums of the two distribution files. `main.protected.js` is a diagnostic protected script, not the readable source or a source map.

This is lightweight obfuscation, not encryption or anti-tamper protection. Python code remains recoverable. Assets, protocol strings and identifiers remain visible as required by the game. Do not store secrets in either package.

Tests cover transformed touchpad logic, Python bridge behavior and distribution integrity. Real Endstone/MCSV runtime and Android-client testing is still required before replacing public release assets. Public website installer continues using the existing approved artifacts.

Plugin verification: `python3 tests/test_protected_plugin.py` imports every module from the actual wheel, compares framework signatures and annotations with source, exercises phone voice routing and listener callbacks, and validates entry points and every RECORD hash. These checks use an Endstone stub; they do not prove real server/native voice runtime behavior. The checksum detects corruption, not a determined attacker. The wheel still contains the required native voice executable unchanged.

Readable development sources remain in this public repository. Obfuscation of the wheel cannot restrict access to those public sources. For commercial source confidentiality, keep development sources in a private repository and distribute only approved protected artifacts, preserving all upstream licenses.
