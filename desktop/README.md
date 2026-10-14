# Kairos desktop prototype

Linux Electron 44.7.0 shell with one main window and a compact local title bar.
The React frontend can be bundled; the backend always remains hosted. The page
keeps the configured HTTP(S) origin and the default persistent Electron session.

```sh
pnpm --dir desktop install
pnpm --dir desktop build:web
KAIROS_URL=https://your-kairos-host.example pnpm --dir desktop dev
```

`dev` compiles with TypeScript and launches Electron. After building, use
`pnpm --dir desktop start`. Sandboxed `.cts` preloads emit CommonJS; other files
emit ES modules. Electron's dependency install script is explicitly allowed for
pnpm versions that gate builds. Its download tooling requires Node 22.12+.

The hotkey defaults to `Control+Alt+Space`. If the main window is visible and
focused, the hotkey hides it to the tray. Otherwise it shows the window, restores
it if minimized, and focuses the hosted content view for typing. A visible but
unfocused window comes forward instead of hiding. Close also hides to the tray;
Ctrl+Q or the tray's Quit exits. The tray's Open Kairos item displays the hotkey
and always shows/focuses the window.

Install the local desktop entry and icon before testing portal shortcuts:

```sh
desktop/scripts/install-desktop-entry.sh
desktop/scripts/kairos-desktop --toggle
```

The installer writes `org.kairos.Kairos.desktop` under
`$XDG_DATA_HOME/applications` (default `~/.local/share/applications`), using this
checkout's absolute launcher path, and installs the icon in the hicolor theme.
Its Show or hide Kairos desktop action runs `--toggle`. A second instance with
`--toggle` toggles the running window; without arguments it opens/focuses it.
Launching `--toggle` when no instance exists opens the main window. The launcher
builds only when `dist/main.js` is missing; use `dev` after source edits. Re-run
the installer to update an already-installed desktop action.

Settings live in `app.getPath('userData')/config.json` (normally
`~/.config/Kairos/config.json`, respecting Electron's XDG config location):

```json
{
  "url": "https://your-kairos-host.example",
  "hotkey": "Control+Alt+Space",
  "bundled": true
}
```

URL priority is `KAIROS_URL`, config, then `http://localhost:3000`. Settings are
read at startup; restart after editing. Use the config URL for desktop and login
launches, which do not inherit terminal-only environment variables. Start at
login creates/removes `$XDG_CONFIG_HOME/autostart/org.kairos.Kairos.desktop`
(default `~/.config/autostart`).

`build:web` runs the unchanged root Vite build into `internal/server/static/`
and copies it to gitignored `desktop/app-dist/`. Bundled mode defaults to true
when `app-dist/index.html` exists and false otherwise. Explicit `bundled: true`
requires that file; `bundled: false` loads the remote frontend. Startup logs the
mode. Rebuild the bundle after frontend changes. For Vite HMR, set
`"bundled": false`, start the usual development servers, then run:

```sh
KAIROS_URL=http://localhost:3000 pnpm --dir desktop dev
```

Bundled mode installs a default-session `protocol.handle('https', ...)`, also
handling `http` when the configured URL is HTTP. Only the configured origin's
frontend requests are served locally. `/api/` (and `/api`) and other origins use
the original Request with
`net.fetch(request, { bypassCustomProtocolHandlers: true })`; the Response is
returned directly. Methods, headers, JSON, multipart uploads, cookies, and
streaming bodies are not reconstructed or buffered by our handler. HttpOnly
login cookies, fetch, and EventSource/SSE keep using the hosted backend.

This behavior is documented in Electron's pinned
[protocol API](https://github.com/electron/electron/blob/v44.7.0/docs/api/protocol.md)
and [net API](https://github.com/electron/electron/blob/v44.7.0/docs/api/net.md).
The [protocol implementation](https://github.com/electron/electron/blob/v44.7.0/lib/browser/api/protocol.ts)
carries upload bodies and response streams. Backend login, uploads, streamed chat,
and EventSource reconnects still need manual Electron testing.

The resolver decodes paths, rejects dot-dot segments, backslashes, NUL, invalid
encoding, and escaping symlinks, then normalizes strictly inside the bundle.
`/` maps to `index.html`. Missing paths get SPA fallback only for navigation
requests (`mode=navigate` or `Accept: text/html`); missing assets return 404.
Static responses have explicit MIME types and `Cache-Control: no-store`.

Bundled startup clears service-worker registrations for the configured origin.
`/sw.js`, `/registerSW.js`, and `/workbox-*.js` return 404, preventing the built
PWA registration script from controlling the page; a registration 404 may appear
in the console. Other storage and login cookies remain. Remote mode retains the
site's normal service worker behavior. Bundled pages load offline and use the
app's existing API error handling. Remote navigation failures show the local
offline/retry page. Version skew is not handled: the bundled frontend must remain
compatible with the deployed backend. No backend, packaging, or auto-update is
bundled.

The window uses `titleBarStyle: 'hidden'` without an overlay, with resizing and
shadows enabled. Its own webContents loads `titlebar.html`: a 32px strip with
icon, truncated page title, minimize, maximize/restore, and close. A child
`WebContentsView` hosts the app at `(0, 32)` and the remaining client height.
Resize, maximize/restore, and fullscreen transitions update its bounds. Hosted
viewport-height layouts need no overrides; offline pages use that same view.
Reload, zoom, and devtools target the content view. Child webContents are closed
when the window is destroyed. Only the local title bar is a drag surface.

The title follows `page-title-updated`. Focus and maximize state dim inactive
chrome and switch the restore icon. The title bar's isolated preload exposes its
three controls and a state subscription; main validates its own webContents,
local file, and main frame for every IPC invocation. The hosted bridge exposes
only `{ platform: 'linux', isDesktop: true }` and marks HTML as
`data-desktop="main"`. The web app uses `isDesktopShell()` to omit the sidebar
logo rows and retain the collapse toggles on the first action rows.

Theme reporting reads seven allowlisted computed CSS properties on load,
class/system-mode changes, and shell replacement, throttled to animation frames.
Main validates the content view and configured origin, property names, strings
under 100 characters, and conservative color syntax excluding braces, separators,
and `url()`. The local renderer applies approved properties with `setProperty`.
Default light/dark colors follow nativeTheme until the page reports.
`data-shell-top="frame"` indicates an active desktop inset; otherwise it is
`surface`. The top value is validated and the bar transitions between primary-100
and surface over 200ms ease-out. Neutral hover is primary-200 on frame and
primary-100 on surface. Startup fallback remains frame.

Electron's [WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view)
provides the composition. Its pinned
[non-client hit testing](https://github.com/electron/electron/blob/v44.7.0/shell/browser/native_window.cc)
and [child event dispatch](https://github.com/electron/electron/blob/v44.7.0/shell/browser/native_window_views.cc)
check resize borders before children. No extra view inset is needed. Chromium's
[Linux window event filter](https://github.com/chromium/chromium/blob/152.0.7977.130/ui/views/widget/desktop_aura/window_event_filter_linux.cc)
handles caption double-clicks with the default maximize/restore action, respecting
desktop settings; no JavaScript double-click handler is added.

The [global shortcut docs](https://github.com/electron/electron/blob/v44.7.0/docs/api/global-shortcut.md)
say the Wayland portal path is enabled by default. We also explicitly enable
`GlobalShortcutsPortal`. The identity must match the installed desktop entry;
KDE exposes bindings in System Settings. Registration logs alone do not prove
activation. Bind a KDE shortcut to this checkout's `scripts/kairos-desktop --toggle`
if the portal fails. Wayland controls focus and placement; verify both manually.

Verification commands:

```sh
pnpm --dir desktop build
pnpm --dir desktop typecheck
pnpm --dir desktop test
pnpm check
```

Desktop tests use TypeScript plus Node's built-in `node --test`, without a new
runner dependency or Electron import. Seven tests cover safe paths, SPA fallback,
worker blocking, POST/uploads, and unbuffered streaming. GUI verification is left
to the user. Ubuntu's required user-namespace AppArmor profile is in
`scripts/kairos-electron.apparmor`; keep Chromium's sandbox enabled.

Manual KDE checks:

- Use the hotkey and `--toggle` while focused, unfocused, hidden, and minimized.
  Verify focused windows hide; all other states come forward with content focus.
  A cold `--toggle` launch should open exactly one main window.
- Close hides; tray Open and a plain second instance reopen. Ctrl+Q exits.
  Check the tray hotkey label and Show or hide Kairos desktop action after reinstall.
- Drag/double-click the title bar, resize all edges/corners, and check maximize,
  fullscreen, shadows, scaling, restored dimensions, and title truncation.
  Hosted headers must have no window controls or drag regions.
- Chat/settings omit the logo row only in desktop mode and keep the collapse
  toggle on the first action row. Web sidebar behavior remains unchanged.
- Toggle panels and narrow the window: title bar colors and neutral hover should
  follow frame/surface. Test every palette, light/dark/system mode, and cold startup.
- Type after reopening; reload, zoom/reset, devtools, and clipboard shortcuts
  should target the app. Check login/history, uploads, incremental streaming,
  EventSource reconnects, offline behavior, remote HMR, and external links.
- Test Start at login and remembered window bounds. Repeat window checks on X11
  if available.
