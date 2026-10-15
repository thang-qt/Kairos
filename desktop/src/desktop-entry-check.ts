import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { desktopEntry, setAutostart } from './desktop-entry.js'

test('desktop and autostart entries use the packaged launcher with safe quoting', function () {
  const directory = mkdtempSync(join(tmpdir(), 'kairos-entry-'))
  const previous = process.env.XDG_CONFIG_HOME
  try {
    process.env.XDG_CONFIG_HOME = directory
    writeFileSync(
      join(directory, 'kairos.desktop'),
      '[Desktop Entry]\nExec=@LAUNCHER@\nIcon=@ICON@\n',
    )
    const entry = desktopEntry(directory, '/opt/Kairos With Spaces/kairos')
    assert.match(entry, /Exec="\/opt\/Kairos With Spaces\/kairos"/)
    assert.match(entry, /Icon=org.kairos.Kairos/)
    assert.match(desktopEntry(directory, '/tmp/100%/kairos'), /100%%/)
    assert.match(desktopEntry(directory), /scripts\/kairos-desktop/)
    // Nix passes a bare name so autostart survives store garbage collection.
    setAutostart(true, directory, 'kairos')
    const path = join(directory, 'autostart/org.kairos.Kairos.desktop')
    assert.match(readFileSync(path, 'utf8'), /Exec="kairos"/)
    setAutostart(false, directory)
    assert.throws(
      function removed() {
        readFileSync(path)
      },
      { code: 'ENOENT' },
    )
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
