import { net, session } from 'electron'
import { access } from 'node:fs/promises'
import { createBundleHandler } from './bundle-response.js'
let installed = false

export async function installBundleProtocol(
  origin: () => string,
  directory: string,
): Promise<void> {
  await access(`${directory}/index.html`)
  await session.defaultSession.clearStorageData({
    origin: origin(),
    storages: ['serviceworkers'],
  })
  if (installed) return
  const handle = createBundleHandler(
    origin,
    directory,
    function fetch(input, options) {
      return net.fetch(input, options)
    },
  )
  session.defaultSession.protocol.handle('https', handle)
  session.defaultSession.protocol.handle('http', handle)
  installed = true
}

export function uninstallBundleProtocol(): void {
  if (!installed) return
  session.defaultSession.protocol.unhandle('https')
  session.defaultSession.protocol.unhandle('http')
  installed = false
}
