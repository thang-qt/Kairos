# Contributing

Kairos is intentionally simple.
The goal is to build a focused AI chat app, not the biggest one.

## Before opening a PR

- keep changes small and focused
- avoid adding heavy dependencies or complexity
- discuss big ideas in an issue first

## What we welcome

- performance improvements
- streaming / chat UX improvements
- bug fixes
- small, clear UI polish
- docs that make setup easier

## What we avoid

- large refactors without clear benefit
- opinionated features that add weight
- anything that hurts simplicity or local-first usage

## PR rules

- one change per PR
- clear title + short description
- screenshots or video for UI changes
- must run locally with zero friction

## Local development

The web frontend, Go server, desktop client, and Android client share this
repository. Changes to shared rendering or server behavior should be checked
against the clients they affect.

For the web app and server, use the default Nix development shell (`nix develop`)
or install Go 1.25, Node.js 22, and pnpm 9.15.4:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Routes live in `src/routes`, frontend code in `src`, and the Go backend in
`internal/server`, with its entrypoint at `cmd/kairosd`. Follow [AGENTS.md](AGENTS.md)
for repository conventions.

Before submitting changes, run:

```sh
pnpm check
pnpm backend:check  # when changing the Go backend
```

## Android builds

Use `nix develop .#android` or an Android SDK 35 installation with build tools
35.0.0, JDK 17, Node.js 22, and pnpm available on PATH. From the repository root:

```sh
pnpm install --frozen-lockfile
cd android
./gradlew assembleDebug testDebugUnitTest lintDebug
```

The build automatically bundles the shared offline transcript. The APK is
`android/app/build/outputs/apk/debug/app-debug.apk`. In restricted environments
where the Kotlin daemon cannot write to the home directory, add
`-Pkotlin.compiler.execution.strategy=in-process`.

### Android CI signing

The CI workflow uploads APKs for pushes to `main` and `android-prototype` and
manual runs. Pull requests run checks without the signing secret or an APK
upload. Manual runs are available once the workflow is on the default branch.

Repository maintainers must configure `ANDROID_DEBUG_KEYSTORE_BASE64` as an
Actions secret so builds use a stable signing certificate. To preserve an
existing installation, use the keystore that signed it:

```sh
base64 -w0 "$HOME/.android/debug.keystore" | gh secret set ANDROID_DEBUG_KEYSTORE_BASE64 --repo thang-qt/Kairos
```

Keep a backup of that keystore and never commit it or its encoded contents. CI
selects it through `KAIROS_DEBUG_KEYSTORE` and verifies the APK certificate before
uploading. Missing signing configuration fails the downloadable build rather
than producing an incompatible update. Local builds use the normal Android
debug key unless `KAIROS_DEBUG_KEYSTORE` selects another path.

## Desktop development

Needs Node 22.12+ and pnpm 9.15.4. From the repository root:

```sh
pnpm install
pnpm --dir desktop install
pnpm --dir desktop build:web   # bundle the frontend into desktop/app-dist
pnpm --dir desktop dev         # compile and launch
```

- `KAIROS_URL=<origin>` overrides the configured server for one launch.
- For live frontend reloads, set `"bundled": false`, run `pnpm dev`, and launch
  with `KAIROS_URL=http://localhost:3000`.
- `desktop/scripts/install-desktop-entry.sh` registers this checkout in your app
  menu, which Wayland needs before the global shortcut works.
- On Ubuntu 24.04+, `desktop/scripts/kairos-electron.apparmor` allows the
  development Electron binary to sandbox; edit its path first.

Run `pnpm --dir desktop typecheck` and `pnpm --dir desktop test` before
committing.

### Packaging

```sh
pnpm --dir desktop package:linux --x64     # or --arm64 on an ARM64 machine
pnpm --dir desktop package:dir             # unpacked app, for inspection
nix build .#kairos-desktop
```

Packages are written to `desktop/release/`. The `.deb`, AppImage and tarball
come from Ubuntu builders (22.04 for x64, 24.04 for ARM64), so older
distributions aren't supported.

When dependencies change:

- **`desktop/pnpm-lock.yaml`**: update the `pnpmDeps` hash in
  `nix/desktop.nix`. Set it to `lib.fakeHash`, build, and copy the reported
  hash.
- **Electron version**: update both archive hashes in
  `desktop/electron-checksums.json` from the release's `SHASUMS256.txt`.
- **Root `pnpm-lock.yaml`**: the frontend hash in `flake.nix` may need the same
  treatment.

### Releasing

`.github/workflows/desktop-release.yml` builds and smoke-tests both
architectures and the Nix package whenever the desktop app or frontend changes.
To publish a release:

1. Set `version` in `desktop/package.json` and commit.
2. Tag that commit `desktop-v<version>` and push the tag. The workflow rejects
   a tag that doesn't match the version.
3. When the run passes, review the draft release it created, which includes
   `SHA256SUMS`, and publish it. 0.x versions are marked as pre-releases.
