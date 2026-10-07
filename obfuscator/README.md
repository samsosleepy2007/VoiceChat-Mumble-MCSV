# Protected distributions

Build: `npm ci --prefix tools/obfuscation --ignore-scripts` then `python tools/build_obfuscated.py`.

- addon/: complete BP/RP addon; JavaScript identifiers are mangled by pinned Terser 5.44.0. Compression/unsafe optimizations/property mangling/source maps are disabled. No runtime decoder or watchdog-heavy control-flow transformations.
- plugin/: portable Python wheel, with local variable renaming in simple scopes and AST reformatting. Public class/method/parameter/import/attribute names, metadata, configuration and native voice binary remain intact. Complex/reflection-sensitive scopes are unchanged.
- SHA256SUMS.txt: checksums of the two distribution files. `main.protected.js` is a diagnostic protected script, not the readable source or a source map.

This is lightweight obfuscation, not encryption or anti-tamper protection. Python code remains recoverable. Assets, protocol strings and identifiers remain visible as required by the game. Do not store secrets in either package.

Tests cover transformed touchpad logic, Python bridge behavior and distribution integrity. Real Endstone/MCSV runtime and Android-client testing is still required before replacing public release assets. Public website installer continues using the existing approved artifacts.
