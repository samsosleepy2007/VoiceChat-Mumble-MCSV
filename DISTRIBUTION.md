# Development and installation

- Maintain readable sources in `addon/` and `src/endstone_mumble_host/` on `main`.
- Use `obfuscator/addon/*.mcaddon` and `obfuscator/plugin/*.whl` as installation and distribution packages.
- Do not edit generated files directly. The protected-build workflow regenerates and tests them after source changes, then saves outputs and SHA256 checksums on the same branch.
- Verify with `cd obfuscator && sha256sum --check SHA256SUMS.txt` before installation.
- Keep readable packages available for development when requested; label them separately from protected installers in releases.

See [protected build instructions](obfuscator/README.md).
