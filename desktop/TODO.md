# Desktop Release TODO

## macOS
- Configure Apple notarization credentials so builds are notarized (current builds are signed but not notarized).
- Consider switching release signing identity from Apple Development to Apple Distribution for public release builds.

## Windows
- Configure production Authenticode signing certificate to avoid SmartScreen reputation warnings on fresh installs.
- Decide if installer should be per-machine (`perMachine: true`) for enterprise deployment.
