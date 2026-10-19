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
  To have it open a new chat instead, use **Settings → Desktop app**.
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
  "hotkey": "Control+Alt+Space",
  "hotkeyAction": "show"
}
```

The server and what the shortcut opens are easier to change in the app. To
change the shortcut itself, edit the file: `hotkey` uses
[Electron's accelerator format](https://www.electronjs.org/docs/latest/api/accelerator),
`hotkeyAction` is `show` or `new-chat`, and you need to restart Kairos
afterwards. On Wayland, combine Ctrl, Alt or Super with a letter, number,
Space, arrow, comma or period; other keys reach your desktop without a key
assigned. Setting `"bundled": false` loads the
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
