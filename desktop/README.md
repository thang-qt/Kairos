# Kairos for Linux

A desktop app for your Kairos server. It lives in the tray, opens with a global
hotkey, and ships the Kairos interface, so pages load instantly and keep working
when the connection drops. It doesn't include a server: point it at the Kairos
server you already run.

## Install

Download the file for your machine (`x64` or `arm64`) from the
[releases page](https://github.com/thang-qt/Kairos/releases).

**Debian and Ubuntu**: install the `.deb`. It adds Kairos to your app menu and
sets up the sandbox permissions Ubuntu 24.04 and later require.

```sh
sudo apt install ./kairos-<version>-linux-x64.deb
```

**Other distributions**: use the `.AppImage`. Make it executable and run it:

```sh
chmod +x kairos-<version>-linux-x64.AppImage
./kairos-<version>-linux-x64.AppImage
```

The `.tar.gz` is the same app as a plain folder. Extract it and run `kairos`,
keeping the folder's contents together.

**NixOS and Nix**:

```sh
nix run github:thang-qt/Kairos#desktop
```

To install it permanently, add
`inputs.kairos.packages.${pkgs.system}.kairos-desktop` to
`environment.systemPackages` or Home Manager's `home.packages`.

To update, install the newer package the same way. Your settings and logins
are kept.

## First run

Kairos asks for your server's address. Enter it (for example
`kairos.example.com`) and choose **Continue**, then sign in.

- Addresses use HTTPS unless you type `http://`.
- Plain HTTP is only accepted for local network addresses such as `localhost`,
  `192.168.x.x`, `10.x.x.x` or `*.local`.

To switch servers later, use **Change** under the sign-in card, **Settings →
Account → Server**, or **Change server…** in the tray menu. Each server keeps
its own login.

## Everyday use

- **Control+Alt+Space** shows Kairos, or hides it if it's already in front.
- Closing the window hides it to the tray; quit with **Ctrl+Q** or the tray's
  **Quit**.
- **Start at login** in the tray menu opens Kairos when you sign in. On Nix,
  this needs Kairos installed in your system or user profile.

On Wayland, your desktop may ask you to confirm the shortcut the first time. If
it never works, bind a custom shortcut in your desktop settings to:

```sh
kairos --toggle
```

For an AppImage, use the AppImage's path instead of `kairos`.

## Settings

Settings are stored in `~/.config/Kairos/config.json`:

```json
{
  "url": "https://kairos.example.com",
  "hotkey": "Control+Alt+Space"
}
```

`hotkey` uses
[Electron's accelerator format](https://www.electronjs.org/docs/latest/api/accelerator).
Restart Kairos after editing the file. Setting `"bundled": false` loads the
interface from the server instead of the copy shipped with the app, which you
may want if your server runs a newer Kairos than the app.

## Troubleshooting

- **Kairos won't start on Ubuntu 24.04+ (AppImage or `.tar.gz`)**: Ubuntu blocks
  the sandbox Kairos needs unless an AppArmor profile allows it. Use the `.deb`,
  which installs one.
- **"Couldn't reach that address"**: check that the address opens in a browser
  on this machine. Kairos doesn't bypass certificate errors.
- **Something looks out of date after a server upgrade**: install the latest
  desktop release, or set `"bundled": false`.

Uninstalling the app leaves your settings in `~/.config/Kairos`; delete that
folder to remove them.

## Development

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
