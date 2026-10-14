import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const desktopId = 'org.kairos.Kairos.desktop'

function quoteExec(value: string): string {
  // Desktop entries unescape backslashes before parsing quoted Exec arguments.
  return `"${value
    .replace(/[%]/g, '%%')
    .replace(/[\\"`$]/g, '\\$&')
    .replace(/\\/g, '\\\\')}"`
}

export function desktopEntry(
  directory: string,
  launcher = join(directory, 'scripts/kairos-desktop'),
  icon = 'org.kairos.Kairos',
): string {
  return readFileSync(join(directory, 'kairos.desktop'), 'utf8')
    .replaceAll('@LAUNCHER@', quoteExec(launcher))
    .replaceAll('@ICON@', icon)
}

export function autostartPath(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'autostart',
    desktopId,
  )
}

export function isAutostartEnabled(): boolean {
  return existsSync(autostartPath())
}

export function setAutostart(
  enabled: boolean,
  directory: string,
  launcher?: string,
  icon?: string,
): void {
  const path = autostartPath()
  if (enabled) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, desktopEntry(directory, launcher, icon), {
      mode: 0o644,
    })
  } else if (existsSync(path)) {
    unlinkSync(path)
  }
}
