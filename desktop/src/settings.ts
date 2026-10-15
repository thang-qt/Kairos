import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { app, screen } from 'electron'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { normalizeServer } from './server-policy.js'
import { defaultHotkey, isHotkeyAction } from './hotkey-policy.js'
import type { HotkeyAction } from './hotkey-policy.js'

export type Config = {
  url?: string
  hotkey: string
  hotkeyAction: HotkeyAction
  bundled: boolean
}

export type WindowState = {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (existsSync(path)) console.warn(`[Kairos] Cannot read ${path}:`, error)
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readConfig(bundleDirectory: string): Config {
  const value = readJson(`${app.getPath('userData')}/config.json`)
  const config = isRecord(value) ? value : {}
  const input =
    process.env.KAIROS_URL?.trim() ||
    (typeof config.url === 'string' ? config.url.trim() : '')
  const parsed = input ? normalizeServer(input) : undefined
  if (parsed && !parsed.ok)
    throw new Error(`Invalid configured server: ${parsed.error}`)
  return {
    url: parsed?.ok ? parsed.origin : undefined,
    // Hand-edited hotkeys are passed to Electron as written.
    hotkey: typeof config.hotkey === 'string' ? config.hotkey : defaultHotkey,
    hotkeyAction: isHotkeyAction(config.hotkeyAction)
      ? config.hotkeyAction
      : 'show',
    bundled:
      typeof config.bundled === 'boolean'
        ? config.bundled
        : existsSync(`${bundleDirectory}/index.html`),
  }
}

// Writes only the given fields, keeping everything else in config.json.
export async function saveConfig(
  fields: Partial<Pick<Config, 'url' | 'hotkey' | 'hotkeyAction'>>,
): Promise<void> {
  const path = `${app.getPath('userData')}/config.json`
  const existing = readJson(path)
  const config = isRecord(existing) ? existing : {}
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    `${path}.tmp`,
    `${JSON.stringify({ ...config, ...fields }, null, 2)}\n`,
    { mode: 0o600 },
  )
  await rename(`${path}.tmp`, path)
}

export function readWindowState(path: string): WindowState {
  const value = readJson(path)
  const state = isRecord(value) ? value : {}
  const width =
    typeof state.width === 'number' && Number.isFinite(state.width)
      ? Math.max(400, Math.round(state.width))
      : 1100
  const height =
    typeof state.height === 'number' && Number.isFinite(state.height)
      ? Math.max(500, Math.round(state.height))
      : 800
  const result: WindowState = {
    width,
    height,
    maximized: state.maximized === true,
  }
  if (
    typeof state.x === 'number' &&
    Number.isFinite(state.x) &&
    typeof state.y === 'number' &&
    Number.isFinite(state.y)
  ) {
    const x = Math.round(state.x)
    const y = Math.round(state.y)
    if (
      screen.getAllDisplays().some(function onScreen(display) {
        const area = display.workArea
        return (
          x + width > area.x + 100 &&
          x < area.x + area.width - 100 &&
          y >= area.y &&
          y < area.y + area.height - 100
        )
      })
    ) {
      result.x = x
      result.y = y
    }
  }
  return result
}

export function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    })
    renameSync(`${path}.tmp`, path)
  } catch (error) {
    console.error(`[Kairos] Cannot save ${path}:`, error)
  }
}
