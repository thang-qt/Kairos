import { net, session } from 'electron'
import { access } from 'node:fs/promises'
import { createBundleHandler } from './bundle-response.js'

export async function installBundleProtocol(
  origin: string,
  directory: string,
): Promise<void> {
  await access(`${directory}/index.html`)
  await session.defaultSession.clearStorageData({
    origin,
    storages: ['serviceworkers'],
  })
  const handle = createBundleHandler(
    origin,
    directory,
    function fetch(input, options) {
      return net.fetch(input, options)
    },
  )
  session.defaultSession.protocol.handle('https', handle)
  if (new URL(origin).protocol === 'http:')
    session.defaultSession.protocol.handle('http', handle)
}
