import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
  Tray,
} from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopId, isAutostartEnabled, setAutostart } from './desktop-entry.js'
import { readConfig, readWindowState, writeJson } from './settings.js'
import type { Config } from './settings.js'

const directory = dirname(dirname(fileURLToPath(import.meta.url)))
const offlineFile = join(directory, 'offline.html')
const permittedPermissions = new Set([
  'clipboard-sanitized-write',
  'clipboard-read',
  'notifications',
])
let config: Config
let origin: string
let mainWindow: BrowserWindow | undefined
let popupWindow: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
let mainReady = false
let popupReady = false
let wantMain = !process.argv.includes('--toggle')
let wantPopup = process.argv.includes('--toggle')
let saveTimer: ReturnType<typeof setTimeout> | undefined

app.setName('Kairos')
app.setDesktopName(desktopId)
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', function secondInstance(_event, argv) {
    if (argv.includes('--toggle')) togglePopup()
    else openMain()
  })
  app.on('activate', openMain)
  app.on('before-quit', function beforeQuit() {
    quitting = true
    saveWindowState()
  })
  app.on('will-quit', function willQuit() {
    if (saveTimer) clearTimeout(saveTimer)
    globalShortcut.unregisterAll()
    tray?.destroy()
  })
  // Both windows intentionally live until Quit, including when hidden to the tray.
  app.on('window-all-closed', function windowsClosed() {})
  void app
    .whenReady()
    .then(start)
    .catch(function startupFailed(error) {
      console.error('[Kairos] Startup failed:', error)
      app.quit()
    })
}

function isConfiguredOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin
  } catch {
    return false
  }
}

function openExternal(value: string): void {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol)) {
      void shell.openExternal(url.href).catch(function externalFailed(error) {
        console.warn('[Kairos] Could not open external link:', error)
      })
    }
  } catch {
    // Ignore invalid URLs and non-web protocols.
  }
}

function validateSender(event: IpcMainInvokeEvent): void {
  const owned =
    event.sender === mainWindow?.webContents ||
    event.sender === popupWindow?.webContents
  if (
    !owned ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isConfiguredOrigin(event.senderFrame.url)
  ) {
    throw new Error('Untrusted Kairos desktop IPC sender')
  }
}

function start(): void {
  config = readConfig()
  origin = new URL(config.url).origin
  console.log(
    `[Kairos] Electron ${process.versions.electron}; URL ${config.url}; desktop identity ${desktopId}`,
  )
  console.log(
    `[Kairos] Popup rounded transparency: ${config.popupRounded}; hidden title bar with Linux client frame`,
  )

  session.defaultSession.setPermissionRequestHandler(
    function permissionRequest(contents, permission, callback, details) {
      callback(
        Boolean(
          contents &&
          isConfiguredOrigin(contents.getURL()) &&
          isConfiguredOrigin(details.requestingUrl) &&
          permittedPermissions.has(permission),
        ),
      )
    },
  )
  session.defaultSession.setPermissionCheckHandler(
    function permissionCheck(contents, permission, requestingOrigin) {
      return Boolean(
        contents &&
        isConfiguredOrigin(contents.getURL()) &&
        isConfiguredOrigin(requestingOrigin) &&
        permittedPermissions.has(permission),
      )
    },
  )
  ipcMain.handle('kairos:hide-popup', function hidePopup(event) {
    validateSender(event)
    popupWindow?.hide()
    wantPopup = false
  })
  ipcMain.handle('kairos:open-main', function showMain(event) {
    validateSender(event)
    openMain()
  })
  ipcMain.handle('kairos:close-window', function closeWindow(event) {
    validateSender(event)
    // Reuse the close handlers, which hide the sender's window to the tray.
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('kairos:toggle-maximize', function toggleMaximize(event) {
    validateSender(event)
    if (event.sender !== mainWindow?.webContents) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })

  createMenu()
  createWindows()
  createTray()
  registerHotkey()
}

function createMenu(): void {
  const view: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
  ]
  if (!app.isPackaged) view.push({ role: 'toggleDevTools' })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Kairos',
        submenu: [
          {
            label: 'Quit',
            accelerator: 'Control+Q',
            click: function quit() {
              app.quit()
            },
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      { label: 'View', submenu: view },
    ]),
  )
}

function createWindows(): void {
  const state = readWindowState(
    join(app.getPath('userData'), 'window-state.json'),
  )
  const webPreferences = {
    preload: join(directory, 'dist/preload.cjs'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  }
  const backgroundColor = nativeTheme.shouldUseDarkColors
    ? '#000000'
    : '#ffffff'
  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 400,
    minHeight: 500,
    titleBarStyle: 'hidden',
    resizable: true,
    hasShadow: true,
    show: false,
    backgroundColor,
    icon: join(directory, 'assets/kairos.png'),
    webPreferences: {
      ...webPreferences,
      additionalArguments: ['--kairos-window=main'],
    },
  })
  mainWindow.setMenuBarVisibility(false)
  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', function mainCanShow() {
    mainReady = true
    if (wantMain) openMain()
  })
  mainWindow.on('close', function hideMain(event) {
    saveWindowState()
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
      wantMain = false
    }
  })
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('maximize', scheduleSave)
  mainWindow.on('unmaximize', scheduleSave)
  configureContents(mainWindow, config.url, false)

  popupWindow = new BrowserWindow({
    width: 720,
    height: 560,
    show: false,
    frame: false,
    transparent: config.popupRounded,
    backgroundColor: config.popupRounded ? '#00000000' : backgroundColor,
    hasShadow: !config.popupRounded,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      ...webPreferences,
      additionalArguments: ['--kairos-window=popup'],
    },
  })
  popupWindow.setMenuBarVisibility(false)
  popupWindow.once('ready-to-show', function popupCanShow() {
    popupReady = true
    if (wantPopup) showPopup()
  })
  popupWindow.on('blur', function hideOnBlur() {
    wantPopup = false
    popupWindow?.hide()
  })
  popupWindow.on('close', function hideOnClose(event) {
    if (!quitting) {
      event.preventDefault()
      wantPopup = false
      popupWindow?.hide()
    }
  })
  popupWindow.webContents.on(
    'before-input-event',
    function escapePopup(event, input) {
      if (
        popupWindow?.isFocused() &&
        input.type === 'keyDown' &&
        input.key === 'Escape' &&
        !input.alt &&
        !input.control &&
        !input.meta &&
        !input.shift
      ) {
        event.preventDefault()
        wantPopup = false
        popupWindow.hide()
      }
    },
  )
  configureContents(popupWindow, `${config.url}/new`, true)
}

function configureContents(
  window: BrowserWindow,
  target: string,
  rounded: boolean,
): void {
  const contents = window.webContents
  contents.on('will-navigate', function restrictNavigation(event, url) {
    if (!isConfiguredOrigin(url)) {
      event.preventDefault()
      openExternal(url)
    }
  })
  contents.on(
    'will-redirect',
    function restrictRedirect(event, url, _inPlace, isMainFrame) {
      if (!isConfiguredOrigin(url)) {
        event.preventDefault()
        if (isMainFrame) void showOffline(window, target)
      }
    },
  )
  contents.on('will-frame-navigate', function restrictFrame(event) {
    if (!isConfiguredOrigin(event.url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(function newWindow({ url }) {
    openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-attach-webview', function denyWebview(event) {
    event.preventDefault()
  })
  contents.on(
    'did-fail-load',
    function failedLoad(_event, code, description, url, isMainFrame) {
      if (!isMainFrame || code === -3 || url.startsWith('file:')) return
      console.warn(`[Kairos] Load failed (${code}): ${description}`)
      void showOffline(window, target)
    },
  )
  contents.on('did-finish-load', function loaded() {
    if (rounded && config.popupRounded) {
      void contents
        .insertCSS(`
        html, body { background: transparent !important; }
        body { margin: 0 !important; padding: 12px !important; box-sizing: border-box; }
        #root, .offline-shell {
          height: calc(100dvh - 24px) !important;
          min-height: 0 !important;
          border-radius: 16px; overflow: hidden;
          box-sizing: border-box;
          background: var(--color-surface, Canvas);
          border: 1px solid color-mix(in srgb, var(--color-ink, CanvasText) 10%, transparent);
          box-shadow: 0 4px 12px color-mix(in srgb, CanvasText 15%, transparent);
        }
        #root > div { height: 100% !important; min-height: 0 !important; }
        /* The hosted AppShell uses viewport height; keep it inside the inset surface. */
        #root .h-screen, #root .min-h-screen { height: 100% !important; min-height: 0 !important; }
      `)
        .catch(function cssFailed(error) {
          console.warn('[Kairos] Rounded popup CSS failed:', error)
        })
    }
  })
  void window.loadURL(target).catch(function loadRejected(error) {
    console.warn('[Kairos] Initial navigation rejected:', error.message)
  })
}

async function showOffline(
  window: BrowserWindow,
  target: string,
): Promise<void> {
  if (window.isDestroyed()) return
  try {
    await window.loadFile(offlineFile, { query: { retry: target } })
  } catch (error) {
    console.error('[Kairos] Offline page failed:', error)
  }
}

function openMain(): void {
  wantMain = true
  if (!mainReady || !mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function showPopup(): void {
  wantPopup = true
  if (!popupReady || !popupWindow) return
  const area = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea
  const bounds = popupWindow.getBounds()
  // Wayland may ignore these coordinates; the compositor retains placement authority.
  popupWindow.setPosition(
    Math.round(area.x + (area.width - bounds.width) / 2),
    Math.round(area.y + (area.height - bounds.height) / 2),
  )
  popupWindow.show()
  popupWindow.focus()
}

function togglePopup(): void {
  if (popupWindow?.isVisible() || wantPopup) {
    wantPopup = false
    popupWindow?.hide()
  } else showPopup()
}

function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized())
    return
  writeJson(join(app.getPath('userData'), 'window-state.json'), {
    ...mainWindow.getNormalBounds(),
    maximized: mainWindow.isMaximized(),
  })
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveWindowState, 250)
}

function createTray(): void {
  tray = new Tray(join(directory, 'assets/tray.png'))
  tray.setToolTip('Kairos')
  tray.on('click', openMain)
  updateTrayMenu()
}

function updateTrayMenu(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Kairos', click: openMain },
      { label: `Quick chat (${config.hotkey})`, click: showPopup },
      {
        label: 'Reload',
        click: function reload() {
          if (mainWindow)
            void mainWindow
              .loadURL(config.url)
              .catch(function reloadFailed(error) {
                console.warn('[Kairos] Reload failed:', error.message)
              })
        },
      },
      { type: 'separator' },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: isAutostartEnabled(),
        click: function changeAutostart(item) {
          try {
            setAutostart(item.checked, directory)
          } catch (error) {
            console.error('[Kairos] Could not change autostart:', error)
          }
          updateTrayMenu()
        },
      },
      {
        label: 'Quit',
        click: function quit() {
          app.quit()
        },
      },
    ]),
  )
}

function registerHotkey(): void {
  try {
    const registered = globalShortcut.register(config.hotkey, togglePopup)
    console.log(
      `[Kairos] Hotkey ${config.hotkey}: ${registered ? 'registration succeeded (on Wayland this may only confirm portal submission)' : 'registration failed'}`,
    )
  } catch (error) {
    console.warn(`[Kairos] Hotkey ${config.hotkey}: registration failed`, error)
  }
  console.log(
    '[Kairos] Hotkey fallback: desktop/scripts/kairos-desktop --toggle',
  )
}
