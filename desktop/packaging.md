# Linux packaging

Kairos ships the Electron shell and bundled React frontend. The Go server is
hosted separately; the desktop app asks for its URL on first launch. No server,
provider credentials, or local user configuration goes into an artifact.

## Build locally

Use Node 22.12+ and pnpm 9.15.4. Build the distributable Linux artifacts on a
Debian/Ubuntu machine (or in a Debian build container):

```sh
pnpm install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop package:linux --x64
# On an ARM64 Linux builder:
pnpm --dir desktop package:linux --arm64
```

The output directory is `desktop/release/`:

- `kairos-<version>-linux-<arch>.deb`: Debian/Ubuntu installer, desktop entry,
  icons, and Ubuntu AppArmor integration supplied by electron-builder.
- `kairos-<version>-linux-<arch>.AppImage`: a single executable for conventional
  glibc Linux distributions. Desktop integration is handled by the user's
  AppImage launcher/integration tool.
- `kairos-<version>-linux-<arch>.tar.gz`: an unpack-and-run directory containing
  the `kairos` executable and Electron libraries. Keep the entire directory.

`pnpm --dir desktop package:dir` builds an unpacked app for inspection. Packaging
always uses an upstream Electron download; it does not copy the locally patched
NixOS development executable. Only the explicit application file list is shipped.

The x64 CI builder is Ubuntu 22.04; the ARM64 builder is Ubuntu 24.04. Compatibility
with older distributions is not promised. AppImage and tarballs still need host
GUI libraries and working Chromium sandbox support; they are not NixOS packages.
Keep the sandbox enabled. On Ubuntu 24+, prefer the `.deb`, which installs an
AppArmor profile for `/opt/Kairos/kairos`. Portable builds can need a local
AppArmor user-namespace policy for their installation path.

## NixOS and Nix

The desktop flake builds the frontend and TypeScript shell from source and wraps
the exact Electron version in `desktop/package.json` with Nixpkgs runtime
libraries. It includes desktop/menu integration and requires no pnpm at runtime.

```sh
nix build .#kairos-desktop
nix run .#desktop
# From another machine, once the commit is available remotely:
nix run github:thang-qt/Kairos/desktop-electron#desktop
```

For NixOS, add `inputs.kairos.packages.${pkgs.system}.kairos-desktop` to
`environment.systemPackages`. Home Manager can use the same package in
`home.packages`. Both `x86_64-linux` and `aarch64-linux` are exposed. The existing
default server package and `services.kairos` module keep their current behavior.

The pnpm dependency hash in `nix/desktop.nix` must be updated after changing the
desktop lockfile. To compute it, temporarily use `lib.fakeHash`, build, and copy
the reported hash. Electron version changes also require refreshing the two
Linux archive hashes in `desktop/electron-checksums.json` from the upstream
Electron release checksums. Root frontend lockfile changes may require updating
the existing frontend pnpm hash in `flake.nix`.

## GitHub Actions

`.github/workflows/desktop-release.yml` checks the frontend and desktop shell,
builds native x64 and ARM64 packages, installs and smoke-tests each `.deb` under
Xvfb, inspects the AppImage/tarball contents, and builds the native x64 Nix package.
The smoke test uses a temporary config directory, loads both sandboxed renderers,
and verifies that the bundled setup UI and preload bridges work without a server.

Pushes to `desktop-electron`/`main`, pull requests, and manual workflow runs upload
artifacts without creating releases. To create a release:

1. Update `desktop/package.json` to the intended semantic version and commit it.
2. Tag that commit `desktop-v<version>` (for example `desktop-v0.1.0`) and push
   the tag. The workflow rejects a version/tag mismatch.
3. After all jobs pass, review the generated **draft** GitHub release and publish
   it. It contains both architectures and a combined `SHA256SUMS` file.

The workflow never pushes version changes or tags. Installed updates are manual
for now: install the new `.deb`, replace the AppImage/tarball, or update the flake.
An APT repository and in-app updater are separate future work.

## Runtime paths

Start at login uses the installed executable for `.deb`/tarballs, the original
`APPIMAGE` path for AppImage, and the Nix wrapper for Nix. The development launcher
is used only when running from a checkout. User data remains under the normal
Kairos config directory; upgrading or uninstalling a package does not remove it.
