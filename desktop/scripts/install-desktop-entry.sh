#!/usr/bin/env bash
set -euo pipefail
desktop_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
pnpm --dir "$desktop_dir" build
node --input-type=module - "$desktop_dir" <<'JS'
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const directory = process.argv[2]
const { desktopEntry, desktopId } = await import(pathToFileURL(join(directory, 'dist/desktop-entry.js')).href)
const data = process.env.XDG_DATA_HOME || join(homedir(), '.local/share')
const applications = join(data, 'applications')
const icons = join(data, 'icons/hicolor/512x512/apps')
mkdirSync(applications, { recursive: true })
mkdirSync(icons, { recursive: true })
writeFileSync(join(applications, desktopId), desktopEntry(directory), { mode: 0o644 })
copyFileSync(join(directory, 'assets/kairos.png'), join(icons, 'org.kairos.Kairos.png'))
console.log(`Installed ${join(applications, desktopId)}`)
JS
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
fi
