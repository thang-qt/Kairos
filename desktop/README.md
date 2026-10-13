# Kairos desktop prototype

Thin Linux Electron 44.7.0 shell. Both windows load the hosted web app using the
default persistent Electron session. No frontend or backend is bundled.

```sh
pnpm --dir desktop install
KAIROS_URL=https://your-kairos-host.example pnpm --dir desktop dev
```

`dev` compiles with TypeScript and launches Electron. After building, use
`pnpm --dir desktop start`. The `.cts` preload emits CommonJS (`dist/preload.cjs`);
everything else emits ES modules. Electron's install script is allowed explicitly
for pnpm versions that gate dependency builds. Node 22.12+ is required by Electron's
download tooling.

Install the local desktop entry and icon before testing portal shortcuts:

```sh
desktop/scripts/install-desktop-entry.sh
desktop/scripts/kairos-desktop --toggle
```

The installer uses this checkout's absolute launcher path and installs
`org.kairos.Kairos.desktop` under `$XDG_DATA_HOME/applications` (default
`~/.local/share/applications`). It installs the icon in the hicolor theme. The
desktop action and the `--toggle` command summon or hide quick chat. Launching a
second instance without arguments focuses the main window. The launcher builds
only if `dist/main.js` is missing; use `dev` to rebuild after source changes.

Settings live in `app.getPath('userData')/config.json` (normally
`~/.config/Kairos/config.json`, respecting Electron's XDG config location):

```json
{
  "url": "https://your-kairos-host.example",
  "hotkey": "Control+Alt+Space",
  "popupRounded": true
}
```

URL priority is `KAIROS_URL`, config, then `http://localhost:3000`. Quick chat loads
the configured base URL plus `/new`. Settings are read at startup; restart after
editing. Use the config URL for desktop and login launches, which do not inherit
an environment variable set only in a terminal. Set `popupRounded` to `false` and
restart if transparent surfaces render poorly. Close hides the main window;
Ctrl+Q or the tray's Quit exits. Start at login creates/removes
`$XDG_CONFIG_HOME/autostart/org.kairos.Kairos.desktop` (default
`~/.config/autostart`).

The main window uses `titleBarStyle: 'hidden'` without `titleBarOverlay`, with
`resizable: true` and `hasShadow: true`. It stays hidden until ready with a
system light/dark surface background. The popup is preloaded, frameless, fixed
size, and optionally transparent with an inset rounded surface.

The hosted React app must include the desktop header changes to show Close and
supply drag regions. Plain browser sessions have neither desktop window controls
nor drag styling. The preload marks `html[data-desktop]` as `main` or `popup`
before rendering when possible, or at DOMContentLoaded. Headers on chat,
settings, and auth pages and both left sidebar headers act as drag regions;
interactive elements are excluded. Loading/error/not-found pages have a thin
desktop-only top bar. The legacy connect route redirects to `/new`. The local
offline page has a drag strip; its origin cannot invoke privileged bridge calls.

Close calls a sender-validated IPC handler which reuses that window's existing
close-to-tray behavior. The bridge also exposes `toggleMaximize()` for the main
window, with a no-op for the popup. Main-only CSS removes the inset card's top
padding to align its header with the sidebar; browser spacing is unchanged.

Electron's [44.7.0 title bar documentation](https://github.com/electron/electron/blob/v44.7.0/docs/tutorial/custom-title-bar.md)
explains that Linux caption controls are added back only with an overlay. The
[Linux frame implementation](https://github.com/electron/electron/blob/v44.7.0/shell/browser/ui/views/electron_frame_view_linux.cc)
and [frame layout](https://github.com/electron/electron/blob/v44.7.0/shell/browser/ui/views/electron_frame_view_layout_linux.cc)
retain resize hit testing, shadow insets, and corner radii without caption
buttons. Hidden-title-bar windows enter this client-frame path; `frame: false`
is unnecessary. This evidence covers the Linux implementation, including X11;
compositor appearance and resize behavior still need manual testing.

Double-click maximize uses Chromium's native caption handling. Electron 44.7.0
pins Chromium 152.0.7977.130, whose
[Linux window event filter](https://github.com/chromium/chromium/blob/152.0.7977.130/ui/views/widget/desktop_aura/window_event_filter_linux.cc)
handles caption double-clicks with a default toggle-maximize action, respecting
Linux desktop settings. Drag regions return caption hit tests and consume
pointer events, so there is no React double-click handler. Popup maximization
remains disabled.

Electron 44.7.0's [global shortcut docs](https://github.com/electron/electron/blob/v44.7.0/docs/api/global-shortcut.md)
say the Wayland portal path is already enabled by default. We also set the
requested `GlobalShortcutsPortal` flag explicitly. KDE binds silently and exposes
shortcuts in System Settings. Portal identity must match an installed desktop
entry; newer portals can reject unresolvable identities. The registration log
reports `register()`'s result, which alone does not prove the shortcut activates.
This version has no `registration-resolved` event in its API/types. Bind a KDE
shortcut to the absolute `desktop/scripts/kairos-desktop --toggle` command if needed.

Wayland controls window placement and focus. Position restoration and positioning
on the cursor's display are best effort; Electron may report zero coordinates.
`alwaysOnTop` and focus requests also need compositor testing. See Electron's
[BrowserWindow docs](https://www.electronjs.org/docs/latest/api/browser-window).

Manual KDE checks:

- Confirm there is no native title bar or caption buttons. Chat has exactly one
  Close control after the panel toggle; settings and auth have Close at the right.
- Drag from blank chat/settings/auth headers, left sidebar headers, and the
  loading/error/not-found top strip. Buttons, links, inputs, model selectors,
  and menus must still accept clicks and never drag the window.
- Double-click blank header areas to maximize/restore the main window. Check
  restore size and persistence across relaunches. Double-clicking controls must
  not maximize, and the popup must remain fixed size.
- Resize every edge and corner, including near header controls and at 400x500
  minimum size. Inspect shadows/corners restored, maximized, and tiled, with
  Plasma's scaling settings. Repeat these checks on X11 if available.
- Close must hide the correct window, with tray reopen, hotkey toggling, and
  Ctrl+Q still working. Check dark launch without a light flash, page title,
  restored size/maximized state, and tray click.
- Log in once; confirm both windows share authentication, synced history, and
  streaming. No credentials are copied between windows.
- Confirm the hotkey toggles quick chat, blur and bare Escape hide it, modified
  Escape does not, and repeated `--toggle` commands reach the existing instance.
- Check rounded edges/shadow against the desktop and the square fallback.
- Disconnect or use an unreachable URL; confirm the offline page appears and
  Retry navigates to the correct target (including `/new` in the popup).
- Check external HTTP(S) links open in the browser and other protocols are denied;
  check reload, zoom, clipboard roles, and Ctrl+Q.
- Toggle Start at login, inspect the autostart entry, and test a login launch.

The repository's `.gitignore` already ignores `node_modules` and `dist` at any
depth, including `desktop/`. Root TypeScript checking explicitly excludes this
package; run `pnpm --dir desktop typecheck` separately.

Verification in the restricted development environment: install, build, desktop
typecheck, and root `pnpm check` passed (24 test files, 94 tests). Root checks used
the pinned pnpm 9.15.4 from a temporary tools directory; desktop installation used
a writable temporary pnpm store and Electron download cache.

GUI checks were intentionally not attempted for the hidden-title-bar round.
Ubuntu 25.10 requires an AppArmor user-namespace permission for this Electron
binary; the checkout profile is `desktop/scripts/kairos-electron.apparmor`.
Keep Chromium's sandbox enabled. KDE Wayland and X11 visual and interaction
checks listed above remain manual.
