import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  shell,
  Tray,
  WebContentsView,
} from 'electron'
import type {
  IpcMainInvokeEvent,
  IpcMainEvent,
  MenuItemConstructorOptions,
  WebContents,
} from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopId, isAutostartEnabled, setAutostart } from './desktop-entry.js'
import { readConfig, readWindowState, writeJson } from './settings.js'
import type { Config } from './settings.js'
import { fallbackTheme, validateTheme } from './titlebar-state.js'
import type { Theme, TitlebarState } from './titlebar-state.js'
import { installBundleProtocol } from './bundle-protocol.js'

const directory = dirname(dirname(fileURLToPath(import.meta.url)))
const offlineFile = join(directory, 'offline.html')
const titlebarFile = join(directory, 'titlebar.html')
const titlebarHeight = 32
const permittedPermissions = new Set([
  'clipboard-sanitized-write',
  'clipboard-read',
  'notifications',
])
let config: Config
let origin: string
let mainWindow: BrowserWindow | undefined
let mainView: WebContentsView | undefined
let pageTitle = 'Kairos'
let contentTheme: Theme | undefined
let contentTop: 'frame' | 'surface' = 'frame'
let tray: Tray | undefined
let quitting = false
let mainReady = false
let wantMain = true
let saveTimer: ReturnType<typeof setTimeout> | undefined

app.setName('Kairos')
app.setDesktopName(desktopId)
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', function secondInstance(_event, argv) {
    if (argv.includes('--toggle')) toggleMain()
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
  // The window lives until Quit, including when hidden to the tray.
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

function validateSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const owned = event.sender === mainView?.webContents
  if (
    !owned ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isConfiguredOrigin(event.senderFrame.url)
  ) {
    throw new Error('Untrusted Kairos desktop IPC sender')
  }
}

async function start(): Promise<void> {
  const bundleDirectory = join(directory, 'app-dist')
  config = readConfig(bundleDirectory)
  origin = new URL(config.url).origin
  console.log(
    `[Kairos] Frontend mode: ${config.bundled ? 'bundled' : 'remote'}`,
  )
  if (config.bundled) await installBundleProtocol(origin, bundleDirectory)
  console.log(
    `[Kairos] Electron ${process.versions.electron}; URL ${config.url}; desktop identity ${desktopId}`,
  )
  console.log('[Kairos] Hidden title bar with Linux client frame')

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
  ipcMain.on('kairos:theme', function receiveTheme(event, payload: unknown) {
    try {
      validateSender(event)
    } catch {
      return
    }
    if (event.sender !== mainView?.webContents) return
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('theme' in payload) ||
      !('top' in payload) ||
      (payload.top !== 'frame' && payload.top !== 'surface')
    )
      return
    const theme = validateTheme(payload.theme)
    if (!theme) return
    contentTheme = {
      ...fallbackTheme(nativeTheme.shouldUseDarkColors),
      ...theme,
    }
    contentTop = payload.top
    sendTitlebarState()
  })
  ipcMain.handle('kairos:titlebar-minimize', function minimizeTitlebar(event) {
    validateTitlebarSender(event)
    mainWindow?.minimize()
  })
  ipcMain.handle('kairos:titlebar-maximize', function maximizeTitlebar(event) {
    validateTitlebarSender(event)
    toggleMainMaximize()
    mainView?.webContents.focus()
  })
  ipcMain.handle('kairos:titlebar-close', function closeTitlebar(event) {
    validateTitlebarSender(event)
    mainWindow?.close()
  })
  ipcMain.handle('kairos:titlebar-state', function readTitlebarState(event) {
    validateTitlebarSender(event)
    return titlebarState()
  })
  nativeTheme.on('updated', function nativeThemeUpdated() {
    if (!contentTheme) {
      mainWindow?.setBackgroundColor(
        nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#f9f9f9',
      )
      sendTitlebarState()
    }
  })

  createMenu()
  createMainWindow()
  createTray()
  registerHotkey()
}

function createMenu(): void {
  const view: MenuItemConstructorOptions[] = [
    {
      label: 'Reload',
      accelerator: 'Control+R',
      click: function reloadContent() {
        activeContents()?.reload()
      },
    },
    {
      label: 'Reset zoom',
      accelerator: 'Control+0',
      click: function resetZoom() {
        activeContents()?.setZoomLevel(0)
      },
    },
    {
      label: 'Zoom in',
      accelerator: 'Control+Plus',
      click: function zoomIn() {
        changeZoom(1)
      },
    },
    {
      label: 'Zoom out',
      accelerator: 'Control+-',
      click: function zoomOut() {
        changeZoom(-1)
      },
    },
  ]
  if (!app.isPackaged)
    view.push({
      label: 'Toggle developer tools',
      accelerator: 'Control+Shift+I',
      click: function devtools() {
        activeContents()?.toggleDevTools()
      },
    })
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

function createMainWindow(): void {
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#f9f9f9',
    icon: join(directory, 'assets/kairos.png'),
    webPreferences: {
      ...webPreferences,
      preload: join(directory, 'dist/titlebar-preload.cjs'),
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
  mainView = new WebContentsView({
    webPreferences: {
      ...webPreferences,
    },
  })
  mainView.setBackgroundColor(backgroundColor)
  mainWindow.contentView.addChildView(mainView)
  layoutMainView()
  mainWindow.on('resize', layoutMainView)
  mainWindow.on('maximize', layoutMainView)
  mainWindow.on('unmaximize', layoutMainView)
  mainWindow.on('enter-full-screen', layoutMainView)
  mainWindow.on('leave-full-screen', layoutMainView)
  mainWindow.on('focus', sendTitlebarState)
  mainWindow.on('blur', sendTitlebarState)
  mainWindow.on('closed', function closeMainView() {
    if (mainView && !mainView.webContents.isDestroyed())
      mainView.webContents.close()
    mainView = undefined
  })
  mainView.webContents.on(
    'page-title-updated',
    function updatePageTitle(event, title) {
      event.preventDefault()
      pageTitle = title.trim() || 'Kairos'
      mainWindow?.setTitle(pageTitle)
      sendTitlebarState()
    },
  )
  mainView.webContents.on(
    'did-start-navigation',
    function resetTheme(_event, _url, inPlace, isMainFrame) {
      if (isMainFrame && !inPlace) {
        contentTheme = undefined
        contentTop = 'frame'
        sendTitlebarState()
      }
    },
  )
  // The local chrome cannot navigate to remote content or create child windows.
  mainWindow.webContents.on(
    'will-navigate',
    function denyTitlebarNavigation(event) {
      event.preventDefault()
    },
  )
  mainWindow.webContents.on(
    'will-frame-navigate',
    function denyTitlebarFrame(event) {
      event.preventDefault()
    },
  )
  mainWindow.webContents.on(
    'will-attach-webview',
    function denyTitlebarWebview(event) {
      event.preventDefault()
    },
  )
  mainWindow.webContents.setWindowOpenHandler(function denyTitlebarNewWindow() {
    return { action: 'deny' }
  })
  mainWindow.webContents.on('did-finish-load', sendTitlebarState)
  void mainWindow
    .loadFile(titlebarFile, {
      query: { mode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' },
    })
    .catch(function titlebarFailed(error) {
      console.error('[Kairos] Title bar failed:', error)
    })
  configureContents(mainView.webContents, config.url)
}

function configureContents(contents: WebContents, target: string): void {
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
        if (isMainFrame) void showOffline(contents, target)
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
      void showOffline(contents, target)
    },
  )
  void contents.loadURL(target).catch(function loadRejected(error) {
    console.warn('[Kairos] Initial navigation rejected:', error.message)
  })
}

async function showOffline(
  contents: WebContents,
  target: string,
): Promise<void> {
  if (contents.isDestroyed()) return
  try {
    await contents.loadFile(offlineFile, { query: { retry: target } })
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
  mainView?.webContents.focus()
}

function toggleMain(): void {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) {
    wantMain = false
    mainWindow.hide()
  } else openMain()
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
      { label: `Open Kairos (${config.hotkey})`, click: openMain },
      {
        label: 'Reload',
        click: function reload() {
          if (mainView)
            void mainView.webContents
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
    const registered = globalShortcut.register(config.hotkey, toggleMain)
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

function activeContents(): WebContents | undefined {
  return mainView?.webContents
}

function changeZoom(delta: number): void {
  const contents = activeContents()
  if (contents) contents.setZoomLevel(contents.getZoomLevel() + delta)
}

function toggleMainMaximize(): void {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
}

function layoutMainView(): void {
  if (!mainWindow || !mainView) return
  const [width, height] = mainWindow.getContentSize()
  mainView.setBounds({
    x: 0,
    y: titlebarHeight,
    width,
    height: Math.max(0, height - titlebarHeight),
  })
  sendTitlebarState()
}

function validateTitlebarSender(event: IpcMainInvokeEvent): void {
  if (
    event.sender !== mainWindow?.webContents ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    fileURLToPath(new URL(event.senderFrame.url)) !== titlebarFile
  ) {
    throw new Error('Untrusted title bar IPC sender')
  }
}

function titlebarState(): TitlebarState {
  return {
    title: pageTitle,
    maximized: mainWindow?.isMaximized() ?? false,
    focused: mainWindow?.isFocused() ?? false,
    top: contentTop,
    theme: contentTheme ?? fallbackTheme(nativeTheme.shouldUseDarkColors),
  }
}

function sendTitlebarState(): void {
  if (mainWindow && !mainWindow.webContents.isDestroyed())
    mainWindow.webContents.send('kairos:titlebar-state', titlebarState())
}
